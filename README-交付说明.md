# 大肥鱼 Plus 2.8.2-dev.37 · 开发候选交付

基线 `2.8.2-dev.36`。本轮只修可变时长 Life/主人局部取帧时间覆盖、失败诊断和行动树真实子行动展示，不扩大 Life 权限、视频网络预算、原视频最高分辨率及 B站外发权限。私信哨兵与30分钟 `get_sessions` 兜底未改。

`source/` 为完整源码；`PATCH_FROM_2.8.2-dev.36_TO_2.8.2-dev.37.patch` 为增量补丁，两者二选一。`TESTING_2.8.2-dev.37.md` 提供 Windows/DSH 15秒和20秒实际验收步骤；`TEST-RESULTS.md` 只记录离线测试，不等于真实本地 GPU/Ollama 或 FFmpeg 成功。此前21:51日志包不足以还原历史局部失败的具体阶段，新版本需重测并查看脱敏 `reports/video-focus-last-diagnostic.json`。
