/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 工具调用格式转换器 - TypeScript版本
 * 自动识别并转换错误的工具调用格式为正确格式
 */

interface ConversionResult {
  success: boolean;
  original: string;
  converted?: string;
  modified: boolean;
  toolCalls: ToolCallResult[];
  error?: string;
}

interface ToolCallResult {
  original: string;
  toolName: string;
  needsConversion: boolean;
  conversion?: {
    success: boolean;
    converted?: string;
    toolName?: string;
    changes?: string[];
    error?: string;
  };
  isCorrect: boolean;
}

interface ToolCall {
  toolName: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

interface ToolStructure {
  wrapper: string | null;
  structure: (params: Record<string, unknown>) => Record<string, unknown>;
}

export class ToolFormatConverter {
  private toolNameMap: Record<string, string> = {
    read_file: 'use_read_file',
    write_file: 'use_write_file',
    list_files: 'use_list_files',
    search_files: 'use_search_files',
    command: 'use_command',
    search_and_replace: 'use_search_and_replace',
    definition_names: 'use_definition_names',
    codebase: 'use_codebase',
    web_search: 'use_web_search',
    mcp_tools: 'use_mcp_tools',
    clear_publish: 'use_clear_publish',
    // 支持其他AI系统的工具调用格式
    function_calls: 'use_read_file', // 默认映射到读取文件
    str_replace_editor: 'use_read_file', // str_replace_editor的view命令映射到读取文件
  };

  private toolStructureMap: Record<string, ToolStructure> = {
    use_read_file: {
      wrapper: 'args',
      structure: (params: Record<string, unknown>) => ({
        file: {
          path: params['path'],
          line_range: params['line_range'],
        },
      }),
    },
    use_write_file: {
      wrapper: null,
      structure: (params: Record<string, unknown>) => params,
    },
    use_list_files: {
      wrapper: null,
      structure: (params: Record<string, unknown>) => params,
    },
    use_search_files: {
      wrapper: null,
      structure: (params: Record<string, unknown>) => params,
    },
    use_command: {
      wrapper: null,
      structure: (params: Record<string, unknown>) => params,
    },
    use_search_and_replace: {
      wrapper: null,
      structure: (params: Record<string, unknown>) => params,
    },
    apply_diff: {
      wrapper: null,
      structure: (params: Record<string, unknown>) => params,
    },
    insert_content: {
      wrapper: null,
      structure: (params: Record<string, unknown>) => params,
    },
  };

  /**
   * 主要的拦截和转换方法
   */
  intercept(modelOutput: string): ConversionResult {
    try {
      // 检测是否包含工具调用
      const toolCalls = this.detectToolCalls(modelOutput);

      if (toolCalls.length === 0) {
        return {
          success: true,
          modified: false,
          original: modelOutput,
          converted: modelOutput,
          toolCalls: [],
        };
      }

      // 分析并转换工具调用
      const conversionResults = this.processToolCalls(toolCalls);

      // 替换原始输出中的工具调用
      let processedOutput = modelOutput;
      let hasModifications = false;

      conversionResults.forEach((result) => {
        if (result.needsConversion && result.conversion?.success) {
          processedOutput = processedOutput.replace(
            result.original,
            result.conversion.converted!,
          );
          hasModifications = true;
        }
      });

      return {
        success: true,
        modified: hasModifications,
        original: modelOutput,
        converted: processedOutput,
        toolCalls: conversionResults,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        original: modelOutput,
        converted: modelOutput,
        modified: false,
        toolCalls: [],
      };
    }
  }

  /**
   * 检测文本中的工具调用
   */
  private detectToolCalls(text: string): ToolCall[] {
    const matches: ToolCall[] = [];

    // 检测标准格式的工具调用
    const standardToolCallRegex = /<(\w+)>[\s\S]*?<\/\1>/g;
    let match;

    while ((match = standardToolCallRegex.exec(text)) !== null) {
      const toolName = match[1];
      const fullMatch = match[0];

      matches.push({
        toolName,
        content: fullMatch,
        startIndex: match.index,
        endIndex: match.index + fullMatch.length,
      });
    }

    // 检测function_calls格式
    const functionCallsRegex = /<function_calls>[\s\S]*?<\/function_calls>/g;
    while ((match = functionCallsRegex.exec(text)) !== null) {
      const fullMatch = match[0];
      matches.push({
        toolName: 'function_calls',
        content: fullMatch,
        startIndex: match.index,
        endIndex: match.index + fullMatch.length,
      });
    }

    return matches;
  }

  /**
   * 处理工具调用数组
   */
  private processToolCalls(toolCalls: ToolCall[]): ToolCallResult[] {
    return toolCalls.map((toolCall) => {
      const needsConversion = this.needsConversion(toolCall.toolName);

      let conversion: ToolCallResult['conversion'] = undefined;
      if (needsConversion) {
        conversion = this.convert(toolCall.content);
      }

      return {
        original: toolCall.content,
        toolName: toolCall.toolName,
        needsConversion,
        conversion,
        isCorrect: !needsConversion,
      };
    });
  }

  /**
   * 判断工具调用是否需要转换
   */
  private needsConversion(toolName: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.toolNameMap, toolName);
  }

