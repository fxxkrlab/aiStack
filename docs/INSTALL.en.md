# Installation

## Prerequisites

- Node.js 18+ (recommended 20+)
- npm 8+
- Optional: Claude CLI (`claude`) if using `claude-runner`
- VSCode 1.85+

## 1) Core Build

```bash
npm install
npm run build
```

Core commands:

```bash
node dist/scripts/brain.js --help
```

## 2) MCP Servers

### `model-router`

```bash
node dist/mcp/model_router/server.js
```

### `claude-runner`

```bash
CLAUDE_RUNNER_ALLOWED_ROOTS="/absolute/path/to/your/workspace" \
node dist/mcp/claude_runner/server.js
```

## 3) VSCode Extension (from source)

```bash
cd vscode-extension
npm install
npm run compile
```

Then open `vscode-extension/` in VSCode and press `F5` for Extension Development Host.

## 4) VSIX Packaging (optional)

```bash
cd vscode-extension
npm install -D @vscode/vsce
npx vsce package
```

Install generated `.vsix` in VSCode.

## 5) MCP Client Config Example

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

