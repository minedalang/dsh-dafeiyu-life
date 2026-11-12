# 2.8.0-dev.3 · 实际离线测试结果（2026-11-12）

## 本次新增及定向回归

- 新增旧版备份协议 / 作者文案 / UI 测试 `test/v280-dev3-official-backup-compat-and-owner-ui.test.mjs`：**8/8 通过**。
- 合并 6 个相关测试文件（第一代备份、第二代哈希、原备份恢复、记忆跨版本、Unicode、原 v2.4.68 备份保护）：**31/31 通过**，`node --test` 退出码 0。
- `npm run check:life-architecture`：通过（4 张 Mermaid、109 个代码节点）。
- `node selfcheck.mjs`：通过，使用隔离测试家目录，不访问真实 B站或用户家目录。
- `node --check`：`lib/data-backup.mjs`、`lib/management-console.js`、`index.js`、`client.js` 均通过。
- `npm pack --dry-run --json`：通过；增量 Git Patch 逐文件还原验收见交付说明。

## 全量 Node 测试（没有宣称全通过）

`npm test` 本轮执行输出汇总：**2413 项：2324 通过、82 失败、7 跳过**。大范围旧测试中存在不少固定旧版本号、旧 README 或旧 UI 位置断言，也包含需要进一步分析的业务测试；不能笼统把 82 项全部标为“本轮无关”。

在未修改的 dev.2 基线上单独回放了 `v271-rc10-life-defer-and-public-wake.test.mjs`、`v2480-memory-sticker-backup.test.mjs`、`v270-stable-release-contract.test.mjs` 三组共 8 项：4 通过、4 失败，证实至少部分失败为既有问题。其他失败仍待逐项归因。本轮没有为消除旧测试红灯而篡改 Life 发送门禁或旧发行事实。

## 历代备份覆盖说明

官方旧代码确认：v2.4.99 使用 `schema:1`（无原始签名，支持两个 format）；v2.5.0 及后续已抽查正式版本使用 `schema:2` + SHA-256。测试样本是按官方旧版**生成协议**构造，不是对所有官方发行版本从真实用户目录导出的原件逐一恢复；因此**不能承诺百分百覆盖任何用户的历史/损坏/外部改动备份**。具体见 `docs/architecture/2.8.0-dev3-official-backup-compatibility.md`。

保留原始 `schema:2` 哈希和严格路径校验；旧无身份备份额外确认；旧 `schema:1` 仅内部结构适配，不声称已验证原始 SHA-256。旧备份不能代替冷停机全量快照，未知旧数据目录也不在便携白名单内。

## 尚未完成的正式发布门禁

未对用户真实 Windows DSH 旧备份进行现场恢复，也未完成 UI 浏览器视觉实测、模型/B站端到端、72 小时运行和跨日自然成长验收。`releaseReady:false`；源码版本继续为 `2.8.0-dev.3`。
