# 安装与部署

English version: [INSTALL.en.md](INSTALL.en.md)

## 环境要求

- Node.js 18+（推荐 20+）
- npm 8+
- 可选：Claude CLI（使用 `claude-runner` 时）
- VSCode 1.85+

## 1) 构建核心

```bash
npm install
npm run build
```

查看命令：

```bash
node dist/scripts/brain.js --help
```

## 2) 启动 MCP

### model-router

```bash
node dist/mcp/model_router/server.js
```

### claude-runner

```bash
CLAUDE_RUNNER_ALLOWED_ROOTS="/absolute/path/to/your/workspace" \
node dist/mcp/claude_runner/server.js
```

## 3) VSCode 插件（源码模式）

```bash
cd vscode-extension
npm install
npm run compile
```

然后在 VSCode 打开 `vscode-extension/`，按 `F5` 启动 Extension Development Host。

## 4) 打包 VSIX（可选）

当前环境若默认 Node 版本较低，可用临时 Node 20 打包：

```bash
cd vscode-extension
npx -p node@20 -p @vscode/vsce@3.7.1 vsce package -o aistack-0.1.0.vsix
```

## 5) MCP 客户端配置示例

```json
{
  "mcpServers": {
    "model-router": {
      "command": "node",
      "args": ["dist/mcp/model_router/server.js"]
    },
    "claude-runner": {
      "command": "node",
      "args": ["dist/mcp/claude_runner/server.js"],
      "env": {
        "CLAUDE_RUNNER_ALLOWED_ROOTS": "/absolute/path/to/your/workspace"
      }
    }
  }
}
```
