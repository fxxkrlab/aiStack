# 安全与脱敏

English version: [SECURITY.en.md](SECURITY.en.md)

## 仓库脱敏基线

- 不包含个人绝对路径
- 不包含 API keys / tokens
- 不提交运行产物（`rounds/` `state/` `dist/` `node_modules/`）

## 密钥处理

- VSCode 插件使用 SecretStorage 保存密钥
- CLI/API 密钥仅在运行时注入（环境变量或参数）
- 禁止提交 `.env` 或本地密钥文件

## 权限策略

- 默认最小 MCP allowlist
- 危险权限按模型独立开关
- 全程自动化模式仅建议在可信隔离环境开启

## 强化建议

- 生产使用容器/沙箱执行 worker
- 配置 `CLAUDE_RUNNER_ALLOWED_ROOTS` 限制目录
- 验收前强制 tests/lint/build
