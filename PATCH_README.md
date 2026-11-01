# dsh-dafeiyu-life 2.6.0-dev.4：从 dev.3 直接升级

该补丁**直接应用于用户提供的 `2.6.0-dev.3` 源码（Git 基线 `0b7fe62`）**，包含记忆压缩、Life Memory 和社交事件协调、评论/私信安全上下文、root 与热门评论修复、配置推荐和架构归档。不需要安装任何旧 dev.4，也不需要先应用过去的审计补丁。

## 应用前

1. 在 Windows 的本地项目中确认当前处于预期 dev 分支和 dev.3 提交，先备份业务数据。实际 `.git` 由你本地管理；本补丁不会包含或改动 `.git` 元数据。
2. 确保工作树没有其他尚未提交的代码改动；如有，请先提交或备份，再应用补丁。
3. 将下载的 dev.4 Git `.patch` 放到本地仓库根目录，运行：

```powershell
git apply --check .\dsh-dafeiyu-life-2.6.0-dev.4-from-dev3.patch
git apply .\dsh-dafeiyu-life-2.6.0-dev.4-from-dev3.patch
git diff --check
```

## 逐项验收

依次运行，每一条完成后再执行下一条；不要把多个长测试命令串在同一次执行里：

```powershell
node --test
```

```powershell
python -m unittest discover -s test -p "test_*.py"
```

```powershell
node selfcheck.mjs
```

```powershell
npm pack --dry-run
```

该工作区的本地自动化基线：Node.js **821/821**，Python **126/126**，Host/Client selfcheck 和 `npm pack --dry-run` 均通过。详见 `docs/architecture/` 的审计和 Mermaids。真实 DSH Desktop、B站账号网络 API、Windows 文件系统异常等仍需要真实环境验收。

## GitHub dev 更新流程

核对源码和测试后，在自己的 Git 仓库中：

```powershell
git add .
git commit -m "feat: dev.4 memory and social context coordination"
git push origin dev
dsh plugin --profile desktop add "github:minedalang/dsh-dafeiyu-life#dev"
```

**不要**使用 `deploy-local.ps1`、`dsh plugin add .`、Junction 或本地 tgz 安装。真实安装之后再在管理中心确认记忆配额与社交上下文诊断；默认不会擅自打开新的公开发送授权。旧用户已有设置不会被强行重置，最新推荐值需要自己选组恢复并保存。

ZIP 增量包仅用于文件差异核对或人工覆盖；它不能自动移除根目录原先的 `.mmd` 审计图。推荐 Git Patch，因为 Git 能正确处理移动到 `docs/architecture/diagrams/` 的图纸。
