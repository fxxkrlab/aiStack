# AIStack

中文主文档。English version: [README.en.md](README.en.md)

AIStack 是一个多模型协作的软件交付框架，支持：

- 多模型 Brainstorm（可选 GPT / Claude / Gemini 等）
- Debate 多轮互评
- Synthesis 汇总为可执行 Roadmap
- 任务编译（`TaskSpec + Checks + L2 Skill + MCP allowlist`）
- Worker 执行与 Reviewer 验收

核心运行时全部为 TypeScript/Node，便于 VSCode 插件发布与跨平台分发。

## 文档导航

- 架构与流程图（中文）：`docs/ARCHITECTURE.md`
  - English: `docs/ARCHITECTURE.en.md`
- 安装部署（中文）：`docs/INSTALL.md`
  - English: `docs/INSTALL.en.md`
- 安全与脱敏（中文）：`docs/SECURITY.md`
  - English: `docs/SECURITY.en.md`
- 发布流程（中文）：`docs/RELEASE.md`
  - English: `docs/RELEASE.en.md`
- 版本规则（中文）：`docs/VERSIONING.md`
  - English: `docs/VERSIONING.en.md`
- 授权策略（中文）：`docs/LICENSE_POLICY.md`
  - English: `docs/LICENSE_POLICY.en.md`

## 项目结构

- `scripts/brain.ts`: roadmap/task 编排与 worker 调度
- `mcp/model_router/server.ts`: brainstorm/debate/synthesis 统一 MCP 路由
- `mcp/claude_runner/server.ts`: Claude CLI MCP
- `vscode-extension/`: AIStack VSCode 插件
- `skills/`: L0/L1 技能定义
- `templates/`: TaskSpec/Checks/L2 skill 模板

## 快速开始

```bash
npm install
npm run build
node dist/scripts/brain.js init --goal "Build AIStack workflow"
```

创建任务：

```bash
node dist/scripts/brain.js new-task \
  --title "Implement router" \
  --goal "Generate task package" \
  --scope "scripts/,templates/,skills/" \
  --files "scripts/brain.ts,templates/,skills/" \
  --acceptance "Generates TaskSpec/Checks/allowlist;repeatable"
```

执行 worker：

```bash
node dist/scripts/brain.js run-worker \
  --task-dir "rounds/R01/T001_implement_router" \
  --worker claude \
  --dangerous-permissions
```
