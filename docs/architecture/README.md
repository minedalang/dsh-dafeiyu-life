# 大肥鱼技术架构档案（2.6.0-dev.4）

本目录面向维护者。根 README 只保留简要功能说明及本目录入口，不展示全部内部调用链。

## Life Memory 高层设计与实现映射

- [README 同款六层简图（SVG）](./life-memory-overview-v2.6.0-dev.4.svg)：面向读者，不包括底层 API 和具体实现。
- [可编辑的 Mermaid 六层简图](./life-memory-overview-v2.6.0-dev.4.mmd)：与 README 展示图内容对应。
- [分域反思权限、保留与备份契约](./life-memory-domain-reflection-v2.6.0-dev.4.md)：来源矩阵、分级记忆和剩余边界。
- [私密经历与分域反思实现映射](./life-memory-private-reflection-implementation-v2.6.0-dev.4.mmd)：区分主人主 Session / 主人 DM / 各 UID 好友 DM、受限反思及公共评论路径。

**关键边界：** 私密来源只形成经过确定性过滤的短摘要，不将原始 DM 原文作为反思证据；反思证据只来自当前尚未遗忘的经历副本；各私密域独立批次，私密领悟不可直接进入公开记忆、动态或公共人格投影。陌生人公开评论继续作为公开视频社交经历参与反思候选。

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
