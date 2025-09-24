/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Content,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  FinishReason,
  GenerateContentParameters,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';

interface QwenRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

interface QwenResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface QwenStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
}

export class CustomApiContentGenerator implements ContentGenerator {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
    this.apiKey = apiKey;
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const qwenRequest = this.convertGeminiToQwenRequest(request);
    qwenRequest.stream = false;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(qwenRequest),
    });

    if (!response.ok) {
      throw new Error(
        `Qwen API error: ${response.status} ${response.statusText}`,
      );
    }

    const qwenResponse: QwenResponse = await response.json();
    return this.convertQwenToGeminiResponse(qwenResponse);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return this.generateContentStreamInternal(request);
  }

  private async *generateContentStreamInternal(
    request: GenerateContentParameters,
  ): AsyncGenerator<GenerateContentResponse> {
    const qwenRequest = this.convertGeminiToQwenRequest(request);
    qwenRequest.stream = true;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(qwenRequest),
    });

    if (!response.ok) {
      throw new Error(
        `Qwen API error: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6); // Remove 'data: ' prefix
          if (data.trim() === '[DONE]') {
            // Send final chunk with finishReason when stream ends
            yield {
              candidates: [
                {
                  content: {
                    parts: [],
                    role: 'model',
                  },
                  finishReason: 'STOP' as FinishReason,
                  index: 0,
                },
              ],
              text: '',
              functionCalls: [],
              executableCode: [],
              codeExecutionResult: [],
              data: '',
            } as unknown as GenerateContentResponse;
            continue;
          }

          try {
            const qwenChunk = JSON.parse(data);
            const geminiChunk =
              this.convertQwenStreamToGeminiResponse(qwenChunk);
            if (geminiChunk) {
              yield geminiChunk;
            }
          } catch (_e) {
            // Skip invalid JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Qwen doesn't support countTokens API, so we estimate
    const contents = request.contents || [];
    let totalChars = 0;

    // Handle both array and non-array contents
    const contentsArray = Array.isArray(contents) ? contents : [contents];

    for (const content of contentsArray) {
      // Handle different content types
      if (
        typeof content === 'object' &&
        content !== null &&
        'parts' in content
      ) {
        const contentWithParts = content as Content;
        const parts = contentWithParts.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            const textPart = part as Part;
            if (
              textPart &&
              typeof textPart === 'object' &&
              'text' in textPart &&
              typeof textPart.text === 'string'
            ) {
              totalChars += textPart.text.length;
            }
          }
        }
      } else if (typeof content === 'string') {
        totalChars += content.length;
      }
    }

    // Estimate: roughly 4 characters per token
    const estimatedTokens = Math.ceil(totalChars / 4);

    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // Qwen doesn't support embedContent, throw error for now
    throw new Error('EmbedContent is not supported for Qwen models');
  }

  private convertGeminiToQwenRequest(
    request: GenerateContentParameters,
  ): QwenRequest {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.contents) {
      // Handle different content types
      const contentsArray = Array.isArray(request.contents)
        ? request.contents
        : [request.contents];

      for (const content of contentsArray) {
        if (typeof content === 'object' && content !== null) {
          const contentObj = content as Content;
          const role = contentObj.role === 'user' ? 'user' : 'assistant';
          let messageContent = '';

          if ('parts' in contentObj) {
            const parts = contentObj.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                const textPart = part as Part;
                if (
                  textPart &&
                  typeof textPart === 'object' &&
                  'text' in textPart &&
                  typeof textPart.text === 'string'
                ) {
                  messageContent += textPart.text;
                }
              }
            }
          }

          if (messageContent) {
            messages.push({
              role,
              content: messageContent,
            });
          }
        }
      }
    }

    const qwenRequest: QwenRequest = {
      model: request.model,
      messages,
    };

    // Map generation config if present
    const reqWithConfig = request as GenerateContentParameters & {
      generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
        topP?: number;
      };
    };
    if (reqWithConfig.generationConfig) {
      const genConfig = reqWithConfig.generationConfig;
      if (genConfig.temperature !== undefined) {
        qwenRequest.temperature = genConfig.temperature;
      }
      if (genConfig.maxOutputTokens !== undefined) {
        qwenRequest.max_tokens = genConfig.maxOutputTokens;
      }
      if (genConfig.topP !== undefined) {
        qwenRequest.top_p = genConfig.topP;
      }
    }

    return qwenRequest;
  }

  private convertQwenToGeminiResponse(
    qwenResponse: QwenResponse,
  ): GenerateContentResponse {
    const choice = qwenResponse.choices?.[0];
    if (!choice) {
      throw new Error('No choices in qwen response');
    }

    const content = choice.message?.content || '';

    // Create a minimal response that satisfies the interface
    const response = {
      candidates: [
        {
          content: {
            parts: [{ text: content }],
            role: 'model',
          },
          finishReason: choice.finish_reason
            ? this.mapFinishReason(choice.finish_reason)
            : undefined,
        },
      ],
      usageMetadata: qwenResponse.usage
        ? {
            promptTokenCount: qwenResponse.usage.prompt_tokens || 0,
            candidatesTokenCount: qwenResponse.usage.completion_tokens || 0,
            totalTokenCount: qwenResponse.usage.total_tokens || 0,
          }
        : undefined,
      // Add required properties
      text: content,
      functionCalls: [],
      executableCode: [],
      codeExecutionResult: [],
      data: content, // Add missing data property
    };

    return response as unknown as GenerateContentResponse;
  }

  private convertQwenStreamToGeminiResponse(
    qwenChunk: QwenStreamChunk,
  ): GenerateContentResponse | null {
    const choice = qwenChunk.choices?.[0];
    if (!choice) {
      return null;
    }

    const delta = choice.delta;
    if (!delta?.content) {
      return null;
    }

    // Create a minimal response that satisfies the interface
    const response = {
      candidates: [
        {
          content: {
            parts: [{ text: delta.content }],
            role: 'model',
          },
          finishReason: choice.finish_reason
            ? this.mapFinishReason(choice.finish_reason)
            : undefined,
        },
      ],
      // Add required properties
      text: delta.content,
      functionCalls: [],
      executableCode: [],
      codeExecutionResult: [],
      data: delta.content, // Add missing data property
    };

    return response as unknown as GenerateContentResponse;
  }

  private mapFinishReason(qwenReason: string | undefined): FinishReason {
    if (!qwenReason) {
      return 'OTHER' as FinishReason;
    }

    switch (qwenReason) {
      case 'stop':
        return 'STOP' as FinishReason;
      case 'length':
        return 'MAX_TOKENS' as FinishReason;
      case 'content_filter':
        return 'SAFETY' as FinishReason;
      default:
        return 'OTHER' as FinishReason;
    }
  }
}
