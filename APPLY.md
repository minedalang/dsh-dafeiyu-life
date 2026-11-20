# 2.8.2-dev.35 → dev.36 增量更新

1. 普通 PowerShell 进入项目根目录，运行 `node -p "require('./package.json').version"`，确认是 `2.8.2-dev.35`，再检查 `git status --short` 并备份自己修改的文件。
2. 放入增量补丁，先运行 `git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.35_TO_2.8.2-dev.36.patch"`。
3. **仅当检查通过**，再执行 `git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.35_TO_2.8.2-dev.36.patch"`。
4. 运行 `node -p "require('./package.json').version"`；预期 `2.8.2-dev.36`。完整 ZIP 的 `source/` 与补丁二选一，不能重复操作。
5. 继续阅读 `TESTING_2.8.2-dev.36.md` 完成 Windows/DSH 验收。失败不要 `git reset --hard` 或改写用户数据。
