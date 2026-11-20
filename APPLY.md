# 2.8.2-dev.29 · 安全应用说明

本次补丁仅以完整 `2.8.2-dev.28` 源码为基线。如果已在本地做额外修改或合并前置补丁，请先核对工作区，不要重置或强制覆盖。

在 Windows PowerShell 的插件源码目录运行：

```powershell
$Patch='D:\Delivery\PATCH_FROM_2.8.2-dev.28_TO_2.8.2-dev.29.patch'
git status --short
git apply --check --whitespace=nowarn $Patch
if($LASTEXITCODE -ne 0){ throw '补丁基线不一致，请停止' }
git apply --whitespace=nowarn $Patch
if($LASTEXITCODE -ne 0){ throw '补丁应用失败，不要使用 --reject' }
```

补丁完成后按 `TESTING_2.8.2-dev.29.md` 执行定向测试、`npm pack` 清单核验，再用 Windows/DSH 做实机验收。没有任何步骤要求删除 `.hf-cache`、记忆或凭据。

若本补丁尚未提交且没有叠加后续更改，备份后可执行 `git apply --reverse --check --whitespace=nowarn $Patch`，确认通过后再 `git apply --reverse --whitespace=nowarn $Patch`。不要使用 `git reset --hard`。
