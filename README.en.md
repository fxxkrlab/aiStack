# AIStack

AIStack is a multi-model collaboration framework for software delivery:

- Brainstorm with multiple models (`GPT/Claude/Gemini/...`)
- Debate for N rounds
- Synthesis into roadmap
- Task compilation (`TaskSpec + Checks + L2 Skill + MCP allowlist`)
- Worker execution
- Reviewer acceptance

All core runtime is implemented in TypeScript/Node for easier VSCode extension distribution.

## Documentation

- Architecture and flow: `docs/ARCHITECTURE.md`
- Installation: `docs/INSTALL.md`
- Security and desensitization: `docs/SECURITY.md`
- GitHub release steps: `docs/RELEASE.md`
- Versioning policy: `docs/VERSIONING.md`

## Project Structure

- `scripts/brain.ts`: roadmap/task compiler and worker runner
- `mcp/model_router/server.ts`: brainstorm/debate/synthesis MCP server
- `mcp/claude_runner/server.ts`: Claude CLI MCP server
- `vscode-extension/`: AIStack VSCode extension
- `skills/`: L0/L1 skill definitions
- `templates/`: TaskSpec/Checks/L2 skill templates

## Quick Start

```bash
npm install
npm run build
node dist/scripts/brain.js init --goal "Build AIStack workflow"
```

Create one task:

```bash
node dist/scripts/brain.js new-task \
  --title "Implement router" \
  --goal "Generate task package" \
  --scope "scripts/,templates/,skills/" \
  --files "scripts/brain.ts,templates/,skills/" \
  --acceptance "Generates TaskSpec/Checks/allowlist;repeatable"
```

Run worker:

```bash
node dist/scripts/brain.js run-worker \
  --task-dir "rounds/R01/T001_implement_router" \
  --worker claude \
  --dangerous-permissions
```
