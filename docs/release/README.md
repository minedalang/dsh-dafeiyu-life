# 发布文档索引

- **当前 2.6.1：** [`2.6.1-publication-checklist.md`](2.6.1-publication-checklist.md) 为正式版发布前必须检查的项目；根目录 [`RELEASE_NOTES_v2.6.1.md`](../../RELEASE_NOTES_v2.6.1.md) 是同版本的公开发行说明。
- **2.6.1 RC2 审计历史：** [`archive/RELEASE_NOTES_v2.6.1-RC2.md`](archive/RELEASE_NOTES_v2.6.1-RC2.md)，保留详细补丁、授权、回访和实机验收提醒。
- **未来计划：** [`../FUTURE_ROADMAP_2.6.1_TO_2.9.1.md`](../FUTURE_ROADMAP_2.6.1_TO_2.9.1.md)。
- **历史版本：** `archive/` 放置旧 dev/Release Notes；`2.6.0-readiness.md` 等仅用于历史追溯，不能作为 2.6.1 的发布依据。

推荐顺序：自动化回归 → Windows DSH/B站实测 → dev 合并 main → 发布 Tag → GitHub Actions 附件校验 → npm 单独发布 → DSHMarket 版本核对。GitHub Source code ZIP 不等于可安装的 npm `.tgz`；推送开发分支也不等于正式发布。
