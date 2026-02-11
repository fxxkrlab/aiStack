# Security and Desensitization

## What is sanitized in this repo

- No personal absolute filesystem paths in tracked docs/config
- No API keys or tokens in source code or examples
- No generated runtime artifacts (`rounds/`, `state/`, `dist/`, `node_modules/`) in Git tracking

## Runtime Secret Handling

- VSCode extension stores API keys in VSCode SecretStorage
- CLI/API keys should be provided via environment variables or runtime flags
- Do not commit `.env` or any local secret file

## Permission Strategy

- Use minimum MCP tool allowlist by default
- Dangerous permission switches are explicit and model-specific
- Full automation mode should be used only in trusted environments

## Recommended Hardening

- Run workers in sandboxed containers for production usage
- Restrict filesystem scope using `CLAUDE_RUNNER_ALLOWED_ROOTS`
- Keep CI checks mandatory before acceptance

