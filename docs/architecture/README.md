# 大肥鱼 · 当前技术架构

> 本页是维护者的**当前架构入口**，不是版本流水账。任何涉及统一层、事实源、权限、事件流、渠道接线和存储的修改，必须同步更新本页、相应说明、Mermaid 图与回归测试。根 README 始终面向用户。

## 2.7.0-dev.10 当前生产接线（尚未正式发布）

- [统一自主社交决策、P6-A/B 续聊、好友画像、私信自由与 @ 回复权限架构](./2.7.0-unified-social-agency-plan.md) · [目标 Mermaid](./diagrams/2.7.0-social-agency-target.mmd) · [入站 @ 实际接线](./diagrams/2.7.0-incoming-at-live.mmd) · [后台私信自主决策与 P6-A/B 实际接线](./diagrams/2.7.0-dm-autonomy-live.mmd)。**当前 `2.7.0-dev.10` 继承入站 @、私信与公开评论/@ P6-A/B（两个公开 P6 开关默认关闭）和跨渠道互动节奏；好友证据画像已完成限定明确交流偏好与可撤回的跨 DM/评论首阶段，兴趣系统增加有限、低权重的短期开放探索。已经支持按关系阶段使用有限的明确交流画像；更丰富的长期叙事画像与兴趣自主探索仍未全部实现**；下列 2.6.2 图仍是其余渠道的现行生产调用关系。

- [dev.10 行为审计修复：私信停止联系、模型自主表达、关闭话题、待办具体对象与兴趣真实选看证据](./2.7.0-dev10-life-behavior-hardening.md) · [dev.10 实际生产 Mermaid](./diagrams/2.7.0-dev10-life-behavior-live.mmd)。本轮新增的是已有私信状态与已有兴趣档案中的**事实约束**，不是新的生活意愿层。明确停联阻断同账号 UID 的即时/延期私信；隐私请求隔离私密上下文，程序只检查出站、不填充固定答复；旧「值得看/可以看」仍参与原视频判重显示，但**不再充当兴趣自主选择证据**。旧无来源兴趣记录保留供审阅但不得进入兴趣记忆、选片或 Python 表情包排序。实际模型/B站待验收。

- [dev.8 社交推荐从模型承诺到待办保存回执的闭环](./2.7.0-dev8-social-todo-commitment.md) · [dev.8 实际生产 Mermaid](./diagrams/2.7.0-dev8-social-todo-live.mmd)。公开评论/@ 与私信共用同一模型结构化提案和原待办账本；未经核验的“记下了”不再可直接外发，冲突交回同一模型修订而非插入程序模板；最多 3 条独立只读建议、失败安全停止、无正文诊断。

- [dev.7 私信 P6 沉默续聊与诊断补齐：统一层、一次性意图、安全复核、真实生产图](./2.7.0-dev7-dm-silence-reconsideration.md) · [dev.7 实际生产 Mermaid](./diagrams/2.7.0-dev7-dm-silence-live.mmd)。模型可针对尚未结束的私信对话，在正常回复后提出一次“对方沉默再考虑”，不是默认催聊；已保留原来的当轮 `defer` 与延迟补充。只读收件箱暂时失败可有限安全延期，私信页能看到匿名预约聚合数据。

- [dev.6 创作者相遇线索、关注/收藏事实与成长统计诊断：统一层归属、权限和延后事项](./2.7.0-dev6-creator-facts-and-growth-diagnostics.md) · [实际生产 Mermaid](./diagrams/2.7.0-dev6-creator-facts-live.mmd)。新增 B站自主选看后按真实创作者累积相遇线索；关注当前态按单目标 B站 API 查询，与本插件已有关注/取关/收藏的历史回执严格区分。旧推荐功能重构已延后，默认外发权限不变。

- [dev.5 人物详情中的关系分层画像与多平台身份预留：统一层归属、隐私、覆盖矩阵](./2.7.0-dev5-person-portrait-multiplatform.md) · [实际生产 Mermaid](./diagrams/2.7.0-dev5-person-portrait-live.mmd)。人物详情在「逐渐熟悉的人」逐 UID 懒加载已有证据；B站现行接线，其他平台不推测合并；自然联系人到 `known` 才能积累有限明确偏好，不能据此授予发送权。

- [dev.4 好友画像长期边界与开放好奇候选审阅：状态契约、跨渠道矩阵和失败回退](./2.7.0-dev4-portrait-curiosity-review.md) · [dev.4 实际生产 Mermaid](./diagrams/2.7.0-dev4-portrait-curiosity-live.mmd)。P6 到期再次核对可撤回的好友边界；主人可以排除/恢复短期好奇主题，不能修改长期兴趣或任何外发权限。

- [好友交流证据画像与开放好奇探索第一阶段：数据契约、隐私和覆盖矩阵](./2.7.0-dev3-portrait-open-curiosity.md) · [dev.3 实际生产 Mermaid](./diagrams/2.7.0-dev3-portrait-open-curiosity-live.mmd)。

- [公开评论/@ P6 与跨渠道发送节奏（实际生产接线、配置与风险矩阵）](./2.7.0-dev2-public-p6-rhythm.md) · [生产 Mermaid](./diagrams/2.7.0-dev2-public-p6-rhythm-live.mmd)。

