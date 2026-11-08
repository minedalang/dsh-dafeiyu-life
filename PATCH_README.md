# dev.29 · 从完整 dev.28 源码升级

使用 dev.28 **完整交付源码** 作为基线。新版本首次设置新增推荐本地 Embedding 安装选项（必须用户确认下载）；自主视频分享私信自动附真实 BV URL，并将当前账号与收件人的成功分享回执用于下一轮要链接的回复。没有扩大社交授权，现有配置、模型数据、记忆数据不重置。详细源码图见 `docs/architecture/2.7.1-dev29-life-subsystems-and-video-link-handoff.md`。


# dev.28 · 由 dev.27 升级

升级补丁以完整 **dev.27** 源码为基线。请先备份运行数据与代码，只选用与本地换行格式匹配的一种补丁，或使用全量源码压缩包。此版不改变原点赞、收藏、关注、评论及私信授权；新增功能只会根据已有跨日公开互动证据，自主考虑读取某人的公开投稿。`releaseReady:false`，Windows/B站/72 小时仍待实机测试。

# dev.27 · 由 dev.26 修复版升级

当前版本 `2.7.1-dev.27`（开发预览，未发布）。基线是 **dev.26 已退休旧视频报告模式的最终源码**，不是 dev.26 初版。

使用交付的 `DSH-2.7.1-dev27-from-dev26-cleanup-original.patch` 或 `DSH-2.7.1-dev27-from-dev26-cleanup-LF.patch` 其中一种。使用 `git apply --check` 再 `git apply`，不要应用两遍；也可直接使用完整源码 ZIP。

升级不会重置 `autoComment`、点赞/收藏/关注开关；关闭的行为仍关闭。首次运行建议先备份本机 `bili-duty/`，在单独测试账号/小额度下验证真实平台反应。写入结果未知严禁手动或程序自动重试。

当前仍 `releaseReady:false`，不创建 Tag，不合并 main，不发布 npm。详见 `docs/architecture/2.7.1-dev27-life-continuation-writes.md`。
