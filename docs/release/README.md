# 发布文档布局

- 根目录 `RELEASE_NOTES_v2.6.0.md`：本次正式版 GitHub Release 正文；Git Tag `v2.6.0` 会自动读取。
- `2.6.0-readiness.md`：发布前检查清单；真实 DSH Desktop / B站 / Mobile 与备份验证仍须由发布者执行。
- `2.6.0-bilibili-pinned-post.md`：可选的手动 B站置顶文案草稿，不能自动发布。
- `archive/`：此前 dev 版和历史 2.5 的发布说明、未发布旧草稿。它们保留在 Git 仓库作为开发史，**不再随 `2.6.0` npm 安装包分发**。

发行流程：先通过自动化与真实设备核验，再创建正确的 `v<package.json version>` Tag，核对 GitHub Release 附件及 SHA256；npm 和市场渠道另行更新与确认。推送 `dev` 本身不代表已正式发布。
