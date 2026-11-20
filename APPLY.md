# dev.29 → dev.30 更新方法

先读 `TESTING_2.8.2-dev.30.md`，特别是第 1 节的工作区基线确认。

完整源码与增量 Patch 是替代交付方式，**不能叠加应用**。

已有源码为干净的 `2.8.2-dev.29`，可在项目目录执行：

```powershell
git apply --check .\PATCH_FROM_2.8.2-dev.29_TO_2.8.2-dev.30.patch
git apply .\PATCH_FROM_2.8.2-dev.29_TO_2.8.2-dev.30.patch
```

应用后验证 `node -p "require('./package.json').version"` 为 `2.8.2-dev.30`。有本地未提交的重叠修改，应先停下检查，不强制 reset。正式发布还需要按教程在 Windows 普通与管理员 PowerShell 执行全量、真实视觉模型与 DSH 实测。
