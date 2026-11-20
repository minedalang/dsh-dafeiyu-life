# 2.8.2-dev.35 · Windows / DSH 收口验收

## 1. 基线与补丁（dev.34 → dev.35）

在普通 PowerShell 进入项目根目录。不要为应用补丁执行 `git reset --hard`、手动清空用户数据或卸载本地模型。

```powershell
node -p "require('./package.json').version"
git status --short
```

须为 `2.8.2-dev.34`，且补丁将触及的文件未存在未协调的个人修改。将增量补丁放在根目录，然后先检查：

```powershell
git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.34_TO_2.8.2-dev.35.patch"
```

**只有上一条成功后**再应用：

```powershell
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.34_TO_2.8.2-dev.35.patch"
node -p "require('./package.json').version"
```

应显示 `2.8.2-dev.35`。若 `--check` 失败请停止，不要 `--reject`、强制覆盖或删除已有文件。完整 ZIP 的 `source/` 与 Patch 是**替代交付方式**，绝不能两种方式连续覆盖。

## 2. Windows 离线定向验证

```powershell
node --check lib/interaction-scheduler.mjs
node --check lib/autonomous-planner.mjs
node --check lib/life-continuation.mjs
node --check lib/video-focus-review.mjs
node --test test/v282-dev35-dm-focus-closure.test.mjs test/v281-rc-notification-sentinel-scheduler.test.mjs test/v281-rc-notification-sentinel-state.test.mjs test/v281-dev3b20-dm-rate-limit-adaptive.test.mjs test/v281-dev3b332-dm-rate-limit-probation.test.mjs test/v282-dev20-hybrid-life.test.mjs test/v282-dev28-multi-focus-budget.test.mjs test/v282-dev30-video-closure.test.mjs
node selfcheck.mjs
npm run check:life-architecture
npm run check:video-tool-contract
npm run check:context-budget
npm run check:test-governance
npm pack --dry-run
```

Python 定向验证（DSH 正在使用的 Python 环境；先于实际视频下载）：

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'lib')
python -m unittest discover -s test -p 'test_dev3a2_life_selected_focus.py' -v
python -m unittest discover -s test -p 'test_v282_dev30_video_focus.py' -v
python -m unittest discover -s test -p 'test_v282_dev15_video_diagnostics.py' -v
Remove-Item Env:PYTHONPATH
```

## 3. 私信与限流实机验收（禁止人为制造 -509）

1. 确认当前 B站已登录且当前账号隔离正确，备份现有持久化状态和日志；不要复制 Cookie 或会话令牌到工单。
2. 无新消息时，运行诊断应看到未读哨兵约5分钟、`get_sessions` 一致性核对仍约30分钟一次。若读取被共享预算或平台冷却阻断，则不得因到时而立即重试。
3. 只读检查最近私信哨兵的未读值、`pending`、`lastDetailAt`、DM 列表读请求次数及 `networkBackoff.dm`。没有新消息时不应每5秒反复拉取 `get_sessions`；一笔失败不应错误清除 pending。
4. 使用离线测试中的 `ok:false` 模拟校验，预期诊断结果为 `error`，不出现“成功完成”；模拟 `-509` 后持久退避并阻断同窗口再次拉取。**不得通过反复线上请求制造限流**。
5. 在可控测试账号上切换已登录身份，再观察通知调度；旧账号的异步未读值与列表返回不得落到新账号的账本。
6. 若实机仍有 -509，先导出脱敏日志与 read-budget/退避记录，核对视频信息、字幕、其他读取在15/60分钟的总量；**不要擅自调长30分钟兜底或提高重试频率**。

## 4. Life 局部视频感知 E2E 验收

请用主人的只读视频 Debug 和受控测试 Episode（不启用点赞、评论、关注、私信外发）验证：

1. Life 全局视频观察完成、拿到可信官方 videoshot 分镜回执；旧的空观察/过期 Episode 不提供 `focus_video`，也不崩溃。
2. Life 可自主选择放弃、延期或选择可信候选；不能凭模型自行编造新的 BV、URL 或未取样时间点。
3. 当 Life 确实选择复查时，记录同账号、同 BV、可信时间窗、每窗口可用帧数/网络字节预算；实际 FFmpeg 从原视频解码最高640×360代表帧。
4. 视觉模型识别真实局部取帧、证据验证器接收后，Episode `result focus_video` 与 `action-result` 应具有匹配窗口、帧数及来源；继续检查 Life 下一轮是否收到结果。
5. 专门测试预算耗尽、模型返回失败、FFmpeg失败、账号在等待期间变化等失败分支；应有明确的 blocked/失败原因，不能只留下孤立 `action-start`，不能把失败视为 verified，更不能越过账号或外发门禁。
6. 进行两次互不重叠的真实窗口复查，核对每次使用的帧数、字节与剩余额度，只扣减实际可信读数；未获得完整证据的路径不得宣称“全链路成功”。

## 5. 正式版门禁、回滚

- 本轮仅在 Linux 环境通过**与变更直接相关的定向 Node/Python**、项目自检、架构/视频/上下文/治理和 npm 包预检；**Windows 普通/管理员 full、真实 B站 -509 恢复和 Life 局部视频完整 E2E 仍需维护者执行**。
- 普通和管理员 PowerShell 分别执行 `./run-tests.ps1 -Mode full`，保留完整输出与意外 SKIP；如果存在关键 FAIL、账号隔离问题或局部复查缺失成功证据，**不得发布正式 2.8.2**。
- 尚未在补丁后更改重叠文件时，可先 `git -c core.whitespace=cr-at-eol apply -R --check ".\PATCH_FROM_2.8.2-dev.34_TO_2.8.2-dev.35.patch"`，通过后再 `git -c core.whitespace=cr-at-eol apply -R ...`。不要强制 reset。
- 不进行生产平台写操作、Git commit/push、npm publish。
