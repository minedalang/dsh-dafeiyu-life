# 大肥鱼 2.8.1-dev.3b.33.23 · 完整交付说明

基线：2.8.1-dev.3b.33.22-independent-life-hours。

交付内容：完整源码 `source/`、独立安装 npm `.tgz`、`.22→.23` UTF-8 Git Patch、`.19→.23` 累计补丁、中文 Commit、安装/回滚文档、`TEST-RESULTS.md` 与 SHA256。Patch 与完整源码是二选一升级方式。

主要变化：公开 DASH SIDX 按时间索引、有限 206 Range 片段提取与本地 FFmpeg 识图；旧 DURL/预览路径兼容；保留 DSH 真实回退原因、证据来源和网络预算/账号安全。不增加任何对外写权限。

真实 Windows/B站模型测试没有在当前容器进行。具体见顶层 `delivery/TEST-RESULTS.md`。
