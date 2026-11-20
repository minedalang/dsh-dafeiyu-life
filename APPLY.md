# 2.8.2-dev.26 · 安全应用说明

本补丁基于本轮上传源码 `2.8.2-dev.25` 生成。请先备份工作区；不要覆盖用户家目录中的凭据、记忆、数据库或运行数据。

## 推荐：Git Patch

在项目仓库根目录执行 PowerShell：

```powershell
$Patch = 'D:\YourDelivery\PATCH_FROM_2.8.2-dev.25_TO_2.8.2-dev.26.patch'
git status --short
git apply --check --whitespace=nowarn $Patch
if ($LASTEXITCODE -ne 0) { throw 'Patch check failed; stop and inspect the actual baseline.' }
git apply --whitespace=nowarn $Patch
if ($LASTEXITCODE -ne 0) { throw 'Patch apply failed; do not force or use --reject.' }
```

`--whitespace=nowarn` 仅抑制原源码 CRLF 行尾在 Linux 生成补丁时的空白告警，不跳过内容校验。

确认 `package.json` 为 `2.8.2-dev.26` 后运行：

```powershell
node --test test/issue11-fixes.test.mjs
node --test test/issue11-fixes.test.mjs test/v281-dev3b3-quick-setup-dependency-install.test.mjs test/v271-dev36-universal-life-episodes.test.mjs test/v271-dev37-life-action-attribution.test.mjs test/v281-dev3b3321-scheduler-live-export.test.mjs test/v271-dev54-owner-ui-memory-life.test.mjs test/v271-dev53-neural-semantic-life-diagnostics.test.mjs test/v281-dev3b339-planner-admission-refund.test.mjs test/v271-dev56-life-owned-actions-and-journeys.test.mjs
npm run check:test-governance
node selfcheck.mjs
npm run check:life-architecture
npm run check:video-tool-contract
npm run check:context-budget
npm pack --dry-run --json
```

完整手工验收见 `TESTING_2.8.2-dev.26.md`。

## 回滚

如果尚未提交，可在确认工作区只有本补丁变更后使用 `git apply --reverse --whitespace=nowarn <patch>` 回滚。若已有其他修改或提交，不要直接 reset；先备份并按实际 Git 状态生成反向补丁。

**不要**使用 `git apply --reject`、强制覆盖、`reset --hard` 或删除运行数据来绕过补丁冲突。
