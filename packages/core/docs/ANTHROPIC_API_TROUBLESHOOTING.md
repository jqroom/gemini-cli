# Anthropic API 故障排除指南

本文档提供了使用 Anthropic Claude API 时常见问题的解决方案。

## 快速配置检查清单

### 1. 环境变量配置

确保正确设置了以下环境变量：

```bash
# Anthropic API 端点
export GOOGLE_GEMINI_BASE_URL="https://api.anthropic.com"

# Anthropic API 密钥
export GEMINI_API_KEY="your-anthropic-api-key"

# 指定使用 Anthropic 格式
export CUSTOM_API_FORMAT="ANTHROPIC"
```

### 2. API 密钥获取

1. 访问 [Anthropic Console](https://console.anthropic.com/)
2. 创建账户或登录
3. 生成 API 密钥
4. 确保账户有足够的余额或配额

### 3. 模型名称

**智能模型名称映射**：

系统会根据 API 端点自动处理模型名称：

**官方 Anthropic API** (`api.anthropic.com`)：

- `Claude-sonnet-4` → `claude-3-5-sonnet-20241022`
- `claude-3-haiku` → `claude-3-haiku-20240307`
- `claude-3-opus` → `claude-3-opus-20240229`
- 其他包含 `claude` 或 `sonnet` 的名称 → `claude-3-5-sonnet-20241022`

## 常见错误及解决方案

### 错误 1: "400 Bad Request"

**可能原因**：

- API 密钥无效或未设置
- 模型名称不正确
- 请求格式不符合 Anthropic API 规范

**解决方案**：

1. 检查 API 密钥是否正确设置：

   ```bash
   echo $GEMINI_API_KEY
   ```

2. 验证 API 密钥格式（应以 `sk-ant-` 开头）

3. 检查模型名称，使用支持的模型：

   ```bash
   # 推荐使用
   npm start chat --model claude-3-5-sonnet
   ```

4. 查看详细错误日志：
   ```bash
   # 启用调试模式
   DEBUG=* npm start chat --model claude-3-5-sonnet
   ```

### 错误 2: "401 Unauthorized"

**原因**: API 密钥无效

**解决方案**：

1. 重新生成 API 密钥
2. 检查密钥是否正确复制（没有额外空格）
3. 确认账户状态正常

### 错误 3: "429 Too Many Requests"

**原因**: 超出 API 限制

**解决方案**：

1. 检查 API 使用配额
2. 等待一段时间后重试
3. 考虑升级 API 计划

### 错误 4: "Network Error"

**原因**: 网络连接问题

**解决方案**：

1. 检查网络连接
2. 验证防火墙设置
3. 尝试使用代理（如果需要）：
   ```bash
   export https_proxy=http://your-proxy:port
   ```

## 调试步骤

### 1. 启用详细日志

```bash
# 设置调试环境变量
export DEBUG="*"
export LOG_LEVEL="debug"

# 运行命令
npm start chat --model claude-3-5-sonnet --sandbox
```

### 2. 检查请求详情

修复后的代码会在控制台输出详细的错误信息，包括：

- HTTP 状态码
- 错误响应内容
- 请求体内容
- 请求头信息

### 3. 验证配置

```bash
# 检查所有相关环境变量
env | grep -E "(GOOGLE_GEMINI_BASE_URL|GEMINI_API_KEY|CUSTOM_API_FORMAT)"
```

## 测试配置

### 基本测试

```bash
# 简单对话测试
npm start chat --model claude-3-5-sonnet --sandbox

# 在聊天中输入
Hello, can you help me test the API connection?
```

### Function Calling 测试

```bash
# 测试工具调用功能
npm start chat --model claude-3-5-sonnet --sandbox

# 在聊天中输入
Can you help me list the files in the current directory?
```

## 性能优化建议

### 1. 选择合适的模型

- **Claude 3.5 Sonnet**: 平衡性能和速度，适合大多数任务
- **Claude 3 Haiku**: 更快响应，适合简单任务
- **Claude 3 Opus**: 最高质量，适合复杂任务

### 2. 优化请求参数

```bash
# 设置较低的 max_tokens 以获得更快响应
# 在代码中会自动设置合理的默认值
```

### 3. 使用流式响应

系统默认使用流式响应以获得更好的用户体验。

## 高级配置

### 自定义 API 端点

如果使用自定义的 Anthropic 兼容端点：

```bash
export GOOGLE_GEMINI_BASE_URL="https://your-custom-endpoint.com"
export CUSTOM_API_FORMAT="ANTHROPIC"
```

## 🔧 智能 API 格式检测

**重要更新**: 系统现在具备智能检测功能，可以自动识别第三方服务并使用正确的 API 格式：

- **自动格式切换**: 当检测到第三方服务时，即使配置了 `CUSTOM_API_FORMAT="ANTHROPIC"`，系统也会自动切换到 OpenAI 兼容格式
- **无需手动配置**: 用户不需要修改 `CUSTOM_API_FORMAT` 设置，系统会智能处理
- **透明操作**: 切换过程对用户透明，保持相同的使用体验

### 代理配置

```bash
# HTTP 代理
export http_proxy=http://proxy:port
export https_proxy=http://proxy:port

# SOCKS 代理
export http_proxy=socks5://proxy:port
export https_proxy=socks5://proxy:port
```

## 获取帮助

如果问题仍然存在：

1. **查看错误日志**: 启用调试模式并查看详细错误信息
2. **检查 Anthropic 状态**: 访问 [Anthropic Status Page](https://status.anthropic.com/)
3. **联系支持**: 提供错误日志和配置信息

## 更新日志

- **v2.0.0**: 添加 Anthropic API 支持
- **v2.0.1**: 修复模型名称映射问题
- **v2.0.2**: 改进错误处理和调试信息
- **v2.0.3**: 添加消息格式验证和修复

## 相关文档

- [自定义 API 格式支持](./CUSTOM_API_FORMATS.md)
- [Anthropic API 官方文档](https://docs.anthropic.com/)
- [模型对比和选择指南](https://docs.anthropic.com/claude/docs/models-overview)
