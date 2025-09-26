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
import { autoFixToolCalls } from './toolFormatConverter.js';

// API Format Types
export enum ApiFormat {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  QWEN = 'qwen', // Qwen uses OpenAI-compatible format
}

// OpenAI API Types (also used by Qwen)
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  tool_choice?:
    | 'none'
    | 'auto'
    | { type: 'function'; function: { name: string } };
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
      role?: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      role?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

// Anthropic API Types
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<{
        type: 'text' | 'tool_use' | 'tool_result';
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
        content?: string;
        tool_use_id?: string;
      }>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema?: Record<string, unknown>;
  }>;
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
}

interface AnthropicResponse {
  content?: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  stop_reason?: string;
}

interface AnthropicStreamChunk {
  type: string;
  content_block?: {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class CustomApiContentGenerator implements ContentGenerator {
  private baseUrl: string;
  private apiKey: string;
  private apiFormat: ApiFormat;

  constructor(
    baseUrl: string,
    apiKey: string,
    apiFormat: ApiFormat = ApiFormat.QWEN,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
    this.apiKey = apiKey;
    this.apiFormat = apiFormat;
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    // Respect user's explicit API format choice first
    if (this.apiFormat === ApiFormat.ANTHROPIC) {
      return this.generateContentAnthropic(request);
    }

    // For third-party services like Qwen, use OpenAI format by default
    // unless user explicitly requested Anthropic format
    const isThirdPartyService = !this.baseUrl.includes('api.anthropic.com');

    if (
      this.apiFormat === ApiFormat.OPENAI ||
      this.apiFormat === ApiFormat.QWEN ||
      (isThirdPartyService && this.apiFormat !== ApiFormat.ANTHROPIC)
    ) {
      return this.generateContentOpenAI(request);
    } else {
      return this.generateContentAnthropic(request);
    }
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // Respect user's explicit API format choice first
    if (this.apiFormat === ApiFormat.ANTHROPIC) {
      return this.generateContentStreamAnthropic(request);
    }

    // For third-party services like Qwen, use OpenAI format by default
    // unless user explicitly requested Anthropic format
    const isThirdPartyService = !this.baseUrl.includes('api.anthropic.com');

    if (
      this.apiFormat === ApiFormat.OPENAI ||
      this.apiFormat === ApiFormat.QWEN ||
      (isThirdPartyService && this.apiFormat !== ApiFormat.ANTHROPIC)
    ) {
      return this.generateContentStreamOpenAI(request);
    } else {
      return this.generateContentStreamAnthropic(request);
    }
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Most custom APIs don't support countTokens API, so we estimate
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
    // Custom APIs don't support embedContent, throw error for now
    throw new Error('EmbedContent is not supported for custom API models');
  }

  // OpenAI/Qwen API Implementation (unified since Qwen supports OpenAI format)
  private async generateContentOpenAI(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const openaiRequest = this.convertGeminiToOpenAIRequest(request);
    openaiRequest.stream = false;

    // Use user provided baseUrl directly, add /chat/completions if not present
    const endpoint = this.baseUrl.endsWith('/chat/completions')
      ? this.baseUrl
      : `${this.baseUrl}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API error: ${response.status} ${response.statusText}. Details: ${errorText}`,
      );
    }

    const openaiResponse: OpenAIResponse = await response.json();
    return this.convertOpenAIToGeminiResponse(openaiResponse);
  }

  private async *generateContentStreamOpenAI(
    request: GenerateContentParameters,
  ): AsyncGenerator<GenerateContentResponse> {
    const openaiRequest = this.convertGeminiToOpenAIRequest(request);
    openaiRequest.stream = true;

    // Use user provided baseUrl directly, add /chat/completions if not present
    const endpoint = this.baseUrl.endsWith('/chat/completions')
      ? this.baseUrl
      : `${this.baseUrl}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API error: ${response.status} ${response.statusText}. Details: ${errorText}`,
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

          const data = line.slice(6);
          if (data.trim() === '[DONE]') {
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
            const openaiChunk = JSON.parse(data);
            const geminiChunk =
              this.convertOpenAIStreamToGeminiResponse(openaiChunk);
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

  private convertGeminiToOpenAIRequest(
    request: GenerateContentParameters,
  ): OpenAIRequest {
    const messages: OpenAIMessage[] = [];
    let systemMessage = '';

    // Extract system instruction
    const requestWithSystem = request as GenerateContentParameters & {
      systemInstruction?: string | { parts: Array<{ text?: string }> };
    };
    if (requestWithSystem.systemInstruction) {
      if (typeof requestWithSystem.systemInstruction === 'string') {
        systemMessage = requestWithSystem.systemInstruction;
      } else if ('parts' in requestWithSystem.systemInstruction) {
        const parts = requestWithSystem.systemInstruction.parts;
        if (Array.isArray(parts)) {
          systemMessage = parts.map((part) => part.text || '').join('');
        }
      }
    }

    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage,
      });
    }

