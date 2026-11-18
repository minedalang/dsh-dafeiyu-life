# 2.8.1-dev.3b.33.23 安装、升级与回滚（2026-11-18）

本次为 .22→.23 长视频 DASH 分段视觉修复。优先使用完整源码 ZIP 或 npm TGZ（二选一），**不可在已经复制 .23 源码后再次应用 .22→.23 Patch**。

## 新功能

- 支持公开 B站 DASH `SegmentBase` 中可信 SIDX 的抽帧；有单段 DURL MP4 时沿用原 MP4 分段读取。支持时间线最长 4 小时，但每条视频网络预算仍是 24/50/100 MiB，严格不代表完整播放。
- 如果收到无法取到的 DASH 索引、权限或 CDN Range，不再用统一 `public_stream_unavailable` 覆盖根因；当使用 DSH 模型，低清回退通过独立图片证明传递实际原因。

## 使用 Patch

在确认为对应旧版的 Git 工作区根目录运行，不要依赖 Windows 当前控制台代码页对 Patch 做编码转换：

```powershell
git status --short
git apply --check ".\2.8.1-dev.3b.33.22-to-23-indexed-dash-utf8.patch"
git apply ".\2.8.1-dev.3b.33.22-to-23-indexed-dash-utf8.patch"
```

仍是 `.19` 且源码与历史基线一致时，改用 `2.8.1-dev.3b.33.19-to-23-indexed-dash-utf8.patch`（**不能叠加两个 Patch**）；如果你本地修改了对应文件，应先备份并核对冲突。

## 数据安全与验收

备份插件及 `%USERPROFILE%\.dsh\bili-duty`（目录若已自定义，以实际状态目录为准），**不要删除或重置原配置、私信队列、未知发送回执、账号限流预算和 Life 记忆**。升级后完全退出并重启 DSH。建议先用公开短视频验 DURL，再用 10～45 分钟 B站公开视频验 DASH 深入 `watch`，查看 `sampling.source_type`、`download_mode`、`sampled_windows`、`input_bytes` 和 `adaptive_fallback.reason`。公网 CDNs、Windows FFmpeg 与真实模型执行均未在离线交付环境实测。

回滚：用之前备份的原插件版本恢复源码或 npm 包，保留原状态目录。没有任何数据格式迁移需要回滚。

禁止对真实 B站进行未经授权的发送、自动 Git Commit/Push 或 npm publish。详情参见 `TEST-RESULTS.md`。
