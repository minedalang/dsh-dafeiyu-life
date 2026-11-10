# DSH 2.7.1-dev.48 → 2.7.1-dev.49（未发布）

**精确基线为 dev.48 完整源码**，不要将本补丁应用到旧 dev.47 或更早版本。
本轮交付提供 Linux LF 和 Windows CRLF 两种 Git Patch，只能选择一份。

```powershell
git status --short
git -c core.whitespace=cr-at-eol apply --check .\patches\DSH-2.7.1-dev48-to-dev49-neural-3d-health-CRLF.patch
# 通过检查后才正式应用
git -c core.whitespace=cr-at-eol apply .\patches\DSH-2.7.1-dev48-to-dev49-neural-3d-health-CRLF.patch
git diff --check
node --test test/v271-dev49-neural-3d-health.test.mjs
npm run check:life-architecture
node selfcheck.mjs
```

本版移除顶部生活播报，将本地退避原因与预计重试时间分别对应到后台私信、评论回复和被 @ 提及三个渠道。神经回忆场改用跟随主题的三维透视视图，支持鼠标旋转、滚轮缩放、全屏、颜色图例和选中节点定位右侧实际详情；能复用已有本地 embedding 且源文本哈希吻合时才显示 PCA 语义投影，否则注明结构布局。全程不创建第二套记忆，也不额外访问 B站或模型。

**`releaseReady:false`**。不改变 Life 决策与专业 Agent 发送权限； Windows DSH/真实 B站/真实模型及长时间使用仍需验收。
