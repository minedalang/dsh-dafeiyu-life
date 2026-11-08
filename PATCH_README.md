# dev.31 · 从 dev.30 完整源码升级（未发布）

本补丁必须以**dev.30 完整交付版**为基线（不是 dev.29 或仅装了部分补丁的工作树）。选择 Original 换行或 LF 规范化补丁**其中一种**应用；也可以备份后使用完整源码 ZIP。不会自动合并 `main`、建 Tag、发布或改变任何用户的 B站发送授权。

本轮复用原 Life Planner、Life Reflection、Life Decision Trace、视频 Agent 和首页推荐 MCP；没有独立首页 Agent。模型失败退避由原 `autonomous-planner.json` 存储，无需用户配置迁移。`homeRecommendationsEnabled=false` 时不会提供首页闲逛动作。旧日志不自动修复，只对升级后新轮次生效。平台本身或模型服务故障需要实机核验。

# dev.30 · 从完整 dev.29 源码升级（未发布）

本补丁以 **dev.29 完整源码交付**为基线，升级为 `2.7.1-dev.30`，不会更新主分支、创建 Tag、发布 npm 或修改用户已存配置。只应用原始换行格式与 LF 规范化格式中的**一种**；建议 `git apply --check` 成功后再应用，或者备份后直接使用完整源码 ZIP。

真实的读写操作必须先有已核验回执，才进入原 Life Memory 可衰减经历。升级时会对同账号同收件人且成功回执完整的旧推荐进行限量、去重补录，不读取已遗忘归档；模型权重仍由用户明确安装，源码包不带 GGUF。真实 Windows/B站/索引与长期行为验收未完成，`releaseReady:false`。

# dev.29 · 从完整 dev.28 源码升级

使用 dev.28 **完整交付源码** 作为基线。新版本首次设置新增推荐本地 Embedding 安装选项（必须用户确认下载）；自主视频分享私信自动附真实 BV URL，并将当前账号与收件人的成功分享回执用于下一轮要链接的回复。没有扩大社交授权，现有配置、模型数据、记忆数据不重置。详细源码图见 `docs/architecture/2.7.1-dev29-life-subsystems-and-video-link-handoff.md`。


# dev.28 · 由 dev.27 升级

升级补丁以完整 **dev.27** 源码为基线。请先备份运行数据与代码，只选用与本地换行格式匹配的一种补丁，或使用全量源码压缩包。此版不改变原点赞、收藏、关注、评论及私信授权；新增功能只会根据已有跨日公开互动证据，自主考虑读取某人的公开投稿。`releaseReady:false`，Windows/B站/72 小时仍待实机测试。

# dev.27 · 由 dev.26 修复版升级

当前版本 `2.7.1-dev.27`（开发预览，未发布）。基线是 **dev.26 已退休旧视频报告模式的最终源码**，不是 dev.26 初版。

使用交付的 `DSH-2.7.1-dev27-from-dev26-cleanup-original.patch` 或 `DSH-2.7.1-dev27-from-dev26-cleanup-LF.patch` 其中一种。使用 `git apply --check` 再 `git apply`，不要应用两遍；也可直接使用完整源码 ZIP。

升级不会重置 `autoComment`、点赞/收藏/关注开关；关闭的行为仍关闭。首次运行建议先备份本机 `bili-duty/`，在单独测试账号/小额度下验证真实平台反应。写入结果未知严禁手动或程序自动重试。

当前仍 `releaseReady:false`，不创建 Tag，不合并 main，不发布 npm。详见 `docs/architecture/2.7.1-dev27-life-continuation-writes.md`。
