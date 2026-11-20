# 大肥鱼 Plus 2.8.2-dev.28 · Windows / DSH 安装与验收教程

**基线版本：`2.8.2-dev.26`。目标：`2.8.2-dev.28`（内部 dev.27 Whisper + dev.28 多候选合并交付）。** 本补丁不可在其他版本或已经部分应用的工作区上重复执行。

## 0. 备份与基线

在仓库中执行 PowerShell：

```powershell
Get-Content package.json -TotalCount 6
 git status --short
```

必须确认版本是 `2.8.2-dev.26`，并做好自有配置、目录、记忆和未提交变更的备份。不要因补丁冲突而清理现有数据、Reset 工作区或删除 `.hf-cache`。如果版本或文件不同，先对照 `README-交付说明.md` 再处理；可直接使用 ZIP 内 `source/` 作为备份副本/全量代码参照，不要全量覆盖后再应用同一 Patch。

## 1. 仅选一种应用方式

**推荐增量 Git Patch：** 假设补丁文件复制至仓库同级目录：

```powershell
cd G:\WorkSpace\WorkspacePython\dsh-bili-scroll-plus2
 git apply --check ..\PATCH_FROM_2.8.2-dev.26_TO_2.8.2-dev.28.patch
 git apply ..\PATCH_FROM_2.8.2-dev.26_TO_2.8.2-dev.28.patch
 node -p "require('./package.json').version"
```

最后应输出 `2.8.2-dev.28`。**或者**备份原仓库后把 ZIP 内 `source/` 作为完整目标源码；二者不要叠加。补丁检查失败时停止，不要使用 `--reject`、`--3way` 或 `reset --hard` 强制覆盖用户已提交的前置变更。

## 2. 定向回归（Node.js / Python）

```powershell
node --test --test-concurrency=1 test/issue11-fixes.test.mjs test/v282-dev27-whisper-model-cache.test.mjs test/v282-dev28-multi-focus-budget.test.mjs test/v282-dev23-life-semantic-focus.test.mjs
python -m unittest discover -s test -p test_v282_dev27_whisper_progress.py -v
node selfcheck.mjs
npm run check:video-tool-contract
npm run check:context-budget
npm run check:life-architecture
npm run check:test-governance
npm pack --dry-run --json
```

如果 Python 使用已有 Anaconda 环境，用 `G:\Anaconda3\python.exe -m unittest ...`，命令与其他测试使用同一可用 Python。上述只是定向回归，不是 Windows full 发布验收。

## 3. Whisper：真实安装和安全删除

1. 完全退出并重启 DSH Desktop，进入**设置 → 大肥鱼 → 管理中心 → AI 模型 → 视觉识别模型**。
2. 先在模型选择 `tiny`，明确保存，再点击安装。核对先出现 Python 环境/包安装，后出现当前 Hugging Face 模型文件的真实下载字节数；期间不要手动刷新页面，看实时日志是否自动更新。若总字节数未知，应显示阶段而非杜撰百分比。
3. 如果 Windows 出现 symlink warning，确认不会因此误报安装失败。等待模型初始化的真实退出码与文件 readiness；再用允许的视频音频实际运行转写，确认最近真实转写回执，而不是只看 `asrReady=true`。
4. 确认之前存在已下载且非当前选中的 `small` 时，在“已安装模型”中确认删除；检查 small 目录消失而 tiny 仍可加载。**不要在未备份或共享外部目录时测试删除。** 首先用测试沙箱进行删除安全专项更稳妥。
5. 测试当前已选 tiny 的删除按钮不可用、模型安装进行中无法删除、外部自定义模型目录不可由管理页删除、非法名称不被接受。遇到文件占用应显示失败且模型不被错误标记清除。

## 4. 多候选视频真实验证（不要自动公开发言）

1. 只开启你已经验证可识别图片的 DSH/Ollama 视觉模型。选均衡档24帧；确认 Life 自主意愿、账号与视频来源仍受授权控制。
2. 选择合法公开视频并等待可信全局 videoshot 回执，核对候选列表最多6个（轻量4个、详查8个），没有真实采样点不得凭模型文本补候选。
3. 如果 Life 选择两个独立时间锚点，应看到两处分别经 FFmpeg 有界取帧并验证，不能因第一处完成而清空其他全局候选。再次决策时应仍能选择不同的未观察事件。
4. 测试两个邻近点的重叠窗口合并；某一个事件被纵向探索时仍保留另一事件候选。一次批量选择允许在资源用尽或读取失败时提前终止，不能自动绕过账号/HTTPS/网络预算。
5. 确认三档的局部窗口数、累计实际帧、累计时间和网络预算逐次扣减，下一轮不重置；同一可信锚点的相同请求不能重复扣费读取，失败后只写已核验的回执。读取不到原视频时要明确显示降级原因。
6. 用只读调试工具测试时，区分旧的**单次两阶段调试**与新 **Life Episode 自主多候选生产续行**，不能把调试工具的一次行为冒充 Life 自主批量决策。

## 5. 正式发布前仍需执行

在 **普通 PowerShell** 和 **管理员 PowerShell** 分别运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-tests.ps1 -Mode full
```

分别保存完整日志、退出码、测试失败与跳过细节。Windows/DSH 本机、真实 Whisper 模型首次下载、视频 MP4/DASH CDN、FFmpeg 原始取帧、模型运行成本及 M2/M3 遗留项目仍未在开发容器验证，**目前不建议正式发布**。

## 6. 停止与回滚

任何 Python 环境损坏、不能启动管理中心、账号作用域错误、原视频预算超支或未经 Life 授权的读取均应立即停止实测；保留日志与原始设置备份。已经应用补丁且未做其他修改时，可先检查反向补丁：

```powershell
 git apply --reverse --check ..\PATCH_FROM_2.8.2-dev.26_TO_2.8.2-dev.28.patch
```

检查通过后再执行 `git apply --reverse ...`；如果存在后续提交或工作区修改，先备份并人工合并，不强行反向覆盖。模型缓存删除不可用 Git 补丁恢复，须重新安装所需模型。
