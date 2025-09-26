# 自定义 API 格式支持

本文档说明如何使用 JoyCode 的多 API 格式支持功能，包括 OpenAI、Anthropic 和 Qwen（OpenAI-Compatible）格式。

## 概述

`CustomApiContentGenerator` 现在支持三种主要的 API 格式：

- **OpenAI**: 兼容 OpenAI GPT API 格式
- **Anthropic**: 兼容 Anthropic Claude API 格式
- **Qwen**: 兼容 Qwen 和其他 OpenAI-Compatible API 格式（默认）

## 环境变量配置

### 基础配置

```bash
# API 端点 URL
export GOOGLE_GEMINI_BASE_URL="https://your-api-endpoint.com"

# API 密钥
export GEMINI_API_KEY="your-api-key"

# API 格式选择（可选，默认为 QWEN）
export CUSTOM_API_FORMAT="OPENAI"  # 或 "ANTHROPIC" 或 "QWEN"
```

### OpenAI 格式配置

```bash
export GOOGLE_GEMINI_BASE_URL="https://api.openai.com"
export GEMINI_API_KEY="sk-your-openai-api-key"
export CUSTOM_API_FORMAT="OPENAI"
```

### Anthropic 格式配置

```bash
export GOOGLE_GEMINI_BASE_URL="https://api.anthropic.com"
export GEMINI_API_KEY="your-anthropic-api-key"
export CUSTOM_API_FORMAT="ANTHROPIC"
```

### Qwen 格式配置

```bash
export GOOGLE_GEMINI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
export GEMINI_API_KEY="your-qwen-api-key"
export CUSTOM_API_FORMAT="QWEN"  # 可选，这是默认值
```

## 功能特性

### 1. 自动格式转换

系统会自动在 Gemini 格式和目标 API 格式之间进行转换：

- **请求转换**: 将 Gemini `GenerateContentParameters` 转换为目标 API 格式
- **响应转换**: 将 API 响应转换回 Gemini `GenerateContentResponse` 格式
- **流式处理**: 支持所有格式的流式响应

### 2. Function Calling 支持

所有三种 API 格式都完全支持 function calling：

```javascript
// Gemini 格式的工具定义会自动转换为对应 API 格式
const tools = [
  {
    functionDeclarations: [
      {
        name: 'get_weather',
        description: '获取天气信息',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '城市名称' },
          },
          required: ['location'],
        },
      },
    ],
  },
];
```

### 3. 配置参数映射

系统会自动映射配置参数：

| Gemini 参数       | OpenAI 参数   | Anthropic 参数 | 说明           |
| ----------------- | ------------- | -------------- | -------------- |
| `maxOutputTokens` | `max_tokens`  | `max_tokens`   | 最大输出令牌数 |
| `temperature`     | `temperature` | `temperature`  | 温度参数       |
| `topP`            | `top_p`       | `top_p`        | Top-p 采样     |

## 使用示例

### 基本使用

```javascript
import { createContentGenerator } from '@google/genai/core';

// 系统会根据环境变量自动选择 API 格式
const generator = await createContentGenerator(config, gcConfig);

const response = await generator.generateContent({
  model: 'gpt-4', // 或 "claude-3-opus" 或 "qwen-max"
  contents: [
    {
      parts: [{ text: '你好，请介绍一下人工智能的发展历史。' }],
    },
  ],
});
```

### 流式生成

```javascript
const stream = await generator.generateContentStream({
  model: 'gpt-4-turbo',
  contents: [
    {
      parts: [{ text: '请写一篇关于机器学习的文章。' }],
    },
  ],
});

for await (const chunk of stream) {
  console.log(chunk.candidates[0].content.parts[0].text);
}
```

### Function Calling

```javascript
const response = await generator.generateContent({
  model: 'gpt-4',
  contents: [
    {
      parts: [{ text: '北京今天天气怎么样？' }],
    },
  ],
  tools: [
    {
      functionDeclarations: [
        {
          name: 'get_weather',
          description: '获取指定城市的天气信息',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: '城市名称' },
            },
            required: ['city'],
          },
        },
      ],
    },
  ],
});
```

## API 格式差异

### OpenAI 格式特点

- 使用 `messages` 数组结构
- 支持 `system`, `user`, `assistant` 角色
- Function calling 使用 `tools` 和 `tool_calls` 结构
- 流式响应使用 Server-Sent Events

### Anthropic 格式特点

- 使用 `messages` 数组，但结构略有不同
- 系统消息通过 `system` 参数单独传递
- Function calling 使用 `tools` 和 `tool_use` 结构
- 流式响应使用特定的事件类型

### Qwen 格式特点

- 兼容 OpenAI API 格式
- 支持通义千问系列模型
- 使用阿里云 DashScope 平台

## 错误处理

系统会自动处理各种错误情况：

- **网络错误**: 自动重试机制
- **API 格式错误**: 详细的错误信息和建议
- **认证错误**: 清晰的认证失败提示
- **限流错误**: 包含重试建议的错误信息

## 调试和日志

启用详细日志以调试 API 调用：

```bash
export DEBUG="gemini:*"
export LOG_LEVEL="debug"
```

## 最佳实践

1. **API 密钥安全**: 始终使用环境变量存储 API 密钥
2. **格式选择**: 根据实际使用的 API 服务选择正确的格式
3. **错误处理**: 实现适当的错误处理和重试逻辑
4. **性能优化**: 对于大量请求，考虑使用流式处理
5. **测试**: 在生产环境使用前充分测试所有功能

## 故障排除

### 常见问题

1. **认证失败**
   - 检查 API 密钥是否正确
   - 确认 API 端点 URL 是否正确

2. **格式不兼容**
   - 确认 `CUSTOM_API_FORMAT` 环境变量设置正确
   - 检查 API 端点是否支持指定格式

3. **Function Calling 失败**
   - 确认 API 服务支持 function calling
   - 检查工具定义格式是否正确

### 获取帮助

如果遇到问题，请：

1. 检查环境变量配置
2. 查看详细错误日志
3. 参考 API 服务提供商的文档
4. 提交 issue 到项目仓库

## 更新日志

- **v1.0.0**: 初始版本，支持 Qwen 格式
- **v2.0.0**: 添加 OpenAI 和 Anthropic 格式支持
- **v2.1.0**: 完善 function calling 功能
- **v2.2.0**: 优化错误处理和日志记录
