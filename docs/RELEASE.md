# 发布到 GitHub

English version: [RELEASE.en.md](RELEASE.en.md)

## 发布前检查

- [ ] 已完成文档中英双版本，中文主版本最新
- [ ] 仓库内无个人绝对路径
- [ ] 仓库内无 API key / token / secret
- [ ] 核心构建与扩展构建通过
- [ ] 流程图、安装文档、授权说明已更新

## 构建验证

```bash
npm install
npm run build

cd vscode-extension
npm install
npm run compile
```

## 首次发布

```bash
git init
git checkout -b main
git add .
git commit -m "chore: initial AIStack release"
git remote add origin https://github.com/fxxkrlab/aiStack.git
git push -u origin main
```

## 发布版本与 Release

```bash
git tag -a v0.1.0 -m "AIStack v0.1.0"
git push origin v0.1.0
```

如需附加 `.vsix` 资产，可使用 `gh release create` 上传。
