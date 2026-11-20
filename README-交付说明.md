# 大肥鱼 Plus 2.8.2-dev.38 · 开发候选交付

基线为 **2.8.2-dev.37**。本轮只修主人局部原视频 Debug：保持工具原始安全机器错误码，不再将所有读取失败合并为 `tool-result-unavailable`；当原视频真实解码成功时，新增 `focus-00.jpg` 分镜拼图显示，保留最多12张独立采样帧。无可用解码帧时不生成拼图。

完整 ZIP 包含 `source/`、`PATCH_FROM_2.8.2-dev.37_TO_2.8.2-dev.38.patch`、`COMMIT_MESSAGE.txt` 和 `TESTING_2.8.2-dev.38.md`。补丁与源码覆盖是两种**替代更新方式，不可叠加**。`TEST-RESULTS.md` 只记录离线测试；Windows/DSH 上的真实原视频 CDN、FFmpeg 和 Ollama 仍待用户实测，2.8.2 正式版不放行。

没有更改 Life 自主权限、模型选择、视频流量/时长/帧预算、私信哨兵、30分钟 `get_sessions` 兜底、账户隔离或任何 B站外发许可，也没有更改现有日志导出 BAT。