  /**
   * 转换单个工具调用
   */
  private convert(inputXML: string): {
    success: boolean;
    converted?: string;
    toolName?: string;
    changes?: string[];
    error?: string;
  } {
    try {
      // 解析输入的XML
      const { toolName: originalName, params } =
        this.parseXMLToolCall(inputXML);

      // 转换工具名称
      const correctToolName = this.convertToolName(originalName);

      // 构建正确的XML
      const correctXML = this.buildCorrectXML(correctToolName, params);

      return {
        success: true,
        converted: correctXML,
        toolName: correctToolName,
        changes:
          originalName !== correctToolName
            ? [`工具名称: ${originalName} → ${correctToolName}`]
            : [],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 解析XML格式的工具调用
   */
  private parseXMLToolCall(xmlString: string): {
    toolName: string;
    params: Record<string, unknown>;
  } {
    // 检查是否是function_calls格式
    if (xmlString.includes('<function_calls>')) {
      return this.parseFunctionCallsFormat(xmlString);
    }

    // 标准格式解析
    const toolCallRegex = /<(\w+)>([\s\S]*?)<\/\1>/;
    const match = xmlString.match(toolCallRegex);

    if (!match) {
      throw new Error('无效的XML格式');
    }

    const toolName = match[1];
    const content = match[2].trim();

    // 解析参数
    const params: Record<string, unknown> = {};
    const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let paramMatch;

    while ((paramMatch = paramRegex.exec(content)) !== null) {
      const paramName = paramMatch[1];
      const paramValue = paramMatch[2].trim();
      params[paramName] = paramValue;
    }

    return { toolName, params };
  }

  /**
   * 解析function_calls格式
   */
  private parseFunctionCallsFormat(xmlString: string): {
    toolName: string;
    params: Record<string, unknown>;
  } {
    const params: Record<string, unknown> = {};

    // 提取invoke name
    const invokeMatch = xmlString.match(/<invoke name="([^"]+)"/);
    if (invokeMatch) {
      const invokeName = invokeMatch[1];

      // 根据invoke name确定工具类型
      if (invokeName === 'str_replace_editor') {
        // 解析str_replace_editor的参数
        const commandMatch = xmlString.match(
          /<parameter name="command">([^<]+)<\/parameter>/,
        );
        const pathMatch = xmlString.match(
          /<parameter name="path">([^<]+)<\/parameter>/,
        );

        if (commandMatch && pathMatch) {
          const command = commandMatch[1];
          let path = pathMatch[1];

          // 转换绝对路径为相对路径
          const projectPath = '/Users/jiangqi147/github/gemini-cli/';
          if (path.startsWith(projectPath)) {
            path = path.substring(projectPath.length);
          }

          switch (command) {
            case 'view': {
              params['path'] = path;
              return { toolName: 'use_read_file', params };
            }

            case 'create': {
              const fileTextMatch = xmlString.match(
                /<parameter name="file_text">([\s\S]*?)<\/parameter>/,
              );
              if (fileTextMatch) {
                params['path'] = path;
                params['content'] = fileTextMatch[1];
                // 计算行数
                const lines = fileTextMatch[1].split('\n');
                params['line_count'] = lines.length;
                return { toolName: 'use_write_file', params };
              }
              break;
            }

            case 'str_replace': {
              const oldStrMatch = xmlString.match(
                /<parameter name="old_str">([\s\S]*?)<\/parameter>/,
              );
              const newStrMatch = xmlString.match(
                /<parameter name="new_str">([\s\S]*?)<\/parameter>/,
              );

              if (oldStrMatch && newStrMatch) {
                params['path'] = path;
                params['search'] = oldStrMatch[1];
                params['replace'] = newStrMatch[1];
                return { toolName: 'use_search_and_replace', params };
              }
              break;
            }

            default: {
              // 未知命令，返回原始格式
              break;
            }
          }
        }
      }
    }

    return { toolName: 'function_calls', params };
  }

  /**
   * 转换工具名称
   */
  private convertToolName(originalName: string): string {
    return this.toolNameMap[originalName] || originalName;
  }

  /**
   * 构建正确的XML结构
   */
  private buildCorrectXML(
    toolName: string,
    params: Record<string, unknown>,
  ): string {
    const structure = this.toolStructureMap[toolName];

    if (!structure) {
      // 默认结构
      return this.buildDefaultXML(toolName, params);
    }

    let xml = `<${toolName}>\n`;

    if (structure.wrapper) {
      xml += `<${structure.wrapper}>\n`;
      const structuredParams = structure.structure(params);
      xml += this.buildNestedXML(structuredParams, 1);
      xml += `</${structure.wrapper}>\n`;
    } else {
      const structuredParams = structure.structure(params);
      xml += this.buildFlatXML(structuredParams);
    }

    xml += `</${toolName}>`;

    return xml;
  }

  /**
   * 构建嵌套XML结构
   */
  private buildNestedXML(obj: Record<string, unknown>, indent = 0): string {
    let xml = '';
    const spaces = '  '.repeat(indent);

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        xml += `${spaces}<${key}>\n`;
        xml += this.buildNestedXML(
          value as Record<string, unknown>,
          indent + 1,
        );
        xml += `${spaces}</${key}>\n`;
      } else if (value !== undefined && value !== null) {
        xml += `${spaces}<${key}>${value}</${key}>\n`;
      }
    }

    return xml;
  }

  /**
   * 构建平铺XML结构
   */
  private buildFlatXML(params: Record<string, unknown>): string {
    let xml = '';
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        xml += `<${key}>${value}</${key}>\n`;
      }
    }
    return xml;
  }

  /**
   * 构建默认XML结构
   */
  private buildDefaultXML(
    toolName: string,
    params: Record<string, unknown>,
  ): string {
    let xml = `<${toolName}>\n`;
    xml += this.buildFlatXML(params);
    xml += `</${toolName}>`;
    return xml;
  }
}

/**
 * 便捷函数：自动修正模型输出
 */
export function autoFixToolCalls(modelOutput: string): string {
  const converter = new ToolFormatConverter();
  const result = converter.intercept(modelOutput);
  return result.success && result.converted ? result.converted : modelOutput;
}