    // Convert contents
    if (request.contents) {
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
                if ('text' in part && typeof part.text === 'string') {
                  messageContent += part.text;
                } else if ('functionCall' in part && part.functionCall) {
                  // Handle function calls
                  const functionCall = part.functionCall as {
                    name?: string;
                    args?: Record<string, unknown>;
                  };
                  messages.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: `call_${Date.now()}`,
                        type: 'function',
                        function: {
                          name: functionCall.name || '',
                          arguments: JSON.stringify(functionCall.args || {}),
                        },
                      },
                    ],
                  });
                  continue;
                } else if (
                  'functionResponse' in part &&
                  part.functionResponse
                ) {
                  // Handle function responses
                  const functionResponse = part.functionResponse as {
                    name: string;
                    response: unknown;
                  };
                  messages.push({
                    role: 'tool',
                    tool_call_id: `call_${Date.now()}`,
                    name: functionResponse.name,
                    content: JSON.stringify(functionResponse.response),
                  });
                  continue;
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

    const openaiRequest: OpenAIRequest = {
      model: request.model,
      messages,
    };

    // Map generation config
    const requestWithConfig = request as GenerateContentParameters & {
      config?: {
        temperature?: number;
        maxOutputTokens?: number;
        topP?: number;
      };
      generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
        topP?: number;
      };
    };
    const config =
      requestWithConfig.config || requestWithConfig.generationConfig;
    if (config) {
      if (config.temperature !== undefined) {
        openaiRequest.temperature = config.temperature;
      }
      if (config.maxOutputTokens !== undefined) {
        openaiRequest.max_tokens = config.maxOutputTokens;
      }
      if (config.topP !== undefined) {
        openaiRequest.top_p = config.topP;
      }
    }

    // Map tools if present
    const requestWithTools = request as GenerateContentParameters & {
      tools?: Array<{
        functionDeclarations?: Array<{
          name?: string;
          description?: string;
          parameters?: Record<string, unknown>;
        }>;
      }>;
    };
    if (requestWithTools.tools && requestWithTools.tools.length > 0) {
      openaiRequest.tools = requestWithTools.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.functionDeclarations?.[0]?.name || '',
          description: tool.functionDeclarations?.[0]?.description,
          parameters: tool.functionDeclarations?.[0]?.parameters,
        },
      }));
      openaiRequest.tool_choice = 'auto';
    }

    return openaiRequest;
  }

  private convertOpenAIToGeminiResponse(
    openaiResponse: OpenAIResponse,
  ): GenerateContentResponse {
    const choice = openaiResponse.choices?.[0];
    if (!choice) {
      throw new Error('No choices in API response');
    }

    const message = choice.message;
    const parts: Part[] = [];

    // Handle text content with automatic tool call format correction
    if (message?.content) {
      // Apply automatic tool call format correction
      const correctedContent = autoFixToolCalls(message.content);
      parts.push({ text: correctedContent });
    }

    // Handle tool calls - only include valid tool calls with names
    if (message?.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.function.name && toolCall.function.name.trim() !== '') {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments || '{}'),
            },
          } as Part);
        }
      }
    }

    const response = {
      candidates: [
        {
          content: {
            parts,
            role: 'model',
          },
          finishReason: this.mapFinishReason(choice.finish_reason),
          index: 0,
        },
      ],
      usageMetadata: openaiResponse.usage
        ? {
            promptTokenCount: openaiResponse.usage.prompt_tokens || 0,
            candidatesTokenCount: openaiResponse.usage.completion_tokens || 0,
            totalTokenCount: openaiResponse.usage.total_tokens || 0,
          }
        : undefined,
      text: message?.content ? autoFixToolCalls(message.content) : '',
      functionCalls:
        message?.tool_calls
          ?.filter((tc) => tc.function.name && tc.function.name.trim() !== '')
          .map((tc) => ({
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}'),
          })) || [],
      executableCode: [],
      codeExecutionResult: [],
      data: message?.content ? autoFixToolCalls(message.content) : '',
    };

    return response as unknown as GenerateContentResponse;
  }

  private convertOpenAIStreamToGeminiResponse(
    openaiChunk: OpenAIStreamChunk,
  ): GenerateContentResponse | null {
    const choice = openaiChunk.choices?.[0];
    if (!choice) {
      return null;
    }

    const delta = choice.delta;
    // Skip chunks that have no content and no valid tool calls
    if (
      !delta?.content &&
      (!delta?.tool_calls || !this.hasValidToolCalls(delta.tool_calls))
    ) {
      return null;
    }

    const parts: Part[] = [];

    if (delta.content) {
      // Apply automatic tool call format correction for streaming content
      const correctedContent = autoFixToolCalls(delta.content);
      parts.push({ text: correctedContent });
    }

    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const toolCall of delta.tool_calls) {
        // Only process tool calls with valid names
        if (toolCall.function?.name && toolCall.function.name.trim() !== '') {
          let args = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch (_e) {
            // Skip invalid JSON in streaming chunks
            continue;
          }
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args,
            },
          } as Part);
        }
      }
    }

    const response = {
      candidates: [
        {
          content: {
            parts,
            role: 'model',
          },
          finishReason: choice.finish_reason
            ? this.mapFinishReason(choice.finish_reason)
            : undefined,
        },
      ],
      text: delta.content ? autoFixToolCalls(delta.content) : '',
      functionCalls:
        delta.tool_calls
          ?.filter((tc) => tc.function?.name && tc.function.name.trim() !== '')
          .map((tc) => ({
            name: tc.function!.name,
            args: JSON.parse(tc.function!.arguments || '{}'),
          })) || [],
      executableCode: [],
      codeExecutionResult: [],
      data: delta.content ? autoFixToolCalls(delta.content) : '',
    };

    return response as unknown as GenerateContentResponse;
  }

  private hasValidToolCalls(
    toolCalls: Array<{ function?: { name?: string } }>,
  ): boolean {
    return toolCalls.some(
      (tc) => tc.function?.name && tc.function.name.trim() !== '',
    );
  }

  private mapFinishReason(reason: string | undefined): FinishReason {
    if (!reason) {
      return 'OTHER' as FinishReason;
    }

    switch (reason) {
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

  // Anthropic API Implementation
  private async generateContentAnthropic(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const anthropicRequest = this.convertGeminiToAnthropicRequest(request);
    anthropicRequest.stream = false;

    // Use user provided baseUrl directly
    const endpoint = this.baseUrl.endsWith('/messages')
      ? this.baseUrl
      : `${this.baseUrl}/v1/messages`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText}. Details: ${errorText}`,
      );
    }

    const anthropicResponse: AnthropicResponse = await response.json();
    return this.convertAnthropicToGeminiResponse(anthropicResponse);
  }

  private async *generateContentStreamAnthropic(
    request: GenerateContentParameters,
  ): AsyncGenerator<GenerateContentResponse> {
    const anthropicRequest = this.convertGeminiToAnthropicRequest(request);
    anthropicRequest.stream = true;

    // Use user provided baseUrl directly
    const endpoint = this.baseUrl.endsWith('/messages')
      ? this.baseUrl
      : `${this.baseUrl}/v1/messages`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText}. Details: ${errorText}`,
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

          const data = line.slice(6);
          if (data.trim() === '[DONE]') {
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
            const anthropicChunk = JSON.parse(data);
            const geminiChunk =
              this.convertAnthropicStreamToGeminiResponse(anthropicChunk);
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

  private convertGeminiToAnthropicRequest(
    request: GenerateContentParameters,
  ): AnthropicRequest {
    const messages: AnthropicMessage[] = [];
    let systemMessage = '';

    // Extract system instruction
    const requestWithSystem = request as GenerateContentParameters & {
      systemInstruction?: string | { parts: Array<{ text?: string }> };
    };
    if (requestWithSystem.systemInstruction) {
      if (typeof requestWithSystem.systemInstruction === 'string') {
        systemMessage = requestWithSystem.systemInstruction;
      } else if ('parts' in requestWithSystem.systemInstruction) {
        const parts = requestWithSystem.systemInstruction.parts;
        if (Array.isArray(parts)) {
          systemMessage = parts.map((part) => part.text || '').join('');
        }
      }
    }

    // Convert contents
    if (request.contents) {
      const contentsArray = Array.isArray(request.contents)
        ? request.contents
        : [request.contents];

      for (const content of contentsArray) {
        if (typeof content === 'object' && content !== null) {
          const contentObj = content as Content;
          const role = contentObj.role === 'user' ? 'user' : 'assistant';
          const contentBlocks: Array<{
            type: 'text' | 'tool_use' | 'tool_result';
            text?: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
            tool_use_id?: string;
            content?: string;
          }> = [];

          if ('parts' in contentObj) {
            const parts = contentObj.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if ('text' in part && typeof part.text === 'string') {
                  contentBlocks.push({
                    type: 'text',
                    text: part.text,
                  });
                } else if ('functionCall' in part && part.functionCall) {
                  // Handle function calls
                  const functionCall = part.functionCall as {
                    name: string;
                    args?: Record<string, unknown>;
                  };
                  contentBlocks.push({
                    type: 'tool_use',
                    id: `tool_${Date.now()}`,
                    name: functionCall.name,
                    input: functionCall.args || {},
                  });
                } else if (
                  'functionResponse' in part &&
                  part.functionResponse
                ) {
                  // Handle function responses
                  const functionResponse = part.functionResponse as {
                    response: unknown;
                  };
                  contentBlocks.push({
                    type: 'tool_result',
                    tool_use_id: `tool_${Date.now()}`,
                    content: JSON.stringify(functionResponse.response),
                  });
                }
              }
            }
          }

          if (contentBlocks.length > 0) {
            messages.push({
              role,
              content: contentBlocks,
            });
          }
        }
      }
    }

    // Use the model name directly as provided by the user
    const modelName = request.model;

    // Validate and fix messages for Anthropic API requirements
    const validatedMessages: AnthropicMessage[] = [];
    let lastRole: string | null = null;

    for (const message of messages) {
      // Skip empty messages
      if (
        !message.content ||
        (Array.isArray(message.content) && message.content.length === 0) ||
        (typeof message.content === 'string' && message.content.trim() === '')
      ) {
        continue;
      }

      // Ensure alternating roles - if same role appears twice, merge content
      if (lastRole === message.role && validatedMessages.length > 0) {
        const lastMessage = validatedMessages[validatedMessages.length - 1];
        if (
          Array.isArray(lastMessage.content) &&
          Array.isArray(message.content)
        ) {
          lastMessage.content.push(...message.content);
        } else if (
          typeof lastMessage.content === 'string' &&
          typeof message.content === 'string'
        ) {
          lastMessage.content += '\n' + message.content;
        }
      } else {
        validatedMessages.push(message);
        lastRole = message.role;
      }
    }

    // Ensure first message is from user
    if (validatedMessages.length > 0 && validatedMessages[0].role !== 'user') {
      validatedMessages.unshift({
        role: 'user',
        content: 'Please respond to the following.',
      });
    }

    // Ensure we have at least one message
    if (validatedMessages.length === 0) {
      validatedMessages.push({
        role: 'user',
        content: 'Hello',
      });
    }

    const anthropicRequest: AnthropicRequest = {
      model: modelName,
      messages: validatedMessages,
      max_tokens: 4096, // Required for Anthropic
    };

    if (systemMessage) {
      anthropicRequest.system = systemMessage;
    }

    // Map generation config
    const requestWithConfig = request as GenerateContentParameters & {
      config?: {
        temperature?: number;
        maxOutputTokens?: number;
        topP?: number;
      };
      generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
        topP?: number;
      };
    };
    const config =
      requestWithConfig.config || requestWithConfig.generationConfig;
    if (config) {
      if (config.temperature !== undefined) {
        anthropicRequest.temperature = config.temperature;
      }
      if (config.maxOutputTokens !== undefined) {
        anthropicRequest.max_tokens = config.maxOutputTokens;
      }
      if (config.topP !== undefined) {
        anthropicRequest.top_p = config.topP;
      }
    }

    // Map tools if present
    const requestWithToolsAnthropic = request as GenerateContentParameters & {
      tools?: Array<{
        functionDeclarations?: Array<{
          name?: string;
          description?: string;
          parameters?: Record<string, unknown>;
        }>;
      }>;
    };
    if (
      requestWithToolsAnthropic.tools &&
      requestWithToolsAnthropic.tools.length > 0
    ) {
      anthropicRequest.tools = requestWithToolsAnthropic.tools.map((tool) => ({
        name: tool.functionDeclarations?.[0]?.name || '',
        description: tool.functionDeclarations?.[0]?.description,
        input_schema: tool.functionDeclarations?.[0]?.parameters,
      }));
      anthropicRequest.tool_choice = { type: 'auto' };
    }

    return anthropicRequest;
  }

  private convertAnthropicToGeminiResponse(
    anthropicResponse: AnthropicResponse,
  ): GenerateContentResponse {
    const parts: Part[] = [];
    let textContent = '';

    if (anthropicResponse.content) {
      for (const contentBlock of anthropicResponse.content) {
        if (contentBlock.type === 'text' && contentBlock.text) {
          // Apply automatic tool call format correction
          const correctedText = autoFixToolCalls(contentBlock.text);
          parts.push({ text: correctedText });
          textContent += correctedText;
        } else if (
          contentBlock.type === 'tool_use' &&
          contentBlock.name &&
          contentBlock.name.trim() !== ''
        ) {
          parts.push({
            functionCall: {
              name: contentBlock.name,
              args: contentBlock.input || {},
            },
          } as Part);
        }
      }
    }

    const response = {
      candidates: [
        {
          content: {
            parts,
            role: 'model',
          },
          finishReason: this.mapAnthropicFinishReason(
            anthropicResponse.stop_reason,
          ),
          index: 0,
        },
      ],
      usageMetadata: anthropicResponse.usage
        ? {
            promptTokenCount: anthropicResponse.usage.input_tokens || 0,
            candidatesTokenCount: anthropicResponse.usage.output_tokens || 0,
            totalTokenCount:
              (anthropicResponse.usage.input_tokens || 0) +
              (anthropicResponse.usage.output_tokens || 0),
          }
        : undefined,
      text: textContent,
      functionCalls:
        anthropicResponse.content
          ?.filter(
            (c) => c.type === 'tool_use' && c.name && c.name.trim() !== '',
          )
          .map((c) => ({
            name: c.name!,
            args: c.input || {},
          })) || [],
      executableCode: [],
      codeExecutionResult: [],
      data: textContent,
    };

    return response as unknown as GenerateContentResponse;
  }

  private convertAnthropicStreamToGeminiResponse(
    anthropicChunk: AnthropicStreamChunk,
  ): GenerateContentResponse | null {
    const parts: Part[] = [];
    let textContent = '';

    if (
      anthropicChunk.type === 'content_block_start' &&
      anthropicChunk.content_block
    ) {
      if (anthropicChunk.content_block.type === 'text') {
        // Initial text block
        return null;
      } else if (
        anthropicChunk.content_block.type === 'tool_use' &&
        anthropicChunk.content_block.name &&
        anthropicChunk.content_block.name.trim() !== ''
      ) {
        parts.push({
          functionCall: {
            name: anthropicChunk.content_block.name,
            args: anthropicChunk.content_block.input || {},
          },
        } as Part);
      }
    } else if (
      anthropicChunk.type === 'content_block_delta' &&
      anthropicChunk.delta
    ) {
      if (
        anthropicChunk.delta.type === 'text_delta' &&
        anthropicChunk.delta.text
      ) {
        // Apply automatic tool call format correction for streaming content
        const correctedText = autoFixToolCalls(anthropicChunk.delta.text);
        parts.push({ text: correctedText });
        textContent = correctedText;
      }
    }

    if (parts.length === 0) {
      return null;
    }

    const response = {
      candidates: [
        {
          content: {
            parts,
            role: 'model',
          },
          finishReason: undefined,
        },
      ],
      text: textContent,
      functionCalls: [],
      executableCode: [],
      codeExecutionResult: [],
      data: textContent,
    };

    return response as unknown as GenerateContentResponse;
  }

  private mapAnthropicFinishReason(reason: string | undefined): FinishReason {
    if (!reason) {
      return 'OTHER' as FinishReason;
    }

    switch (reason) {
      case 'end_turn':
        return 'STOP' as FinishReason;
      case 'max_tokens':
        return 'MAX_TOKENS' as FinishReason;
      case 'stop_sequence':
        return 'STOP' as FinishReason;
      case 'tool_use':
        return 'STOP' as FinishReason;
      default:
        return 'OTHER' as FinishReason;
    }
  }
}
