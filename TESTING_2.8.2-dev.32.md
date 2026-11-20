# 2.8.2-dev.32 Windows / DSH 验收指南（开发候选版）

## 1. 补丁基线与应用

确保当前项目为 `2.8.2-dev.31`，请先保存工作区的个人更改；本次不会删除原有日志导出工具或模型缓存。

```powershell
node -p "require('./package.json').version"
git status --short
git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.31_TO_2.8.2-dev.32.patch"
```

第一条必须返回 `2.8.2-dev.31`；`--check` 不通过时停止，不能强行覆盖，更不能执行 `git reset --hard`。仅确认原有项目未被二次应用过本补丁，且无冲突后，执行：

```powershell
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.31_TO_2.8.2-dev.32.patch"
node -p "require('./package.json').version"
```

应为 `2.8.2-dev.32`。**完整 source 与 Patch 只能二选一**；不要覆盖 source 后重复运行补丁。出现失败须使用自己保留的 Git 工作树/备份判断回滚范围，不要清除账号或缓存。

## 2. 开发环境离线定向测试

下列内容在交付容器执行了定向验证，并非 Windows 全量通过声明。维护者在 Windows 可按需复测：

```powershell
node --test --test-concurrency=1 test/v282-dev32-local-vision-controls.test.mjs test/v282-dev31-board-provenance.test.mjs test/v281-dev2b-local-vision-manager.test.mjs
$env:PYTHONPATH="lib;test"
python -m unittest -v test_v282_dev32_ollama_board_controls test_v282_dev31_board_receipts
node selfcheck.mjs
npm run check:life-architecture
npm run check:video-tool-contract
npm run check:context-budget
npm run check:test-governance
npm pack --dry-run
```

## 3. 管理中心人工验收

1. 进入「快速设置 → 02B 视频感知」，保存全局帧数 **24 帧**、低清分镜格数 **4 格**。总采样仍为24帧，应产生至多6张2×2分镜；改回12格后通常产生2张4×3分镜。不能把4格误当总帧数4帧。
2. 进入「AI 模型 → 本地 Ollama 视觉模型」，选择 `qwen3.5:4b`，将思考深度设为**关闭思考**，点击「保存本地识图思考设置」。刷新后确认保存值仍为关闭。切换模型后应自动查询 Ollama `/api/show` 支持的级别，不支持的低/中/高不得启用。
3. 在调试页，用前次 GTA 视频 BV `BV1Smsb6FEb6`，选择低清全局概览进行**只读**观察。查看 `visionBoardReceipts`：每张分别有 index、times、gridCols/gridRows、status；正常返回时每张4个格子编号，无缺失/重复/伪造第四行，且按整片时间排序。
4. 再用同一视频选择6格与12格对照（可选择轻量档减少模型调用）。模型输出必须对应每个格子的时间码；语义错误仍应人工标记，不能仅因结构通过就称准确。
5. 选择思考“开启”时观察实际输出 Token 用量、完成原因与耗时。等级如不支持应提示而不是默默套到模型；即使模型只返回 `thinking`、输出文本为空或 `done_reason=length`，也必须返回不完整，而不是 `analyzed`。
6. 若使用 48 帧、4格，最多会产生 12 次本地模型调用；每张 Token 预算更高，因此耗时可能明显增长。每次观察仍有明确最长总时长，到期要保留已成功的逐张回执、未完成原因，不能把未观察的内容冒充成功。
7. 切换到 DSH Provider 模式，确认原有 DSH 视觉「思考深度」没有被本地 Ollama 选项覆盖。

## 4. 本机正式版放行门禁

由维护者分别在普通与管理员 PowerShell 执行：

```powershell
.\run-tests.ps1 -Mode full
```

保留完整运行日志与每个失败 TAP 细节；**不得把云端定向回归冒充 Windows 全量或真实模型精度验收**。还须完成真实 Qwen3.5 4B、MiniCPM、短/长视频、缓存重用、模型切换、Whisper 真实转写和网络异常回退。视图能显示两张分镜，不等于语义准确率已经过关。M2 语义互证与 M3 上下文送达未验收时不能放行正式版。
