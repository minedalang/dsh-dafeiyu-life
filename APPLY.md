# 2.8.2-dev.25 · 增量修复与 Windows/DSH 逐步验收

**唯一预期基线：本次会话上传的 `dsh-bili-scroll-plus2 (2).zip`，`package.json` 是 `2.8.2-dev.24`。** 本修复仍是开发候选版。既有 Git 工作区可能有独立修改，本包无法替用户确认实际 `git status`、Tag 与最近 Commit。**先备份工作区和个人数据，不要 reset、删除用户目录、也不要对同一工作区重复应用补丁。**

## 1. 选择一种更新方式

**推荐 Git Patch**（在 Windows PowerShell 的原项目 Git 根目录执行）：

```powershell
Get-Content .\package.json | Select-String '"version"'
git status --short
# 将路径改为你实际解压交付包的绝对路径
$Patch = 'D:\YourDelivery\PATCH_FROM_2.8.2-dev.24_TO_2.8.2-dev.25.patch'
git apply --check $Patch
# 上行必须成功，确认当前源码确为本次 dev.24 基线且没有重叠冲突后再执行
git apply --whitespace=nowarn $Patch
Get-Content .\package.json | Select-String '"version"'
```

预期：补丁应用前版本 `2.8.2-dev.24`，之后 `2.8.2-dev.25`。`--whitespace=nowarn` 仅抑制 git 对**已有 CRLF 行尾**的空白提示，不忽略安全门禁或补丁校验；已在上传基线通过 `git apply --check`、实际应用及文件 SHA-256 一致性核验。如果应用检查失败，**不要**使用 `--reject`、`--3way`、强制覆盖、reset 或删除现有修改。先备份并比较文件差异，按本机实际基线重制补丁。

**或选择完整源码**：使用交付包 `source/` 中的 `2.8.2-dev.25` 完整源码，与原工作区逐文件比较、备份后合并。不要删除个人凭据、数据库、记忆及插件数据。**不能先覆盖 `source/` 再应用同一补丁**。

## 2. 定向自动测试（不会真实发送B站消息）

在项目根目录、安装了 Node.js、项目依赖和 Python + Pillow 后执行：

```powershell
node --check .\lib\vision-host-owned-executor.mjs
node --check .\lib\video-evidence-bundle.mjs
node --test --test-reporter=tap --test-concurrency=1 `
  test\v281-dev3b3319-code-closure.test.mjs `
  test\v282-vision-instruction-boundary.test.mjs `
  test\v282-dev23-life-semantic-focus.test.mjs `
  test\v281-dev3b16-preview-board.test.mjs `
  test\v282-dev20-hybrid-life.test.mjs

# 如果你的项目使用自带 Python，请把 python 改为 run-tests.ps1 输出的 Python 路径
$env:PYTHONPATH = (Join-Path (Get-Location) 'lib')
python -m unittest discover -s test -p test_v282_dev20_hybrid_preview.py -v
python -m unittest discover -s test -p test_v281_dev3b16_preview_storyboard.py -v
python -m unittest discover -s test -p test_preview_vision.py -v
python -m unittest discover -s test -p test_vision_dsh.py -v
python -m unittest discover -s test -p test_v282_dev19_video_recovery_traffic.py -v
```

预期：当前离线环境 **Node 38/38、Python 26/26**。Python 历史测试 `test_preview_vision.py` 在未将 `lib` 加入 PYTHONPATH 的 Linux 中会导入失败；设置上面的路径后通过。测试必须保证安全门禁仍拒绝非法窗口和伪造的证据，不得修改测试来消除合法安全失败。

继续执行：

```powershell
node selfcheck.mjs
npm run check:life-architecture
npm run check:video-tool-contract
npm run check:context-budget
npm run check:test-governance
npm pack --dry-run --json
```

预期全部退出码 0；`check:context-budget` 只证明结构契约，不等于 11 类实际模型上下文已完整送达。**不要在云端运行全量 Node 测试**。

## 3. Windows DSH 实机验收（维护者手动，只读）

1. 备份 DSH 当前配置，确认本次更新是在你原有插件源目录，重启真实 DSH Desktop；在管理中心确认插件识图开关、已配置的视觉模型与低清分镜档位。视觉模型可能产生 API 费用，优先选择自己认可的低成本/本地模型。
2. 找一个可安全公开访问、长度大于 101 分钟的 B站视频（如果不具备，可分别使用不同长度视频验证对应合法时间点），在**主人只读调试**入口选择原视频专项；不要开启公开评论、私信、点赞等写操作。
3. 在可明确输入局部时间的只读验收流程，依次检查 `900～915` 秒、`3600～3615` 秒、`6000～6015` 秒（最后一项仅适用于时长覆盖这个时刻的视频）。预期不再报 `invalid_video_focus`；**不代表一定能下载成功**，下载/CDN/FFmpeg 报错仍需按真实结果显示。
4. 负向检查：`900～902`（少于3秒）、`900～1021`（超过120秒）、`43190～43201`（超过12小时）须被拒绝，且不得启动媒体下载；不能使用模型生成的任意视频网址。
5. 选择一个官方 videoshot 索引超过 3000 格的可用视频（现场不一定能找到）：第一轮选择均衡档24/详查48，检查时间码跨越视频头部、中段和末段；若达到源拼图/扫描格/网络限制，调试回执必须显示 `timeline_scan_complete=false`，不可宣称完整扫描。用 4 张分镜/48帧配置检查实际帧数，不强求凑满。
6. Life 两阶段：只在 Life 自主允许第一轮观看后，检查视觉候选是否只引用已取样的时间点、Life 是否独立选择继续/拒绝/延期。没有 Life 明确复查选择，不应启动 FFmpeg；不应把低清预览当作真实原视频取帧。
7. 记录 Host `invalid_video_focus`、时间码、`sampler_version=9`、`index_frames_available`、`candidate_frames_scanned`、`scan_limited_by`、`source_sheets_scanned`、`heat_source` 和原视频 `image_source` 的**脱敏结果**，不导出 Cookie、私信、模型原文或敏感图片。

**注意：** 不能从离线测试证明真实 CDN、视频权限、视觉模型图像输入能力、B站 -509/网络退避、FFmpeg 和 Windows DSH 都成功。遇到异常须保留失败状态，不自动重试不明回执。

## 4. 正式全量与发布门禁（维护者在 Windows 执行）

普通 PowerShell：

```powershell
.\run-tests.ps1 -Mode full
```

管理员 PowerShell：

```powershell
.\run-tests.ps1 -Mode full
```

分别保留完整日志、实际 PASS/FAIL/SKIP，任何受保护关键测试失败、未解释安全 SKIP、真实 DSH 未验收、M2/OCR 或 M3 11项未签收，都不能正式发布 2.8.2。

## 5. 失败停止与回滚

如果仅通过 Patch 在干净且已核实的 dev.24 工作区更新，且本次之后**没有叠加其他修改**，可先检查：

```powershell
$Patch = 'D:\YourDelivery\PATCH_FROM_2.8.2-dev.24_TO_2.8.2-dev.25.patch'
git apply --reverse --check $Patch
# 确认检查通过且没有后续更改，才执行回退
git apply --reverse --whitespace=nowarn $Patch
```

若合并了自有修改或用了完整源码，优先从事先备份进行**逐文件比较恢复**。不要 `git reset --hard`、不要删除记忆/账号配置/用户数据，不要对未知写入结果自动重试。版本仍标为 dev.25 候选；无自动提交、推送或发布。
