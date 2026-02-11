# AIStack claude-runner MCP

中文主文档。English version: [README.en.md](README.en.md)

`claude-runner` 是一个 TypeScript/Node MCP server，封装 `claude -p` 执行能力。

## 构建

```bash
cd <repo-root>
npm install
npm run build
```

## 启动

```bash
CLAUDE_RUNNER_ALLOWED_ROOTS="/absolute/path/to/workspace" \
node dist/mcp/claude_runner/server.js
```

## 可用工具

- `claude.one_shot`
- `claude.review_diff`
- `claude.generate_patch`
