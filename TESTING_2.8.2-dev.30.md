# 2.8.2-dev.30 · Windows / DSH 收口验收手册

> 这是开发候选版，不是正式版发布通知。本轮云端执行的是针对性测试，**Windows 普通与管理员 PowerShell 全量尚需维护者完成**。不得用 `npm pack` 通过代替 DSH 中的真实模型识图与网络验收。

## 1. 确定基线（只选一种更新方法）

- **Git Patch 方式**：工作区须是用户已应用的 `2.8.2-dev.29`。先备份当前工作区或确认 `git status`，勿丢弃现有未提交工作。直接比较 `package.json` 的 `version`。如果已是 `dev.30`，**不可重复应用补丁**。如果本地曾另外修改这些文件，应先合并差异，不强制 reset。
- **完整源码方式**：交付 ZIP 的 `source/` 是完整 dev.30 源码。可以独立拷贝到测试目录使用；不要在覆盖完整源码后再应用同一补丁。

在项目根目录普通 PowerShell 中执行：

```powershell
node -p "require('./package.json').version"
git status --short
git apply --check .\PATCH_FROM_2.8.2-dev.29_TO_2.8.2-dev.30.patch
git apply .\PATCH_FROM_2.8.2-dev.29_TO_2.8.2-dev.30.patch
node -p "require('./package.json').version"
```

预期为 `2.8.2-dev.30`。如果 `git apply --check` 失败，停止应用，检查实际工作区变更和来源版本，不要采用 `--force`、重置提交或强行覆盖文件。

## 2. 定向测试（开发交付已在 Linux 模拟环境执行）

```powershell
node --check .\index.js
node --test --test-reporter=tap --test-concurrency=2 .\test\v282-dev30-video-closure.test.mjs .\test\v282-dev28-multi-focus-budget.test.mjs .\test\v282-dev20-hybrid-life.test.mjs .\test\v282-dev19-video-traffic-ui.test.mjs .\test\v282-dev23-life-semantic-focus.test.mjs .\test\v281-dev3b29-video-debug-life-tree.test.mjs .\test\v281-dev3b18-vision-diagnostics.test.mjs
$env:PYTHONPATH = (Join-Path (Get-Location) 'lib')
$env:PYTHONUTF8 = '1'
python -m unittest discover -s test -p test_v282_dev30_video_focus.py -v
npm run check:video-tool-contract
npm run check:life-architecture
npm run check:context-budget
npm run check:test-governance
node selfcheck.mjs
npm pack --dry-run --json
```

应看到没有 `FAIL`、`ERROR`；尤其 `test_v282_dev30_video_focus.py` 应验证 `640×360` 目标和恶意帧数上限拒绝。Windows 中如果没有 PATH 下的 `python`，使用 `run-tests.ps1` 报告的同一 Python 可执行文件，并设置 `PYTHONPATH`；不要用缺模块当成安全测试通过。

## 3. 全量回归（**维护者在 Windows 分别执行**）

首先用普通 PowerShell，在项目根目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-tests.ps1 -Mode full
```

完成后另开 **管理员** PowerShell，重复同一命令，保存两份原始结果和失败对应的 `step-*.tap.log`，不要从中截掉错误详情。若有关键 FAIL、ERROR 或未解释的 SKIP，停止发布。

## 4. DSH 实机功能验收

1. 以测试状态安装新版插件，并确认 DSH 实际加载的是 `2.8.2-dev.30`。检查依赖更新没有覆盖原有账号授权、记忆与后台 Whisper 模型选择。
2. 打开 **AI 模型**：确认「旧版主人 Agent 模型（兼容配置）」编辑区已消失；实际主人对话功能仍可按原设置正常使用；其他模型任务下拉和思考深度不应丢失。
3. 打开 **次数与额度**：分别查看今日和累计的视频响应流量，以及「轻量/均衡/详查」单次视频观察预算；**不能**将真实字节使用量当成每日自动重置额度。确认多窗口剩余帧数依实际成功样本扣减，失败请求不可伪装成已观察。
4. 打开 **🎞️ 视频感知全链路 · Life 最终输入 Debug**：选择「完整两阶段」。必须由真实 Life 自主决定是否深入；若拒绝，应没有原视频局部读取。若自主选两个不同可信时刻，应分别显示两个窗口和累计帧/时长/字节回执；假时间码应拒绝，不能触发网络读取。
5. 用允许公开读取的 B站视频测试实际采样：全局区域是低清 videoshot 分镜；局部区域是 FFmpeg 对原视频流的解码采样帧，新的原视频输出上限为 **640×360 / 360p**。低于该分辨率的源不应被放大为“真实高清”，图片说明不得把单张诊断采样帧冒充为单独的视觉模型输入。
6. 使用一个有多个独立场景的视频：均衡档选择两个相距较远的候选、逐段取得真实画面；第一个窗口实际取得 3 帧时，第二个窗口应只预留剩余 **21 帧**，不会因为前一个的理论 24 帧额度而直接拒绝。拒绝、网络失败、账户切换、B站限流和无效证据均须有解释且不自动外发评论/点赞。
7. 复查 Whisper：在管理中心确认本地安装脚本路径可解析；选择已有模型转写一段授权可读音频，模型安装可继续显示真实下载进度；不主动清理用户模型。再次校验 `scripts/download_whisper_model.py` 在 npm 发布包内。
8. 检查 `tools/导出B站日志.bat` 在完整源码目录存在、能导出必要的脱敏回执；不得把 BV、视频画面或完整模型答案直接写入公开审计文件。

## 5. 失败与回滚

- 任一关键安全断言失败：**停止发布**，保留原日志，检查补丁和该测试真实约束。不要取消账号校验、HTTP 来源白名单或额度限制来让测试变绿。
- `git apply` 在未提交工作区应用失败时：保持原有文件状态，先检查差异并取得与实际版本匹配的补丁；不要用 `git reset --hard`。
- 需要回滚且补丁已经完整应用、工作区没有后续重叠改动时，先 `git apply --reverse --check .\PATCH_FROM_2.8.2-dev.29_TO_2.8.2-dev.30.patch`，确认后运行 `git apply --reverse ...`；已有后续修改需人工检查，不能强行反向覆盖。
- 该回滚只涉及程序代码；不得自动清除 `.hf-cache`、Cookie、账号备份、Life 记忆和视频经历。

本次没有代用户执行 Git 提交、推送或 npm 发布。
