# 大肥鱼技术架构档案（2.6.0-dev.4）

本目录面向维护者。根 README 只保留简要功能说明及本目录入口，不展示全部内部调用链。

## Life Memory 高层设计与实现映射

- [README 同款六层简图（SVG）](./life-memory-overview-v2.6.0-dev.4.svg)：面向读者，不包括底层 API 和具体实现。
- [可编辑的 Mermaid 六层简图](./life-memory-overview-v2.6.0-dev.4.mmd)：与 README 展示图内容对应。
- [分域反思权限、保留与备份契约](./life-memory-domain-reflection-v2.6.0-dev.4.md)：来源矩阵、分级记忆和剩余边界。
- [私密经历与分域反思实现映射](./life-memory-private-reflection-implementation-v2.6.0-dev.4.mmd)：区分主人主 Session / 主人 DM / 各 UID 好友 DM、受限反思及公共评论路径。

**关键边界：** 私密来源只形成经过确定性过滤的短摘要，不将原始 DM 原文作为反思证据；反思证据只来自当前尚未遗忘的经历副本；各私密域独立批次，私密领悟不可直接进入公开记忆或动态；仅在成长人格已开启时，可由白名单、低敏证据产生匿名低权重人格倾向，公开输出只使用抽象特质，不得包含任何私密事实。陌生人公开评论继续作为公开视频社交经历参与反思候选。

- [首次启动引导与全局锁定架构](./first-start-and-headless-gate-v2.6.0-dev.4.md)：老用户一次性引导、必需项状态、模型同步、操作解锁与登录验证。

## 当前实现与开发依据

- [dev.4 实际统一层接线图](./diagrams/implemented-unification-v2.6.0-dev.4.mmd)：依据源码核对的实现图；专用证据读取与共享策略层有明确边界。
- [全业务与 A-01～A-11 复核报告](./system-architecture-audit-v2.6.0-dev.4.md)：七项原始开发目标、各业务生产入口、审计问题状态、测试与仍待实机验证的内容。
- [进一步审计明细](./AUDIT_v2.6.0-dev.4.md)：补充检查事项与代码定位。
- [老用户推荐配置与恢复入口](./recommended-settings-v2.6.0-dev.4.md)。

## 原始审计图（历史基准，不等于最终实现）

- [业务入口与各统一层](./diagrams/business-entrypoints-v2.6.0-dev.4.mmd)。
- [评论、@ 和私信的审计时调用链](./diagrams/social-interaction-current-v2.6.0-dev.4.mmd)。
- [人生记忆、社交事件及多域状态投影](./diagrams/memory-event-sync-current-v2.6.0-dev.4.mmd)。
- [统一层目标契约](./diagrams/unified-layers-target-v2.6.0-dev.4.mmd)：目标图不表示所有边界已实施。

## 图纸维护原则

1. 跨模块行为改动必须同步修订实际调用图、目标图和覆盖矩阵，并保留版本历史。
2. 只有追踪真实入口、数据来源、UID 隔离、权限与最终写入、回执及重启恢复后，才能宣称某条业务路径完成统一。
3. Life Memory 与社交事件的 outbox 属于不同领域；不得把原始私信或陌生人真实 UID 写入公开人生记忆或便携备份。
4. 不得从永久档案恢复已经淡化或遗忘的细节；视频、评论与热门评论未获取时不得向 AI 伪称已读取。
5. 修改任何统一层，必须补足实际生产 wiring、故障注入、隐私与幂等性回归测试。

## dev.6 动态评论与跨系统适配

- [动态评论、内容 ID、去重及人生记忆审计](dynamic-comment-integration-v2.6.0-dev.6.md)：新增文字/图文动态的人工回复、安全回执和可衰减记忆投影；dev.4 图示继续作为历史基线。

## dev.9 社交关系与记忆增量

- [自然发展关系、轻量 SQLite 索引与记忆衰减接线](dev9-social-relationship-memory.md)：`SocialInteractionCoordinator → SocialRelationshipIndex → SocialContextAssembler / LifeMemoryGateway`。关系阶段与授权角色分离，未扩大主动私信或对外操作权限。

## 2.6.1-dev.3 · 统一待办增量

- [P4 已接受待办生命周期、分页与恢复的真实接线](dev261-unified-accepted-todos-dev3.md)：继续沿用 `owner-todos` 和 `AutonomousPlanner`，未覆盖任意类型任务或自主回访。

## 2.6.1-dev.4 · 主 Session 和 B站私信的真实双向生活状态

- [主 Session/主人 DM/好友 DM 的情绪、私密经历、成长人格接线及权限矩阵](dev261-main-dm-conversation-life-dev4.md)：说明真实信号、同轮反馈、源身份、哈希去重、隐私审查与仍未实现的 P5-B。

## 2.6.1-dev.6 新增接线审计

- [自主待办提醒、真实关注机会和人格弱证据](dev261-agency-growth-follow-todos-dev6.md)：管理 HTTP、双域意愿、平台写入边界与 Life Memory 证据约束。

## 2.6.1 RC2 · 连续经历与自然回访（发布前）

- [统一记忆、待办、自主回访与后续对话接线图和权限审计](./2.6.1-accepted-task-followup.md#rc2-连续人生经历补充接线当前实现)：只使用仍清晰的衰减记忆取证，确认发送后保留短期接话，纠错和个人感想按隐私域抽象保留。

- [2.6.1 全社交 AI 待办接入](dev261-social-willingness-todo-wiring.md)：主人、好友与普通用户私信/评论复用同轮 AI 意图输出，统一来源核验与待办入账。

## 2.6.1 RC2 · 连续探索与关系显示

- [统一父子探索与关系优先展示](./2.6.1-unified-exploration-relationship-visualization.md)：生产调用、模型预算、历史兼容、关系只读投影、关系卡片与隐私边界。

## 2.6.1 RC2 · 稳定角色身份和平台账号切换

- [鱼鱼身份与 B站账号解绑：生产接线、迁移、冻结、回退与验收](./2.6.1-account-identity-switch.md)。
- [2.6.1～2.9.1 详细未来路线](../FUTURE_ROADMAP_2.6.1_TO_2.9.1.md)：P6 原延期计划和自主学习/视频感知/人文反思的版本归属，非当前实施范围。
