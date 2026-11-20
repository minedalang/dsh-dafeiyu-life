# 2.8.2-dev.39 · FFmpeg 局部原视频解码修复验收

## 1. 安装与回滚边界

使用 dev.38 作为**明确的唯一前置基线**。在项目根目录执行：

```powershell
node -p "require('./package.json').version"
# 必须是 2.8.2-dev.38；否则不要执行后续命令

git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.38_TO_2.8.2-dev.39.patch"
# 只有 --check 成功后才应用：
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.38_TO_2.8.2-dev.39.patch"
node -p "require('./package.json').version"
# 期望：2.8.2-dev.39
```

如果使用 `source/` 全量替换，就**不要再应用增量补丁**。已有变更冲突时先停止，保留原工作区，不要强制 apply、reset、删除用户配置或覆盖定制脚本。若此次补丁刚刚完整应用且未再修改，可先 `git -c core.whitespace=cr-at-eol apply --reverse --check`，通过后才反向应用。

## 2. 定向测试（无真实 B站 请求）

```powershell
python -m unittest discover -s test -p "test_v282_dev39_focus_ffmpeg_filter.py" -v
python -m unittest discover -s test -p "test_v282_dev37_focus_window_coverage.py" -v
python -m unittest discover -s test -p "test_v282_dev30_video_focus.py" -v
node --test test/v282-dev37-focus-diagnostics.test.mjs test/v282-dev36-owner-focus-acceptance.test.mjs
node selfcheck.mjs
npm run check:video-tool-contract
npm run check:life-architecture
npm run check:context-budget
npm run check:test-governance
npm pack --dry-run --json
```

真实 FFmpeg 回归会从本机 FFmpeg 命令生成临时测试视频，离线解码后自动删除；若 FFmpeg 不在 PATH，该测试会 SKIP，不能视为已验证。可通过管理中心的 FFmpeg 状态与本机实际执行路径确认。

## 3. Windows / DSH 主人局部实机验收

1. 重新启动 DSH；确认运行版本 dev.39，管理中心 → AI模型 → FFmpeg 解码自测通过。本次使用的实际 FFmpeg 可执行文件必须和插件设置一致。
2. 管理中心 → 运行诊断 → 视频感知全链路 → 主人局部识图专项，BV号 `BV1Smsb6FEb6`。先执行全局低清分镜观察；这一步显示两张全局12格不算局部成功。
3. 从当次验证过的采样锚点选择 **01:10（70秒）**，窗口 **30秒**；开始局部原视频技术验收。后续单独重开一轮可试15秒或20秒。
4. 成功预期 `debugOwnerFocus.status = "focused"`；`focusWindows`、`reviews` 和 `visuals` 均有真实有效回执；图集中出现来自原视频的 `focus-00.jpg` 拼图及独立采样 JPG。实际取帧应按本轮剩余预算和可解码帧限制，**不能复制低清 videoshot 凑数**。
5. 仍失败则记录 `debugOwnerFocus.focusDiagnosis`；尤其关注新的 `code`、`stage`、`decodedFrames`、窗口长度，并导出原有日志 ZIP 内的 `reports/video-focus-last-diagnostic.json`。若仍出现 `video_decode_failed`，需采集本机 FFmpeg **脱敏错误类别和工具版本**以区分媒体文件稀疏分段问题，禁止将 CDN 签名链接或私密令牌放入公开日志。
6. 主人专项**不代表 Life 主动决定观看**；Life 两阶段自主选择仍须单独验收。没有执行真实 B站 写操作，也不绕过授权或网络流量预算。

## 4. 发布门禁

此次只在本地合成文件上做实际 FFmpeg 解码回归，并不保证第三方真实分段 MP4/DASH 在全部 Windows FFmpeg 版本上都能正确解码。需维护者在 Windows/DSH 实机完成上述验收、全量回归后，才可讨论正式发布。
