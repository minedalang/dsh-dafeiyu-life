# 交付说明 · 2.8.1-dev.3b.33.25-ci-test-audit

包含完整源码、npm TGZ、从 .23 和 .24 的 Git Patch、完整变更分类清单以及 SHA256。

### 本轮目标

针对维护者 Windows full 日志（95 个 Node `not ok`、Python 5 FAIL/7 ERROR/2 SKIP）逐类处理：改真实缺陷、更新仍有效的当前协议测试、仅退役已被替代的旧布局/版本/轮询文案子测试；同时修复 GitHub Actions Mermaid 预览跨系统行尾对齐。

### 版本与权限

仍为 `.25` 开发版，**不得在 Windows 全量与实机门禁不通过时发布正式 2.8.1**。不增加 B站外发权限，不修改已有用户配置，不执行真实平台请求。

### 升级

当前 GitHub 仓库若已推送的是 `.23`，使用 **`.23-to-25` 累计 Patch**；已应用 `.24` 则使用 `.24-to-25`。先 `git apply --check`，确认原工作区 clean，再应用并运行 `npm run check:life-architecture` 和 Windows `run-tests.bat full`。详见 `APPLY.md`。
