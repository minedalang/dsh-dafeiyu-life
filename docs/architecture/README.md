# 大肥鱼 · 当前技术架构（2.6.2 dev）

> 本页是维护者的**当前架构入口**，不是版本流水账。任何涉及统一层、事实源、权限、事件流、渠道接线和存储的修改，必须同步更新本页、相应说明、Mermaid 图与回归测试。根 README 始终面向用户。

## 修改任何功能之前

- [统一层归属、可以新增新层的条件与架构文档同步门禁](./2.6.2-unified-layer-change-gate.md)
- [当前系统静态审计及未完成的实机验收](./2.6.2-system-audit.md)：**审计基线是当时的开发快照**，其中标为“未实现”的能力可能在后续单独文档中已有更新；以最新代码及下方当前接线文档为准。

## 当前公共层及业务接线

| 主题 | 模块或真实状态来源 | 维护入口 |
| --- | --- | --- |
| 同一人格、成长人格、连续情绪 | `life-voice-context.mjs`、`emotional-state.mjs` | [人格上下文](./2.6.2-life-voice-context.md) · [跨渠道模拟](./2.6.2-one-fish-simulation.md) |
| 可信经历与对外主张核验 | `verified-life-facts.mjs`、可信执行回执 | [统一事实、回访背景](./2.6.2-unified-facts-and-followup-context.md) |
| 可衰减记忆、分域反思 | `LifeMemoryGateway`、`memoryRetriever` | [记忆与反思权限](./life-memory-domain-reflection-v2.6.0-dev.4.md) |
| 社交身份、关系、对外权限 | `SocialContextAssembler`、`SocialPolicyGate` | [关系索引](./dev9-social-relationship-memory.md) |
| 自主任务、完成进度与回访 | 已接受任务账本、执行回执、意愿及发送层 | [父子探索](./2.6.1-unified-exploration-relationship-visualization.md) · [普通私信进度](./2.6.2-dm-todo-progress.md) |
| 评论/@ 的来源与时效 | 平台通知、原评论回查及接线诊断 | [原评论恢复](./2.6.2-at-original-comment-recovery.md) · [通知时间](./2.6.2-at-invitation-diagnostic-times.md) |
| 陌生人私信申请 | 验证过的投喂记录、人工审核 | [漏识别申请补录](./2.6.2-dm-rice-history-recovery.md) |
| 视频资料、情绪与意愿边界 | 字幕／视觉证据、当前情绪状态 | [视觉和情绪优化](./2.6.2-vision-emotion-willingness.md) |
| 账号与数据可靠性 | 账号绑定、备份校验、只读预算 | [账号切换](./2.6.1-account-identity-switch.md) · [备份兼容](./2.6.1-backup-utf8-compatibility.md) · [轮询与管理 UI](./2.6.2-polling-memory-ui.md) |

**事实 ≠ 意愿 ≠ 权限 ≠ 已发送。** 完成任务的成功回执可在合规渠道查询，不应等待回访发送；人格、情绪、事实和可衰减记忆必须使用现有统一层，不能在各聊天入口重复拼装。关系熟悉度不自动授予对外发送权限。

## 当前图（编辑源优先）

- [开发者架构 Mermaid](./diagrams/2.6.2-life-system-current.mmd) · [SVG](./diagrams/2.6.2-life-system-current.svg)
- [用户理解版 Mermaid](./diagrams/2.6.2-life-system-user.mmd) · [SVG](./diagrams/2.6.2-life-system-user.svg)
- [统一人格 Mermaid](./diagrams/2.6.2-life-voice-unified.mmd)
- [事实和外发 Mermaid](./diagrams/2.6.2-verified-facts-outbound.mmd) · [SVG](./diagrams/2.6.2-verified-facts-outbound.svg)
- [@ 原评论恢复 Mermaid](./diagrams/2.6.2-at-comment-recovery.mmd)
- [Life Memory 六层 Mermaid](./life-memory-overview-v2.6.0-dev.4.mmd) · [SVG](./life-memory-overview-v2.6.0-dev.4.svg)

修改生产调用图时必须检查图中所称“当前已实现”与源码一致；不能仅更新图、不更新代码，也不能把计划图冒充实现图。

## 历史基准（保留审计，不是最新运行图）

- [2.6.0-dev.4 全业务架构审计](./system-architecture-audit-v2.6.0-dev.4.md) · [补充审计](./AUDIT_v2.6.0-dev.4.md)
- [业务入口](./diagrams/business-entrypoints-v2.6.0-dev.4.mmd) · [评论与私信](./diagrams/social-interaction-current-v2.6.0-dev.4.mmd) · [记忆同步](./diagrams/memory-event-sync-current-v2.6.0-dev.4.mmd)
- [已实施统一层（当时）](./diagrams/implemented-unification-v2.6.0-dev.4.mmd) · [统一层目标（当时）](./diagrams/unified-layers-target-v2.6.0-dev.4.mmd)
- [早期首次引导](./first-start-and-headless-gate-v2.6.0-dev.4.md) · [早期推荐设置](./recommended-settings-v2.6.0-dev.4.md)
- [早期自主任务与回访](./2.6.1-accepted-task-followup.md) · [历史提案，不是现行真值](./2.6.2-verified-life-events-proposal.md)

旧版规划、重复说明和未使用草稿的清理清单参见 [历史文档索引](../archive/README.md)。正式版本说明参见 [发布文档](../release/README.md)。
