# 历史发行快照测试（不属于当前 2.8.0 的日常回归）

本目录保存针对 **2.6.0、2.7.0、2.7.1** 的版本号、README 固定排版、已归档 Mermaid 图和当时 npm 发包白名单的历史断言。
这些断言在 2.8.0 开发版上可能按设计失败，因而不在双击 `run-tests.bat` 的日常核心清单中。

没有删除历史覆盖：`run-tests.bat legacy` 可以单独审计旧版快照；`run-tests.bat full` 只运行当前仍维护的全量测试（不含这些历史版快照），历史测试单独通过 `legacy` 模式执行。对旧版本进行维护时，在对应的 Git tag 上运行这些测试才有正确含义。

**不得移动到此目录的内容：** 身份授权、未知送达冻结、跨账号/跨进程安全、幂等、防重、数据迁移、平台回执和真实 Life 行为测试。历史文件名并不自动代表过时。

2026-11-13 本次归档五个高度版本绑定的测试文件：
- `release-260-stable-package.test.mjs`
- `v270-stable-release-contract.test.mjs`
- `v271-current-version-consistency.test.mjs`
- `dev8-headless-release-version.test.mjs`
- `dev4-architecture-archive.test.mjs`

归档是可逆分类，不是删除测试或假装这些测试在当前版本上已通过。
