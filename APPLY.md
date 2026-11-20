# 2.8.2-dev.31 补丁应用

以已经正确应用 `2.8.2-dev.30` 的项目为基线；原先已有的 `tools/导出B站日志.bat` 保留，不会重复新增。先检查 `node -p "require('./package.json').version"` 与 `git status --short`。

```powershell
git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.30_TO_2.8.2-dev.31.patch"
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.30_TO_2.8.2-dev.31.patch"
```

检查失败不要强制覆盖；完整回归和实机说明见 `TESTING_2.8.2-dev.31.md`。完整 `source/` 与 Patch 是**二选一**的升级方式，不得先覆盖 source 再重复应用补丁。
