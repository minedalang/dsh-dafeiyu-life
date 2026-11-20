# 大肥鱼 Plus · 2.8.2-dev.28 源码交付说明

**明确来源：** 用户上传的 `dsh-bili-scroll-plus2.zip`，`package.json` 版本为 `2.8.2-dev.26`。

**交付版本：** `2.8.2-dev.28`，合并 dev.27 Whisper 安装管理和 dev.28 多候选自主视频探索两批实施，未曾自动 `git commit`、`git push` 或正式发布。

## 包内结构

- `source/`：完整目标版本源码（含新版 README、SVG/Mermaid、测试）。
- `PATCH_FROM_2.8.2-dev.26_TO_2.8.2-dev.28.patch`：在上传基线独立回放核对的 Git 增量补丁。
- `COMMIT_MESSAGE.txt`：可选的中文 Conventional Commit 文案（没有自动提交）。
- `TESTING_2.8.2-dev.28.md`：Windows/DSH 逐项实测教程、发布门禁、回滚。
- `TEST-RESULTS.md`：本次实际执行的离线测试/工程检查和待验事项。

**只能选一种方式使用源码或 Patch，不能同时覆盖并重放。** 请先备份工作区和用户数据，检查基线与工作区状态；尤其不要误删 `.hf-cache` 和 Life 记忆。变更说明见 `CHANGELOG.md` 和 `docs/architecture/2.8.2-dev28-multi-focus-and-whisper.md`。
