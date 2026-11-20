# 2.8.2-dev.33 → dev.34

仅对**已应用 dev.33**的源码使用增量 Patch；如果选用 ZIP 内完整 `source/`，不要再应用同一 Patch。

```powershell
node -p "require('./package.json').version"
git status --short
git -c core.whitespace=cr-at-eol apply --check '.\PATCH_FROM_2.8.2-dev.33_TO_2.8.2-dev.34.patch'
git -c core.whitespace=cr-at-eol apply '.\PATCH_FROM_2.8.2-dev.33_TO_2.8.2-dev.34.patch'
node -p "require('./package.json').version"
```

检查失败不强制应用；保留现有日志工具、账号/记忆及 Headless 备份。后续 Windows/DSH 实机验收见 `TESTING_2.8.2-dev.34.md`。
