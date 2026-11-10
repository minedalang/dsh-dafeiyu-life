# DSH 2.7.1-dev.50 → 2.7.1-dev.51（开发预览）

**只能用于完整 dev.50 基线。** 不适用于 dev.49 或更早源码；只应用 LF 或 CRLF 其中一个，切勿叠加。Windows 请优先选 CRLF 版本，并先确保工作区干净。

```powershell
git status --short
git -c core.whitespace=cr-at-eol apply --check .\patches\DSH-2.7.1-dev50-to-dev51-neural-atlas-short-pause-CRLF.patch
# --check 通过后才正式应用
git -c core.whitespace=cr-at-eol apply .\patches\DSH-2.7.1-dev50-to-dev51-neural-atlas-short-pause-CRLF.patch
git diff --check
node --test test/v271-dev51-neural-atlas-short-pause.test.mjs
npm run check:life-architecture
node selfcheck.mjs
```

本版给原主 Session 添加不占长时联系配额的 90 秒可选短暂停顿续聊；Life 可选择跳过，宿主返回只代表请求已入队，不能认为独立气泡已送达。新增神经图谱非命中灰底、可选 1000/2000/10000 节点、Canvas 密图/真实来源连线计数/三维聚焦。旧版记忆和 Life 授权不自动更改。`releaseReady:false`；真实 Windows、DSH UI、B站与 72h 运行尚待现场验收。
