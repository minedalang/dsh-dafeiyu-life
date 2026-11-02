# 2.6.1-dev.3 · P4 已接受待办统一层（增量）

## 已接线

入口：`SocialInteractionCoordinator` 可信身份、评论/私信推荐 → `DualContextAgency` 意愿 → 已接受视频提议 → `createOwnerTodoEngine` 兼容账本 → `AutonomousPlanner` 按实时关系重排 → 只读执行/原有授权人工执行 → 结果状态。

- `lib/video-recommendations.mjs`：短期 *未接受* 的选片线索，非承诺；自带防刷屏与 48 小时查看期限。
- `lib/social-todo-intake.mjs`：仅解析可信事件中明确、短且可核验的公开视频主题搜索，复用 `DualContextAgency` 意愿结果，拒绝或延期不入账；不允许通过此接口访问通知、私信、关注、发布等私有或写入动作。
- `lib/owner-todos.mjs`：统一 *已接受* 的本地任务，保留 `owner-todos.json` v1 数据结构和旧 API；新增有限 `acceptance` 元数据、`history`、`page()` 以及 `recoverInterrupted()`。管理员手动创建视作显式添加，不假冒鱼鱼经历意愿评分。
- `index.js`：插件初始化中断恢复；管理 GET `/api/bili-duty/owner-todos/page?filter=active|all|finished&limit=20&cursor=...`，权限沿用原有本机管理接口与首次启动门禁。
- `lib/management-console.js/html`：分页、筛选、来源说明及生命周期历史。

## 严格边界

1. 社交关系仅影响意愿和调度优先顺序，不能成为外发权限。
2. 未接受的推荐不计为已承诺待办；已接受事项不能因时间流逝被静默删除。
3. 写入动作仍需既有独立授权与真实平台回执；`running` 中断后写入标为 `uncertain`，禁止自动重复执行。
4. 保留原数据库/JSON 的备份与读取方式。状态与来源不新增陌生人私信原文；后台列表 API 仍不能输出任务的外发正文。
5. 历史已结束的任务可在达到 500 条限制时回收，但不清理未完成的待办；分页使用稳定创建时间与任务 ID 的游标。
6. 旧 `docs/architecture/diagrams/implemented-unification-v2.6.0-dev.4.mmd` 是原版本快照，不能宣称覆盖 dev.3；本文是 dev.3 实际增量接线依据。

## 后续 P4/P5/P6

通用任务类型的证据提取、更多外部渠道的候选接收、长期公平调度、接受后临执行意愿复核以及情绪回忆回访继续分阶段开发，不提前打开陌生人 DM 或主动外发。
