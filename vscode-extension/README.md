# AIStack VSCode 扩展

中文主文档。English version: [README.en.md](README.en.md)

该扩展提供 AIStack 控制面板：

- Brain/Worker provider 配置
- API URL / model / API key 设置
- 全程自动化开关
- 按模型危险权限开关（codex/claude/gemini）
- 一键执行 roadmap 初始化、任务生成、worker 执行

## 构建

```bash
cd <repo-root>
npm install
npm run build

cd vscode-extension
npm install
npm run compile
```

在 VSCode 打开 `vscode-extension/` 后按 `F5` 启动 Extension Development Host。
