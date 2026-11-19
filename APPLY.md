# 2.8.2-dev.9 桌宠开放生态预告页 · 交付说明

本项目快照从**用户上传的 `dsh-bili-scroll-plus2(3).zip`（版本 `2.8.2-dev.8`）**增量修改而来。

正式交付 ZIP 内提供两种等价方式：`source/` 完整源码，或 `PATCH_FROM_2.8.2-dev.8_TO_2.8.2-dev.9.patch` 增量补丁。**二选一，不要先覆盖源码再应用补丁。**

## 方案 A：完整源码

先备份现有项目工作目录与用户数据，并保留本地独有修改。将交付包 `source/` 的文件作为新代码快照，比较差异后更新原 Git 工作区；不要删除用户个人数据目录。

## 方案 B：精准基线 Git Patch

在**与本次上传原始 ZIP 内容一致**的 Git 工作目录中，先确认本地变更与 Patch 没有冲突：

```powershell
# 在原项目 Git 根目录执行
 git status --short
 git apply --check "D:\YourDelivery\PATCH_FROM_2.8.2-dev.8_TO_2.8.2-dev.9.patch"
 git apply "D:\YourDelivery\PATCH_FROM_2.8.2-dev.8_TO_2.8.2-dev.9.patch"
```

补丁采用 UTF-8、无 BOM，保留中文内容和原仓库文本行尾。不要求你为了应用 Patch 先提交其他已有改动；但若本地对同一文件另有修改，请先人工对比和备份，避免盲目覆盖。

## 离线定向检查

```powershell
node --check lib\management-console.js
node --test test\v282-dev9-open-platform-preview.test.mjs test\v281-readme-user-facing-contract.test.mjs
node scripts\test-governance.mjs check
node selfcheck.mjs
npm run check:life-architecture
npm pack --dry-run
```

上面不是 Windows 正式发布放行。维护者仍需在 Windows/DSH Desktop 中检查导航、深色主题、布局、刷新与返回、普通/管理员环境 full 回归。不得据此宣称 API 已开放。完整结果见交付 ZIP 根目录的 `TEST-RESULTS.md`。
