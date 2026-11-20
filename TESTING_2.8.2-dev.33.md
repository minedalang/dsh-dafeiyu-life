# 大肥鱼 Plus · 2.8.2-dev.33 Windows / DSH 验收教程

## 0. 版本和边界

- **前置基线必须是已正确应用的 `2.8.2-dev.32`**。本补丁不能直接叠加在 dev.31 或正式旧版。
- 只应用一种交付方式：在现有工作区应用 PATCH，**或**把 ZIP `source/` 作为新的完整代码。切勿先覆盖源码再应用同一 Patch。
- 不修改已有用户记忆、账号/授权资料、不自动提交/推送/发布。正式版仍需 Windows 全量与真实 DSH 验收。
- 如果有个人改动，先备份/提交或暂存重要内容；不要使用 `git reset --hard` 或删除现有日志导出工具。

## 1. 在项目根目录预检

```powershell
node -p "require('./package.json').version"
git status --short
git -c core.whitespace=cr-at-eol apply --check '.\PATCH_FROM_2.8.2-dev.32_TO_2.8.2-dev.33.patch'
```

版本应当先为 `2.8.2-dev.32`。如 `--check` 报已应用、重叠修改或目标文件已存在，不要强行应用。确认当前源码和相应文件，保留现有工作区改动并停止该步骤。

## 2. 应用并再次验证

只有第1步检查通过才执行：

```powershell
git -c core.whitespace=cr-at-eol apply '.\PATCH_FROM_2.8.2-dev.32_TO_2.8.2-dev.33.patch'
node -p "require('./package.json').version"
git status --short
```

版本应为 `2.8.2-dev.33`；原有 `tools/导出B站日志.bat` 应继续存在，本补丁没有重新新增它。

## 3. 本机定向回归

在 PowerShell 项目根目录执行：

```powershell
node --test --test-concurrency=2 test/v282-dev33-closure.test.mjs test/v281-dev2b-local-vision-manager.test.mjs test/v282-dev32-local-vision-controls.test.mjs test/v282-dev31-board-provenance.test.mjs test/v281-dev2a-video-evidence-bundle.test.mjs test/v281-dev3b6-video-life-handoff.test.mjs test/v281-release-core-feature-and-vision-permission-ux.test.mjs
node selfcheck.mjs
node scripts/check-context-budget.mjs
node scripts/check-video-tool-contract.mjs
node scripts/test-governance.mjs check
npm run check:life-architecture
npm pack --dry-run
```

Python 专项需使用你 `run-tests.ps1` 所选择的已支持 Python，并设置仓库路径：

```powershell
$env:PYTHONPATH = "$(Get-Location)\lib;$(Get-Location)\test"
python -m unittest -v test_v282_dev33_asr_cache test_v282_dev32_ollama_board_controls test_v282_dev31_board_receipts test_v282_dev16_asr_worker
```

本批 Linux 离线定向测试通过不等于 Windows 全量测试通过。正式发布前执行 `./run-tests.ps1 -Mode full`，保存失败明细；根据项目发布门禁记录普通及管理员 PowerShell 环境，勿绕过安全失败。

## 4. DSH 实机验证步骤与预期

1. **升级并重启 DSH**，确认实际加载 `2.8.2-dev.33`，避免仍运行旧 npm 缓存。
2. 管理中心 → AI 模型 → 本地 Ollama 视觉模型：能选 `Qwen3.5 2B`；MiniCPM-V 4.7 1B 显示“不建议常规使用”。硬件提示**默认可见**，清楚告知无显卡/显存不足也能 CPU＋系统内存运行，显存数字只是加速建议。模型需要明确安装和人工图片验收，不能自行下载、删除或直接开启视觉。
3. 视频探索 → `每张低清分镜的格数`：分别选择4、6、12格并保存，刷新页面核对，预期不再报 `dmFollowAutonomyEnabled`。切换前后的主人私信/自主关注授权必须保持原值。回读不一致必须显示失败，不要宣称成功。
4. 选同一 GTA 视频（或可信公开视频），总24帧、每张4格：预期6张分镜；Debug 逐张展示模型返回、**证据验证器接收**及**Life 实际收到**的数量。缺一张、时间错乱应拒绝交给 Life，不能因为只收到文字就认为看懂。
5. 同样以每张6格和12格验收：依次为4张、2张分镜，时间点总数不变。运行模型不保证每张视觉判断都准确，需人工对照原图，尤其01:05楼梯与04:41飞机外景。
6. AI 模型 → Whisper：将转写语言选为“自动”，保存后读取验证。对一条已授权可读取、没有可用官方字幕的公开视频执行两次转写；第二次在同一 BV/模型/语言设置、有效短期缓存且启用缓存时，Debug 应显示“复用本机转写”，推理时间约0，实际请求仍经过正常权限检查。切到中文/英文应不能误用旧语言缓存；混合语言输出须人工核对。
7. 更换自定义 ASR 模型目录或不提供 `BILI_DUTY_HOME` 时，不能重用共享旧缓存；不允许改写账号授权、模型运行权限、媒体字节预算或 Life 外发门禁。

## 5. 若失败，如何处理

- `git apply --check` 失败：不要强制覆盖；保留工作区，提供准确的 `git status --short` 与报错行用于重基补丁。
- 视觉结果 `analyzed` 但 Life 接收0张：保存 Debug 完整JSON、显示每张 `visionBoardReceipts` 状态与 `sampling.sampler_version/tiles_per_storyboard`；不要将未验证回执写入 Life 事实。
- ASR 仍慢：查看 `Whisper 耗时拆分` 中音轨下载、模型加载、CPU 推理是否为主耗时。首次运行、缓存过期、语言/模型变化或缓存被禁用时允许正常重算。
- 单纯安装 Ollama 模型失败：分别检查可用**系统内存**、磁盘、CPU 模式速度和可选显存；不能宣称“显存不够就无法运行”。
- 如需退回原版本，请使用此前保留的 dev.32 源码/你自己的 Git 备份恢复。**不要通过删除或重置用户账号/记忆数据回滚**。
