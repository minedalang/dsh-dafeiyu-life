# 2.8.1-dev.3b.33.24 发布前审计与定向验证记录

## Windows 维护者提供的 full 测试证据（2026-11-18 10:08:55）

- `./run-tests.bat full` 第 9 个专项 `test/v271-dev3-three-phase-execution.test.mjs`：6 tests、5 pass、1 fail，失败名称 `vision locks only real low-resolution frame fetch, not nested independent DSH`。
- 该专项被标记为“必须通过”，runner 因而提前停止：`570` 个 Node 文件尚未全部运行。**这次 Windows full 不能宣布通过。**
- 当前云端源码 `.23` 可复现相同失败：老测试假设 `mode == 'independent_dsh'` 后立刻导入 Python 函数。实际 `.19+` 存在健康 Python wrapper 的受限调用，以及没有该运行时才使用的直接 import 兼容分支。

## 本次修正（没有更改任何生产执行逻辑）

1. `test/v271-dev3-three-phase-execution.test.mjs`：断言健康 Python wrapper、兼容分支、原始帧下载的预算/预约存在，同时确认 DSH 父层不持有 `bili_preview_frames` 预约锁。
2. `test/v281-dev3a4-storyboard-contract.test.mjs`：继续验证真实 SVG、Mermaid、frame plan，但改在现存架构文档查找图，不要求根 README 恢复旧图。
3. `docs/architecture/2.8.1-video-perception-dev3a4.md` / 历史审计 / `docs/release`：消除图文位置与已迁移生产视觉的过时描述。
4. `AGENTS.md`：增加强制规则——用户 `full` 必须完整结束零失败；不得以局部回归代替发布门禁。

## 当前环境验证

- 直接相关的两项测试文件：**8/8 pass**。
- 连同视觉运行时、Debug、DASH 证据、私信嵌套读取与 2.8.1 发布引导相关的 8 个测试文件：**31 tests / 30 pass / 1 skipped / 0 fail**。跳过项因当前隔离环境缺少可选 YAML 解析依赖，不能视为 Windows 依赖齐全场景的通过。
- `node scripts/check-life-architecture.mjs`：通过，4 Mermaid / 126 个代码节点。
- `node scripts/check-video-tool-contract.mjs`：通过。
- `node selfcheck.mjs`：通过。
- `npm pack --dry-run --ignore-scripts --json`：通过，721 文件。
- 没有运行云端全量 570 个 Node 测试、未运行真实 B站操作。

## 发布决定：HOLD（暂缓正式 2.8.1）

以下仍需要维护者 Windows 端实际关闭；任何一项缺失都不能称为完整发布验收：

1. 在干净的 `.24` 源码上执行 `./run-tests.bat full`，等待最终综合表明确**全部通过**，不仅是第 9 个专项通过；报告必须包含后续测试。
2. 实机 DSH 图片验收以及真实公开视频的 DSH 全流程感知，确认视频帧与模型回答，不能以固定图片验收或合成 FFmpeg 文件替代。
3. 真实公开长视频 DASH / DURL 取帧、索引失败 / 低清 fallback / 网络预算、Windows FFmpeg/ASR/OCR；平台业务异常时必须有可解释原因。
4. 从旧 `.19` / 2.8.0 升级、旧配置与账号隔离、双通知哨兵与 `-509`、跨重启发送未知冻结及回滚验证。
5. 正式版再将 package.json、package-lock.json、README、CHANGELOG 和 Release Notes 同步更新为 `2.8.1`，核对实际 npm/DSHMarket/Git tag 内容一致。

**不可从一次测试失败推断产品一定存在真实视觉死锁；也不可由一条旧测试修复和有限离线通过宣称产品正式无缺陷。**
