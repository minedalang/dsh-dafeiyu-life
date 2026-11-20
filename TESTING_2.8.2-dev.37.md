# 2.8.2-dev.37 · 可变局部窗口和失败诊断验收（Windows / DSH）

## 更新与范围

从完整、干净的 `2.8.2-dev.36` 项目应用 `PATCH_FROM_2.8.2-dev.36_TO_2.8.2-dev.37.patch`，或使用交付 ZIP 的 `source/` 完整源码。二选一，不能先替换又叠加补丁。应用前先运行 `git -c core.whitespace=cr-at-eol apply --check <patch>`。

此候选版没有改变 Life 自主意愿、最多360p、真实视频网络字节预算、全局12/24/48帧配置、每张低清12格、私信未读哨兵/30分钟会话核查间隔或 B站外发门禁。

## 核心手工验收：15秒与20秒都要测

1. 管理中心 → 运行诊断 → 视频感知全链路 → **主人局部识图专项**。填写 `BV1ddsr6GEDs`，运行全局识图以取得本轮实际验证过的采样时间。
2. 在可选时间点选 **02:06**；先选15秒，开始“所选局部原视频识图”；完成后查看 `debugOwnerFocus`：实际解码候选数、实际选中帧数、模型返回状态、证据验证阶段、是否 `focused`。静态镜头只要 FFmpeg 真正解码出足够画面且额度足够，时间覆盖策略应尽量选择12个不同时间点，而不是旧版的3个；不足12帧时查看具体不足原因，绝不复制图片补数。
3. 再独立运行一次全局预览并选择 **02:06 / 20秒**，核对时间覆盖仍延伸到整个20秒窗口，且实际选中帧数不超过12与剩余帧预算。也分别试10秒/30秒（可选）；Life 自主局部仍以它真实选择的窗口和剩余额度为准，可能不足12帧。
4. 如失败，除了界面的 `debugOwnerFocus.focusDiagnosis`，重新导出 B站日志 ZIP，查看 `reports/video-focus-last-diagnostic.json`：`stage` 和 `code` 可区分工具/FFmpeg、视觉模型、解码来源、视觉回执和预算/时间校验。该文件不含 BV 号、账号明文、帧图片或模型描述。
5. 打开 Life 行动树，查看近期嵌套 `observe_video` / `focus_video` 的真实执行和结果；拒绝深入不应伪装为局部成功。主人专项成功也不能显示为 Life 自主观看经历。

## 结果判定

- 成功：`debugOwnerFocus.status === 'focused'`，且局部回执通过 `verifyVideoFocusReview`。仅有截图**不是**成功；截图在视觉模型返回前就可能保存。
- 失败：`focus-unavailable`；先查看细分 `focusDiagnosis.stage/code`，不从“只有3张”单独推出根因。
- `reports/` 的新增脱敏失败记录由既有日志导出脚本自动收集，不需要修改 `tools/导出B站日志.bat`。
- 不得使用主人专项结果冒充 Life 自主选择。需要另外验收真实 Life 事件从全局观察、选择窗口、局部取帧、视觉回执到 Life 继续决策的完整证据。

## 相关离线复测

```powershell
node --test test/v282-dev37-focus-diagnostics.test.mjs test/v282-dev36-owner-focus-acceptance.test.mjs test/v282-dev35-dm-focus-closure.test.mjs test/v281-dev3b29-video-debug-life-tree.test.mjs test/v281-dev3b10-video-review.test.mjs test/v281-dev3b23-dash-evidence.test.mjs test/v282-dev28-multi-focus-budget.test.mjs test/v282-dev31-board-provenance.test.mjs
python -m unittest discover -s test -p "test_v282_dev3*.py"
node selfcheck.mjs
npm run check:life-architecture
npm run check:video-tool-contract
npm run check:context-budget
npm run check:test-governance
npm pack --dry-run --json
```

本地定向测试**不能证明**用户的 Windows、FFmpeg、Ollama 和 DSH 实机全链路已通过。正式 2.8.2 仍需 Windows 普通与管理员全量测试，并结合真实运行日志审计。没有自动提交、推送、发布或触发 B站外发。
