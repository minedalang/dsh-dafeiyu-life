# 历史文档与清理记录

当前有效架构以 [`../architecture/README.md`](../architecture/README.md) 为准。本目录保留仍需追溯的历史图和归档；不再把旧开发草稿作为现行规范。

## 2.6.2 dev 文档清理（2026-11-03）

以下文件因**无人引用／已被当前架构或发布说明替代**，从开发工作树移除。没有删除 Git 历史，必要时可按原文件路径恢复。删除仅针对项目文档，不影响用户数据、记忆库或运行时能力。

- `docs/DEV11_SOCIAL_FEEDBACK_VISUALIZATION.md`
- `docs/DEV15_MANAGEMENT_UI_RELEASE_CHECKLIST.md`
- `docs/DEV9_DUAL_CONTEXT_AGENCY.md`
- `docs/HYBRID_MEMORY_RELEASE_CHECKLIST.md`
- `docs/P6_FUTURE_SCOPE.md`
- `docs/PERSONALITY_EVOLUTION_DEV1.md`
- `docs/PERSONALITY_EVOLUTION_DEV1_ROLE_CONFIDENCE.md`
- `docs/README-legacy.md`（旧版超长 README，当前使用根目录 README 和 CHANGELOG）
- `docs/architecture/2.6.1-p4-unified-todos-proposal.md`
- `docs/architecture/dev261-p5b-execution-willingness-dev5.md`
- `docs/architecture/headless-model-sync-v2.6.0-dev.4.md`
- `docs/architecture/host-model-routing-v2.6.0-dev.4.md`
- `docs/archive/business-entrypoints-v2.6.0-dev.4.mmd`
- `docs/archive/unified-layers-target-v2.6.0-dev.4.mmd`

恢复某个历史文件：先用 `git log --all -- <原路径>` 找到版本，再使用 `git show <commit>:<原路径>` 查看；不要不经复核直接恢复已过时的业务规则。

**保留原因：** 仍被测试、发行文档或兼容规范引用的早期架构图、备份规则、历史 Release Notes 保持原路径，避免破坏升级与历史证据。若后续迁移路径，须同时修正引用与测试。
