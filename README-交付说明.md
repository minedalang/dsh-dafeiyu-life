# 大肥鱼 Plus 2.8.2-dev.39 · 局部原视频 FFmpeg 解码修复

本次基线为 **2.8.2-dev.38**。用户报告主人专项 `video_decode_failed`，全局24帧识图成功而局部0帧。代码确认 FFmpeg 的 `min(640,iw)` 表达式中逗号未转义；在本机 FFmpeg 复现原命令失败，修复后直接调用生产函数取得真实局部画面。

源码包 `source/` 与增量 Git Patch 是两种替代更新方式，**只能使用一种**。此次不修改现有日志导出 BAT、不发起 B站 请求、不影响私信30分钟兜底或 Life 自主意愿。本次回归不代表 Windows/DSH 原视频、CDN和本地视觉模型已实机全链路通过。详见 `TESTING_2.8.2-dev.39.md` 和顶层 `TEST-RESULTS.md`。
