# Release to GitHub

## Pre-release Checklist

- [ ] No personal absolute paths in tracked files
- [ ] No API keys/tokens in repository
- [ ] Build succeeds for core and extension
- [ ] `docs/ARCHITECTURE.md` and `docs/INSTALL.md` are up to date

## Build Validation

```bash
npm install
npm run build

cd vscode-extension
npm install
npm run compile
```

## First Publish

```bash
git init
git checkout -b main
git add .
git commit -m "chore: initial AIStack release"
git remote add origin https://github.com/fxxkrlab/aiStack.git
git push -u origin main
```

## Update Release

```bash
git add .
git commit -m "docs: update architecture and install guide"
git push
```

