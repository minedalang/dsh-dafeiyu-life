# 2.8.2-dev.32 补丁应用

**前置版本仅限 `2.8.2-dev.31`。** 完整源码覆盖与增量 Patch 二选一。

```powershell
node -p "require('./package.json').version"
git status --short
git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.31_TO_2.8.2-dev.32.patch"
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.31_TO_2.8.2-dev.32.patch"
```

仅在 `--check` 通过后执行真正的 apply；失败时保留原工作区并检查冲突，不运行 reset/clean，不删除历史缓存、日志及账号数据。验收步骤见 `TESTING_2.8.2-dev.32.md`。
