# 文档导航

本目录给维护者使用；普通用户从根目录 [README](../README.md) 和 [首次使用教程](../README.md#-首次使用教程) 开始。

| 需要了解 | 唯一入口 | 适用范围 |
| --- | --- | --- |
| 当前系统结构与模块调用 | [架构首页](architecture/README.md) | 当前 `2.7.1-dev.37`，优先阅读统一 Life Episode、主评论 P0 诊断及真实回执与记忆接线 |
| 统一层的归属、新层准入与文档同步规则 | [变更门禁](architecture/2.6.2-unified-layer-change-gate.md) | 每项代码需求修改前 |
| 人格和情绪如何保持同一条鱼 | [统一人格](architecture/2.6.2-life-voice-context.md) | 当前接线与边界 |
| 真实事实、回访与任务证据 | [统一事实与回访](architecture/2.6.2-unified-facts-and-followup-context.md) | 当前接线与边界 |
| 隐私、遗忘、跨域反思 | [Life Memory 分域契约](architecture/life-memory-domain-reflection-v2.6.0-dev.4.md) | 兼容性和权限约束 |
| RC 十三项自然行为与用户指南自检 | [RC 准入审计](architecture/2.7.1-rc-preflight-13-questions.md) | 2.7.1 暂不准入 RC |
| 发布检查 | [当前开发版说明](../RELEASE_NOTES_v2.7.1.md) | 详细历史发布资料见仓库 `docs/release/`，不随 npm 安装包分发 |
| 旧版实验、废弃设计与追溯 | [历史文档索引](archive/README.md) | 不能当作当前实现 |

**文档维护规则：** 架构变更必须在同一提交中修订当前架构说明、可编辑图和关联测试；历史文档通过归档或 Git 历史保留，不要让多个 README 同时声称自己是当前架构的真值。
