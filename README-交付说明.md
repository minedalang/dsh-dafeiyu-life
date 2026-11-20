# 大肥鱼 Plus · 2.8.2-dev.29 源码交付说明

**补丁基线：`2.8.2-dev.28`**（用户已应用的上一批完整源码）。目标为 `2.8.2-dev.29`。本次是发布前修复候选版，**不是 2.8.2 正式版**。

- `source/`：完整目标源码（不包含用户的私信、日志、凭据、记忆与 `.hf-cache`）。
- `PATCH_FROM_2.8.2-dev.28_TO_2.8.2-dev.29.patch`：仅针对 dev.28 的增量 Git 补丁，已在干净 dev.28 上回放。
- `COMMIT_MESSAGE.txt`：可选中文 Conventional Commit 文案；没有替用户提交。
- `TESTING_2.8.2-dev.29.md`：定向复测、npm 安装内容检查、Windows 全量及真实 Whisper/视频验收、失败停止与回滚。
- `TEST-RESULTS.md`：本轮真实离线测试及仍未通过的发布门禁。
- `docs/release/2.8.2-dev.29-closure-audit.md`：项目功能审计、Windows 日志风险分类与未收口问题。

**选择完整源码覆盖或 Patch 其中一种，不能两者叠加。** 补丁仅适用于已准确应用 dev.28 且与该基线无冲突的工作区。若你已单独提交/合并部分改动，先核对 `git status` 和 `git diff`，不要使用 reset-hard、强制覆盖或手工删除用户数据。
