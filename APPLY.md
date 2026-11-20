# 2.8.2-dev.32 → dev.33

**只对已应用 dev.32 的项目使用此 Patch**；先看 `TESTING_2.8.2-dev.33.md`。

```powershell
node -p "require('./package.json').version"
git status --short
git -c core.whitespace=cr-at-eol apply --check '.\PATCH_FROM_2.8.2-dev.32_TO_2.8.2-dev.33.patch'
git -c core.whitespace=cr-at-eol apply '.\PATCH_FROM_2.8.2-dev.32_TO_2.8.2-dev.33.patch'
node -p "require('./package.json').version"
```

请不要对已覆盖的 dev.33 完整源码再重复应用补丁。检测失败时勿强制，不删除原有日志批处理，不重置账号和记忆。
