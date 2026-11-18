> **2.8.1 发布资料（新代码待终验）**：[正式版发布检查单](2.8.1-release-checklist.md) · [新旧用户升级说明](2.8.1-user-upgrade-guide.md) · [2.8.1 更新说明](RELEASE_NOTES_v2.8.1.md) · [发布命令和验证步骤](2.8.1-publish-commands.md) · [全链路代码审计](../architecture/2.8.1-release-audit-20261117.md)。当前不能把 GitHub `dev` 安装与手动视觉验收当作正式上线。

# 发布文档索引

**当前源码版本以根目录 `package.json` 为准；仓库代码、Tag、GitHub Release、npm 与 DSHMarket 的上线状态必须分别核对。** 最新定向回归不能替代新的 Windows full 与真实视频验收。

- **最后一轮正式版审计：** [2.8.0 发布阻断与检查表](../architecture/2.8.0-final-release-audit-20261114.md)。
- **当前版本功能与发布门禁：** [2.8.0 版本说明](archive/RELEASE_NOTES_v2.8.0.md) · [2.8.0 发布就绪审计](../architecture/2.8.0-release-readiness.md)。
- **未来规划：** [未来版本路线图（2.8.2 起）](../ROADMAP.md) · [研发技术评估](../architecture/2.8.1-roadmap.md)。
- **技术架构：** [统一 Life 协议与历史增量](../architecture/README.md)。
- **历史发布：** [2.6.2](archive/RELEASE_NOTES_v2.6.2.md) · [早期档案](archive/)。过时的 2.6.0 开发预览说明已清理，已发布版本说明仍保留。

发布必须先完成完整回归、Windows DSH/真实 B站受控测试、账号与迁移安全验收，再审核封版、合并代码、生成 Tag 和 Release、核对 npm/市场发布。**Git 推送、开发 Tag 与离线测试都不等于正式上架。**