## 管理中心的社交入口（2.7.0）

- [社交互动／评论／私信的页面职责、唯一设置源与折叠导航](./2.7.0-social-management-navigation.md) · [可编辑导航 Mermaid](./diagrams/2.7.0-social-management-navigation.mmd)。**本轮 UI 将评论与 DM 设置移动到记录上方并默认折叠；P6 功能与跨渠道节奏的业务行为由上述生产链路独立实现**。

## 修改任何功能之前

- [统一层归属、可以新增新层的条件与架构文档同步门禁](./2.6.2-unified-layer-change-gate.md)
- [当前系统静态审计及未完成的实机验收](./2.6.2-system-audit.md)：**审计基线是当时的开发快照**，其中标为“未实现”的能力可能在后续单独文档中已有更新；以最新代码及下方当前接线文档为准。

## 当前公共层及业务接线

| 主题 | 模块或真实状态来源 | 维护入口 |
| --- | --- | --- |
| 同一人格、成长人格、连续情绪 | `life-voice-context.mjs`、`emotional-state.mjs` | [人格上下文](./2.6.2-life-voice-context.md) · [跨渠道模拟](./2.6.2-one-fish-simulation.md) |
| B站自主关注契机与动作当前态 | `vendor/bilibili-mcp/mcp_server.py` 原账号隔离动作账本；单目标 B站平台只读核验；`verified-life-facts.mjs` 短期动作事实投影 | [dev.6 生产契约](./2.7.0-dev6-creator-facts-and-growth-diagnostics.md) |
| 可信经历与对外主张核验 | `verified-life-facts.mjs`、可信执行回执 | [统一事实、回访背景](./2.6.2-unified-facts-and-followup-context.md) |
| 可衰减记忆、分域反思 | `LifeMemoryGateway`、`memoryRetriever` | [记忆与反思权限](./life-memory-domain-reflection-v2.6.0-dev.4.md) |
| 社交身份、关系、对外权限 | `SocialContextAssembler`、`SocialPolicyGate`；按账号隔离的 `SocialPortraitGateway` 只存明确交流证据；`social-person-identity.mjs` 负责平台隔离展示键 | [关系索引](./dev9-social-relationship-memory.md) |
| 社交只读推荐意愿与已保存待办 | `interaction-batch.mjs` 的同一社交模型输出；`social-todo-intake.mjs` 来源/只读/意愿核验；`owner-todos.json` 原唯一任务账本；`social-todo-reply-contract.mjs` 保守出站一致性检查 | [dev.8 生产契约](./2.7.0-dev8-social-todo-commitment.md) |
| 自主任务、完成进度与回访 | 已接受任务账本、执行回执、意愿及发送层 | [父子探索](./2.6.1-unified-exploration-relationship-visualization.md) · [普通私信进度](./2.6.2-dm-todo-progress.md) |
| 公开评论成功回执与接收人 | `seen.md` 主账本；平台已核验的目标作者与当前账号 runtime 的确认索引，按 BV + 出站 rpid 匹配 | [公开回复接收人契约](./2.6.2-comment-recipient-receipts.md) |
| 评论/@ 的来源与时效 | 平台通知、原评论回查及接线诊断 | [原评论恢复](./2.6.2-at-original-comment-recovery.md) · [通知时间](./2.6.2-at-invitation-diagnostic-times.md) |
| 可选严格私信审核 | 仅在 `dmApprovalEnabled=true` 时识别投喂申请；默认关闭，不作为普通自主交流的前置条件 | [私信自主决策与 P6-A/B](./2.7.0-unified-social-agency-plan.md) |
| 视频资料、情绪与意愿边界 | 字幕／视觉证据、当前情绪状态 | [视觉和情绪优化](./2.6.2-vision-emotion-willingness.md) |
| 账号与数据可靠性 | 账号绑定、备份校验、只读预算 | [账号切换](./2.6.1-account-identity-switch.md) · [备份兼容](./2.6.1-backup-utf8-compatibility.md) · [轮询与管理 UI](./2.6.2-polling-memory-ui.md) |

**事实 ≠ 意愿 ≠ 权限 ≠ 已发送。** 完成任务的成功回执可在合规渠道查询，不应等待回访发送；人格、情绪、事实和可衰减记忆必须使用现有统一层，不能在各聊天入口重复拼装。关系熟悉度不自动授予对外发送权限。

## 事实与人格契约的当前边界

`VerifiedLifeFacts` 已经是自动发言的共享**高置信事实校验接口**，目前支持按视频 BV、视觉／听觉类型匹配成功回执，但不是任意自然语言的全语义判真服务。未能明确对应视频的肯定经历不会借用其他视频的证据；完整视听必须有额外的真实完整回执。详情见 [统一事实与回访契约](./2.6.2-unified-facts-and-followup-context.md)。

`Life Voice Context` 是自动生成文字时的人格、成长与连续情绪的唯一装配层。各场景只追加任务事实、互动历史与授权相关数据，不能重新在模型提示中拼一份情绪／成长描述。主 Session 的长期记忆检索与稳定成长人设是不同职责。详情见 [人格上下文](./2.6.2-life-voice-context.md)。

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
