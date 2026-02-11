# 版本规则

English version: [VERSIONING.en.md](VERSIONING.en.md)

AIStack 使用语义化版本（SemVer）：`MAJOR.MINOR.PATCH`

## 当前版本

- 初始公开版本：`0.1.0`

## 规则定义

- `MAJOR`：破坏性变更（公共 API、MCP schema、扩展行为不兼容）
- `MINOR`：向后兼容的新功能
- `PATCH`：向后兼容的修复与文档更新

## 1.0 前建议

在 `1.0.0` 前允许在 `MINOR` 引入必要调整，但必须在发布说明中明确标注不兼容点。

建议节奏：

- `0.1.x`：稳定和修复
- `0.2.x`：流程能力增强（brainstorm/debate/synthesis）
- `0.3.x`：权限与安全加固
- `1.0.0`：schema 稳定 + 兼容承诺

## Tag 规范

- 使用 `v` 前缀：`v0.1.0`, `v0.1.1`, `v0.2.0`
