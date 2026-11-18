# .25 全系统 CI 与全量测试审计修复报告

**基线**：`.24-release-preflight`；另提供 `.23` 累积升级。审计源：维护者 2026-11-18 10:19:58 的 Windows `run-tests.bat full`。

## 原 Windows 全量测试事实

- 570 个 Node 测试文件，47 批主测试全部执行；日志存在 **95 条 `not ok`**（95 条失败断言，不是 95 文件）。
- Python 全量：**350 项，5 FAIL、7 ERROR、2 SKIP**，必须补验 Windows symlink 安全跳过项。
- 插件 `selfcheck` PASS，几项启动前关键安全专项 PASS；不能等价于整套 PASS。
- GitHub `npm run check:life-architecture` 错误发生在 `.23`；根因之一是生成器输出 CRLF 与 Linux checkout LF 不一致。修复把生成器统一 LF、Git 属性固定 LF、校验按逻辑文本比较且内容变化时必须失败。

## 当前 .25 已验证的修复

- 单次离线关联回归：**81/81 Node PASS，0 SKIP**（见 `selected-regressions.tap`）。
- Python 关联回归：动态评论 mock **4/4**、DSH 图像单测 **3/3**、固定图片自检 **6/6**（见单独日志）。这些 Python 用例在 Linux 单独通过不代表 Windows Python full 失败已被根治。
- 另有 16 条明确废弃的旧 README/版本/轮询文字测试子用例已按标题逐条删除；完整清单见 `docs/release/2.8.1-full-suite-triage-20261118.md`，其余安全测试留存。
- 生产修复：旧 DM 退避迁移一次性持久化；owner DM 推荐偏好可信入口恢复；重复 `dm-recovery-status` DOM ID 去重；发布验收匿名只读 S0/S1 入口恢复。
- 架构/视频契约和宿主 selfcheck 通过；npm pack 与 Git patch 回放见下方记录。

## 不得误称全部修复

- 尚未执行 .25 更新后的 Windows `run-tests.bat full`，其余旧失败的测试与 Python 全量交叉污染**未被证明消失**。仅真实过期测试才删，正常运行逻辑和安全门禁不删除。
- 没有拿到 Windows `step-N.tap.log` 的完整 JS assertion / Python traceback，部分剩余失败只能初步分类、不能宣称已经修复。
- Linux 下所有定向通过不能替代 Windows PATH/终端字符集/符号链接权限/DSH Electron 真实回执；`2.8.1` 正式发布阻断仍存在。

## 快速复验

```powershell
npm run check:life-architecture
npm run check:video-tool-contract
.\run-tests.bat full
```

若失败，请保留原始所有 `step-*.tap.log`，不要只复制“not ok”标题。对实际语义变更，应修改生产代码并补测试；对仅版式变化或已退役文案，应退役准确的旧子断言；绝不删除隐私、安全预算、未知发送、账号隔离等测试。


### 已知失败文件定向复测（持续阻断）

对原始 Windows 失败清单中的 **66 个 Node 文件**单独进行有范围的复测，当前 `.25` 源码得到 **403 tests / 369 pass / 34 fail / 0 skip**。这是清理与局部修复后的实际数值；**仍有 34 项失败，不能视为 CI 或 Windows full 通过**。另对 7 个版本、记忆与 README 契约文件单独执行 **43/43 通过**，两组测试存在交集，不可与其他定向测试计数直接相加。详细未关闭项见 `known-failing-files-retest.tap`。
