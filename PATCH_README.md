# DSH 2.7.1-dev.49 → 2.7.1-dev.50（开发预览）

**精确基线为 dev.49 完整源码。** 不适用于 dev.48 或更早版本。只选择 LF 或 CRLF 其中一份补丁，不要叠加。

```powershell
git status --short
git -c core.whitespace=cr-at-eol apply --check .\patches\DSH-2.7.1-dev49-to-dev50-owner-video-memory-CRLF.patch
# 仅当 --check 通过时再执行
git -c core.whitespace=cr-at-eol apply .\patches\DSH-2.7.1-dev49-to-dev50-owner-video-memory-CRLF.patch
git diff --check
node --test test/v271-dev50-owner-video-memory.test.mjs
npm run check:life-architecture
node selfcheck.mjs
```

新版：视频 Agent 最短启动间隔 1～1440 分钟（旧配置仍保留 20 分钟默认）；每轮参考阅读 1～30／挑选 0～12 但不强制选片或评论；首次设置直接登记主人 UID，沿用原唯一主人名册校验；修复多气泡工具在 DSH 下不支持的 `minItems/maxItems` 参数；记忆节点根据已有清晰／模糊／印象阶段显示明暗，未标注不推测。

**`releaseReady:false`**，尚未在用户 Windows DSH、真实 B站与模型服务上验收。
