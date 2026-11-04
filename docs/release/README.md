# 发布文档索引

- **当前目标正式版 2.7.0：** 根目录 [`RELEASE_NOTES_v2.7.0.md`](../../RELEASE_NOTES_v2.7.0.md) 是面向用户的封版发行说明；[`CHANGELOG.md`](../../CHANGELOG.md) 保留 `dev.1`～`dev.10` 开发记录。
- **上一个已发布稳定版 2.6.2：** [`RELEASE_NOTES_v2.6.2.md`](../../RELEASE_NOTES_v2.6.2.md) 留作升级对照；2.6.1 历史发布和审核资料继续保留，不再作为当前发布门禁。
- **详细技术架构：** [`../architecture/README.md`](../architecture/README.md) 为当前源码接口与权限职责的唯一入口；旧发布候选在 [`archive/`](archive/) 中追溯。
- **后续规划：** [`../FUTURE_ROADMAP_2.6.1_TO_2.9.1.md`](../FUTURE_ROADMAP_2.6.1_TO_2.9.1.md) 是历史版本路线，未来能力以新版本具体验收为准。

发布顺序：自动化回归 → Windows DSH Desktop 与 B站受控实测 → 审核 dev 封版提交 → 快进合并到 main → 创建并推送 `v2.7.0` Tag → 核对 GitHub Release、tgz 与 SHA256 → **独立** npm 发布 → DSHMarket 安装/更新验证。推送 `dev` 或创建 Tag 并不自动代表 npm 已上架；不要把历史离线测试计作本次实机验收。
