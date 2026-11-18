# 2.8.1-dev.3b.33.24 发布前最后审计交付

本次只修复维护者 Windows `run-tests.bat full` 暴露出的过期测试契约，并同步更正旧版分镜 README 断言和发布文档。**没有改动生产代码，也不能据此直接发布正式 2.8.1。**

交付物：完整源码 ZIP，npm 安装 TGZ，`.23 → .24` Git Patch，`TEST-RESULTS.md`，`APPLY.md`，SHA256 校验及中文 Commit。

对 Windows 用户：使用 `.23 → .24` Git Patch 升级后，在干净仓库执行 `./run-tests.bat full`，必须运行到底并最终 PASS；随后完成 `docs/release/2.8.1-release-checklist.md` 所列实际视觉、升级和限流验收。
