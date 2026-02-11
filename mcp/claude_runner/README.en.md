# AIStack claude-runner MCP

TypeScript/Node MCP server that wraps `claude -p`.

## Build

```bash
cd <repo-root>
npm install
npm run build
```

## Run

```bash
CLAUDE_RUNNER_ALLOWED_ROOTS="/absolute/path/to/workspace" \
node dist/mcp/claude_runner/server.js
```

## Tools

- `claude.one_shot`
- `claude.review_diff`
- `claude.generate_patch`
