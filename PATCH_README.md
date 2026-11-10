# DSH 2.7.1-dev.51 → 2.7.1-dev.52（开发预览）

**只能应用在完整、未修改的 dev.51 基线上**。不适用于 dev.50 或更早源码。Windows 建议使用 CRLF Patch；LF/CRLF 二选一，绝不能重复应用。

```powershell
# 确认当前代码与 dev.51 基线一致，且工作区无未提交修改
git status --short

# 先检查，不改文件
git -c core.whitespace=cr-at-eol apply --check .\patches\DSH-2.7.1-dev51-to-dev52-life-visual-social-CRLF.patch

# 只有检查通过后才能正式应用
git -c core.whitespace=cr-at-eol apply .\patches\DSH-2.7.1-dev51-to-dev52-life-visual-social-CRLF.patch

git diff --check
node --test test/v271-dev52-social-memory-home.test.mjs
npm run check:life-architecture
node selfcheck.mjs
```

本版主要修复入站评论回复的跨渠道冷却误拦、人工核实草稿重试的过期 Life 证明、发送前延期与未知结果的区分；私信游标按关系控制无变化会话的详情复查；管理页增加只读生活证据脉络并将原创评论调试移入诊断页；README 改为简洁用户首页。**仍不强迫每轮发表评论**，不改变旧用户许可或记忆遗忘规则。

`releaseReady:false`。真实 Windows DSH、B站限流恢复、人工确认草稿重发及长期稳定性仍待现场验收；全仓测试在当前容器未完成全绿，详见交付 `TEST-RESULTS.md`。
