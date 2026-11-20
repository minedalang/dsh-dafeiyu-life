# 2.8.2-dev.38 · 主人局部视频拼图及失败机器原因验收

## 更新

以**完整原始 dev.37** 为基线，先运行 `node -p "require('./package.json').version"`，必须显示 `2.8.2-dev.37`。仅在此版本基线上执行：

```powershell
git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.37_TO_2.8.2-dev.38.patch"
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.37_TO_2.8.2-dev.38.patch"
node -p "require('./package.json').version"
```

检查失败**不要继续应用**。已用完整 `source/` 替换源码就不要再打 Patch。回滚仅在本轮补丁确实已应用、没有后续修改时，可先 `git -c core.whitespace=cr-at-eol apply --reverse --check ...`，通过后才反向应用。不要重置、删除现有用户配置或重放旧补丁。

## Windows / DSH 真实验收

1. 重启 DSH 确认运行源码版本 `2.8.2-dev.38`，本地 Ollama 和 FFmpeg 状态正常。打开管理中心→运行诊断→视频感知全链路→**主人局部识图专项**，使用 `BV1Smsb6FEb6` 先生成全局低清分镜。
2. 在受信时间点选择 **02:41（161秒）**，时长 **15秒**；执行主人局部原视频识图。重新从头开始另一轮再测试20秒，不在同一轮重复请求。
3. 若 `debugOwnerFocus.status = focused`，查看图集应先出现**原视频局部分镜拼图**（文件名 `focus-00.jpg`，对应真实解码时间），下面有最多12张逐帧 JPG。分镜是原视频最高360p取样而非全局低清 videoshot；只有真实解码成功才有此图。确认 `focusWindows`、`reviews` 和 `visuals` 均有受信结果。
4. 若 `status = focus-unavailable`，查看 `focusDiagnosis.code`：现应显示受信安全工具状态，例如 `public_playurl_unavailable`、`video_mp4_index_unavailable`、`video_decode_failed`、`platform_rate_limited` 等；`reports/video-focus-last-diagnostic.json` 也应保留同一安全码。**没有图片不代表渲染错误，可能是工具未能提供一帧可验证原视频。**
5. 若仍显示 `tool-result-unavailable`，说明工具没有返回受支持的机器错误码（例如返回值缺失或异常）。请导出本机诊断日志和 `vision-events` 原有事件（如已开启），查清平台/媒体层根因，不能把它当作模型问题或强行降级冒充原视频。
6. 检查切换账号、重复提交、无效时间点和缺失媒体源都不会泄漏前一账号的图片或绕过网络预算。主人专项是只读技术验收，不会产生真实 Life 观看经历。确认已有 `tools/导出B站日志.bat` 未被替换。

## 离线定向测试

```powershell
node --test test/v282-dev37-focus-diagnostics.test.mjs test/v282-dev36-owner-focus-acceptance.test.mjs test/v281-dev3b29-video-debug-life-tree.test.mjs
python -m unittest discover -s test -p "test_v281_dev3b12_video_images.py"
python -m unittest discover -s test -p "test_v282_dev37_focus_window_coverage.py"
node selfcheck.mjs
npm run check:video-tool-contract
npm run check:life-architecture
npm run check:context-budget
npm run check:test-governance
npm pack --dry-run --json
```

离线 mock 验证不能证明 B站 CDN 当前可用、ffprobe 必然取得索引或本地视频模型成功。本次没有执行 Windows 全量测试或真实外发；2.8.2 正式发布仍阻断。
