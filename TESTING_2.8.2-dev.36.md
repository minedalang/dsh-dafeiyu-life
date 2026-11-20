# 2.8.2-dev.36 · Windows / DSH 定向与真实验收教程

## 1. 安全应用补丁（dev.35 → dev.36）

普通 PowerShell 进入项目根目录。先确认基线和本地修改：

```powershell
node -p "require('./package.json').version"
git status --short
```

预期为 `2.8.2-dev.35`。保留所有用户数据、旧日志工具、已有 Ollama 模型和本地改动；如果将触碰的文件已有个人修改，先协调差异，不要强制覆盖。把独立的增量补丁放到根目录：

```powershell
git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.35_TO_2.8.2-dev.36.patch"
```

只有 `--check` 通过后才执行：

```powershell
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.35_TO_2.8.2-dev.36.patch"
node -p "require('./package.json').version"
```

预期 `2.8.2-dev.36`。如果补丁检查失败立即停止，不要 `--reject`、`git reset --hard`、手动删除项目文件或改写用户身份数据。也可以直接从完整包 `source/` 获取完整源码，但不能再打增量补丁。

## 2. Windows 离线定向验证

```powershell
node --check index.js
node --check lib/video-focus-review.mjs
node --check lib/video-owner-focus-debug.mjs
node --check lib/life-video-read-admission.mjs
node --check lib/management-console.js
node --test test/v282-dev36-owner-focus-acceptance.test.mjs test/v282-dev20-hybrid-life.test.mjs test/v282-dev23-life-semantic-focus.test.mjs test/v282-dev28-multi-focus-budget.test.mjs test/v281-dev3b29-video-debug-life-tree.test.mjs
node selfcheck.mjs
npm run check:life-architecture
npm run check:video-tool-contract
npm run check:context-budget
npm run check:test-governance
npm pack --dry-run
```

这不是完整测试。正式发布前仍需普通与管理员 PowerShell 分别执行 `./run-tests.ps1 -Mode full` 并记录真实 FAIL/SKIP。

## 3. 主人局部识图专项：不需要等待 Life 自愿深入

1. 在 DSH 中安装/重启插件，确认 B站账号和所选图像模型、FFmpeg、网络预算均可用。
2. 打开 **管理中心 → 运行诊断 → 🎞️ 视频感知全链路 · Life 最终输入 Debug**。
3. 输入 `BV1Smsb6FEb6`，选择 **主人局部识图专项 · 不需 Life 同意**，点击“开始只读视频感知验收”。这一步从真实 B站低清分镜生成可信采样时间列表（不是原视频局部），可能出现 ASR 缓存命中。
4. 第一阶段完成后，同一页出现已核验的时间点下拉框。选择 **01:05（65秒）**，时长 **15秒**，点击 **开始所选局部原视频识图**，二次确认。
5. 预期局部范围约为 **57.5～72.5秒**；成功需在 Debug 看到 `debugOwnerFocus.status="focused"`、`focusWindows` 至少1条、采样帧与实际输入字节，以及 `visuals` 中真实视觉模型回答。界面出现 **“主人已验证局部窗口”** 和原视频图像，代表一次完整受控局部证据成功；这**不代表 Life 已自主观看，也不保证模型文字语义准确**。
6. 失败须显示 `focus-unavailable` 和 `reason`（例如 `focus-tool-failed`、`focused-evidence-not-verified`），不生成 Life 经历。无视觉能力、账号切换、无真实取样点、预算不足、重复提交必须拒绝。调试图像仅本机同账号可用，最多保留约30分钟。

## 4. Life 自主两阶段仍单独验收

切换到 **完整两阶段**，同一视频先做真实低清全局识图。Life 收到逐格 Qwen 图像线索（未独立核实语义）后，仍可选择不深入。如果跳过，局部 FFmpeg 不会执行。只能在 Life **真实同意**、独立选择某个可信点、局部视觉证据成功后，才认为 Life 的那条自主链完整。主人专项绝不替代这个门禁。

## 5. 中断、失败与回退

- 诊断完成仍须核查模型图片内容与对应时间。机器返回 `analyzed` 不代表文字内容正确。
- 若遇到真实网络限流，保存脱敏日志，遵守现有 B站共享预算和退避；不要通过反复尝试制造 `-509`。私信列表30分钟核查没有改动。
- 如需在未引入其他交叉修改时回退补丁，先检查：

```powershell
git -c core.whitespace=cr-at-eol apply -R --check ".\PATCH_FROM_2.8.2-dev.35_TO_2.8.2-dev.36.patch"
```

检查通过后才执行相同命令去掉 `--check` 的 `apply -R`。若检查失败，不要强制逆向覆盖，应基于当前改动协商恢复。此次没有修改真实 B站设置、记忆或账号数据，也没有执行 Git 提交、推送、npm 发布。
