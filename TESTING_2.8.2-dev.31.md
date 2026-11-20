# 大肥鱼 Plus 2.8.2-dev.31 · Windows / DSH 实机验收教程

## 0. 应用前核对

以已正确应用 `2.8.2-dev.30`、本地 `tools/导出B站日志.bat` 已存在的项目为基线，不需要删除已有文件。先备份本地未提交的改动和配置，不要重置或删除 DSH 记忆数据。

```powershell
node -p "require('./package.json').version"
git status --short
```

预期当前源码是 `2.8.2-dev.30`。如果已是 `2.8.2-dev.31`，不要重复应用补丁；如果有自定义编辑的重叠文件，应先核对差异后再处理，不能强行覆盖。

## 1. 检查并应用增量补丁

将 `PATCH_FROM_2.8.2-dev.30_TO_2.8.2-dev.31.patch` 放在项目根目录，执行：

```powershell
git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.30_TO_2.8.2-dev.31.patch"
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.30_TO_2.8.2-dev.31.patch"
node -p "require('./package.json').version"
```

预期 `2.8.2-dev.31`。补丁不重建 `tools/导出B站日志.bat`，也不要求删除它。`apply --check` 失败时停止；不要直接用 `--force` 或 `git reset --hard`。

## 2. 受影响代码定向回归

在项目根目录执行：

```powershell
node --test --test-concurrency=2 test/v282-dev31-board-provenance.test.mjs test/v281-release-welcome-features.test.mjs test/v281-release-onboarding-vision-guidance.test.mjs test/v281-dev3b16-preview-board.test.mjs test/v281-dev3b6-video-life-handoff.test.mjs test/v282-dev20-hybrid-life.test.mjs test/v282-dev30-video-closure.test.mjs test/v282-dev28-multi-focus-budget.test.mjs test/v282-dev23-life-semantic-focus.test.mjs test/v282-dev5-video-visual-coverage-dedup.test.mjs test/v281-readme-user-facing-contract.test.mjs
```

上述增量 Node 测试应全部通过。Python 测试使用本机 DSH 可用 Python 环境（需要 Pillow）。PowerShell 可使用：

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'lib')
python -m unittest discover -s test -p test_v282_dev31_board_receipts.py -v
python -m unittest discover -s test -p test_v281_dev3b16_preview_storyboard.py -v
python -m unittest discover -s test -p test_v282_dev20_hybrid_preview.py -v
python -m unittest discover -s test -p test_v281_local_ollama.py -v
```

项目检查：

```powershell
node selfcheck.mjs
npm run check:life-architecture
npm run check:video-tool-contract
npm run check:context-budget
npm run check:test-governance
npm pack --dry-run --json
```

## 3. Windows 实机真实视觉回执验收（必须）

重启 DSH，确认当前加载的是新插件版本而非旧 npm 包。管理中心 → 视频探索开启可选视觉；在 AI 模型页确认本地 Ollama 的图片能力真实验收成功。不要因模型能回答图片问题就认为视频语义准确。

对用户报告的视频（或者其他有明确楼梯/转场时间的视频），依次测试：

- **12帧**：1 张分镜，观察 `visionBoardReceipts` 只有 `index:1`，状态是 `analyzed` 或清晰失败。
- **24帧**：2 张分镜，模型分别收到一次图片请求；检查 Debug 「模型逐张分镜回执」两项都有实际回答、图像源、采样时刻，`modelDescription` 同时含分镜图1和图2。
- **48帧**：最多4张分镜，不足不凑数；分别检查每张结果。超过总推理时限时应明确呈现未完成，不得保存为“全部看懂”。
- **画面对应**：放大 Debug 原始 JPEG，确认 00:40 仍是大厅、01:05 左右才到楼梯；模型不得将 00:40 的动作强行当作已逐帧核实的真相。即使时间码合法但画面理解错误，也须作为模型质量问题记录。可更换视觉模型或使用原视频复查进一步核验。
- **异常回归**：模拟缩短响应、模型中断或不支持图片时，应显示 `vision_incomplete` 等失败状态，Life 不得将部分回答算完整视觉观察。不能通过重复下载或额外授权绕过预算。
- **UI 版本**：设置首页显示 `✨ 2.8.2 版本亮点`，快速设置和欢迎导览展示 2.8.2；既有账号登录、Life 记忆和开关保持原值。

## 4. 全量发布门禁

必须在维护者的 Windows 真实工作区继续执行：

```powershell
.\run-tests.ps1 -Mode full
```

分别保留普通与管理员 PowerShell 结果；全量测试关键失败、真实 Ollama/DHS 图片输入未验收或多候选真实原视频窗口链路异常，都不能正式发布 2.8.2。云端定向测试不代替 Windows 全量、真实 B站来源及 M2/M3 端到端验收。

## 5. 失败时停止与回滚

仅在目标工作区无后续修改、变更均由本补丁引入时，先确认 `git apply -R --check` 能通过，再执行反向补丁；否则从维护者自己的备份或 Git 差异选择性恢复。不要删除用户模型、插件记忆、账号凭据或其他尚未提交的工作。保留脱敏日志报告错误的具体阶段和版本。
