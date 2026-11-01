# 大肥鱼技术架构档案（2.6.0-dev.4）

本目录面向维护者。根 README 只保留简要功能说明及本目录入口，不展示全部内部调用链。

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
