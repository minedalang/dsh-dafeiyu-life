# 2.8.2-dev.29 · Windows/DSH 发布收口验收教程

## 0. 前提和备份

确保工作区为 `2.8.2-dev.28` 且没有与修复补丁冲突的本地修改。先保存 `git status --short`、`git diff`；单独备份配置及运行数据，**不删除、不覆盖用户目录中的凭据、记忆或 Whisper `.hf-cache`**。

## 1. 应用修复

在仓库根目录 PowerShell 运行（把 `$Patch` 换成实际下载位置）：

```powershell
$Patch = 'D:\Delivery\PATCH_FROM_2.8.2-dev.28_TO_2.8.2-dev.29.patch'
(Get-Content package.json -Raw | ConvertFrom-Json).version  # 必须先是 2.8.2-dev.28
git status --short
git apply --check --whitespace=nowarn $Patch
if ($LASTEXITCODE -ne 0) { throw '基线不符：停止，禁止 --reject 或 reset --hard' }
git apply --whitespace=nowarn $Patch
if ($LASTEXITCODE -ne 0) { throw '应用失败：停止并核对工作区' }
(Get-Content package.json -Raw | ConvertFrom-Json).version  # 应为 2.8.2-dev.29
```

若源码已独立升级到 dev.29，**不要再应用补丁**。

## 2. 定向 Node 回归和 Python 进度

```powershell
node --test --test-reporter=tap --test-concurrency=1 test/dev8-model-selection-ux.test.mjs test/v271-dev4-life-agent-phase5-social-shadow.test.mjs test/v271-dev4-life-agent-phase6g-shadow-audit.test.mjs test/v271-dev4-life-agent-phase6ijk-send-transactions.test.mjs test/v281-dev3b1-timeline-and-setup.test.mjs test/v281-release-preflight-no-prepare.test.mjs test/v282-dev3-semantic-coverage.test.mjs test/v282-dev27-whisper-model-cache.test.mjs
node --test --test-reporter=tap --test-concurrency=1 test/issue11-fixes.test.mjs test/v282-dev16-video-asr-diagnostics.test.mjs test/v282-dev28-multi-focus-budget.test.mjs test/v282-context-delivery.test.mjs
python -m unittest discover -s test -p test_v282_dev27_whisper_progress.py -v
node selfcheck.mjs
npm run check:video-tool-contract
npm run check:context-budget
npm run check:life-architecture
npm run check:test-governance
```

预期：所有定向测试 PASS。代码级 mock 通过只验证程序行为，不能代替模型真实下载。

## 3. 验证发布文件

```powershell
$pack = npm pack --dry-run --json | ConvertFrom-Json
if (-not ($pack[0].files.path -contains 'scripts/download_whisper_model.py')) { throw 'P0 仍未修复：npm 发布包缺少下载脚本' }
Write-Host 'Whisper downloader is in npm distribution.'
```

也可执行 `npm pack --ignore-scripts`，用压缩包查看器确认 `package/scripts/download_whisper_model.py`。注意本机仓库有脚本不等于 npm 安装后有脚本，必须核验发布包。

## 4. DSH Windows 真实验收

将修复后的插件通过你日常使用的 DSH 插件安装/更新方式加载。确认 DSH 实际运行的是 **2.8.2-dev.29**，不是仍指向旧 `dev.28` 的 `node_modules`。

在管理中心选择 Whisper `base`（或容量允许的 `tiny`），点击安装；观察进度和日志自动刷新。预期无 `can't open file ...download_whisper_model.py`，依赖阶段和模型文件阶段分别显示，下载结束状态为 `modelReady=true`，然后用一段真实语音执行一次转写并核实成功回执。若镜像网络超时，记录原始日志并停止继续尝试，不要反复清空缓存。切换到另一个已安装型号后再验证旧模型的删除按钮，当前使用中/自定义外部目录不可删除。

在可信视频上检查全局分镜、批量选择两个不同候选、真实 MP4/DASH 局部取帧、第二次候选保留和网络/帧/窗口预算回执。**重点检查两个15秒窗口在首窗少量采样后能否实际执行第二窗**；如遭预算拒绝，本次不满足多候选正式验收，禁止视为正常通过。

## 5. Windows 全量（必须由维护者实机执行）

```powershell
.\run-tests.ps1 -Mode full
```

分别记录普通和管理员 PowerShell 的每批 PASS/FAIL、完整日志路径、脚本退出码。任一关键 FAIL、ERROR、跳过或真实媒体验收失败都阻断 2.8.2 正式发布。此命令**本轮云端没有执行**。

## 6. 失败停止与安全回滚

- 如果第 2/3 步失败，不更新真实 DSH 插件，先保留完整输出。
- 如果步骤 4 真实 Whisper/视频失败，不删除 `.hf-cache`、用户记忆、账号凭据或 Python 环境；先导出诊断日志。
- 如果只应用了该 Patch，未提交且未叠加其他修改，可以先做 `git apply --reverse --check --whitespace=nowarn $Patch`；检查成功后才反向应用。
- 禁止 `git apply --reject`、`git reset --hard`、自动评论/私信重试来绕过问题。
