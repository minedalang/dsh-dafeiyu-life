# .23 / .24 → .25 CI 修复与全量测试分类版升级

**本版仍为开发预览：2.8.1-dev.3b.33.25-ci-test-audit，不可作为正式 2.8.1 直接发布。**

## 选择唯一一条升级路径

- 已经 **git push .23** 的维护者，使用 `2.8.1-dev.3b.33.23-to-25-ci-test-audit-utf8.patch`（累计包含 .24 的发布前修复），**不要先叠加 .23→.24**。
- 如果 Git 工作区已经完整应用 .24，使用 `2.8.1-dev.3b.33.24-to-25-ci-test-audit-utf8.patch`。
- 如果源码有用户本地修改/不同版本，**不要使用 `git apply --reject` 或 `--3way` 强行覆盖**，先备份并检查 diff。

### PowerShell 示例（已推送 .23 原始工作区）

```powershell
git status --short
git apply --check ".\2.8.1-dev.3b.33.23-to-25-ci-test-audit-utf8.patch"
git apply ".\2.8.1-dev.3b.33.23-to-25-ci-test-audit-utf8.patch"
npm run check:life-architecture
npm run check:video-tool-contract
.\run-tests.bat full
```

随后打开 GitHub Actions 确认在实际最新 commit 的 Node/LF checkout `check:life-architecture` 通过。`docs/architecture/life-system-current-view.md` 为 **LF**；未来修改任何 `.mmd` 后必须 `npm run write:life-architecture-view`，将自动预览文件一同提交，再 check。

### 如曾修改 Mermaid 源图

```powershell
npm run write:life-architecture-view
npm run check:life-architecture
git status --short
```

只要内容真不同，CI 仍会失败；禁止用强制忽略校验掩盖图内容漂移。

### 数据与回滚

先备份插件代码和 `%USERPROFILE%\.dsh\bili-duty`，正常代码 Patch 不应重置账号、私信、Life 记忆、-509 冷却、未知发送冻结。**不要删除这些持久文件，也不要盲目复制本版的代码覆盖已修改用户配置**。回滚源码用发布前自己备份的 `.23`/`.24` 工作树，运行数据原样保留。

## 发布门禁

本版修的是已确认的 CI 行尾、退避迁移、owner 私信观察、管理端 DOM 等问题，并清除少量证据充足的过期测试。Windows full 原日志有 95 条 Node 失败 + Python 5 FAIL/7 ERROR/2 SKIP；**尚无升级 .25 后的 Windows full PASS**。必须复跑，若仍失败，请打包对应 `step-*.tap.log` 原始 Traceback，才能继续确认真正根因。Windows 视觉视频/DASH、-509、symlink 安全 SKIP、未知发送与旧版升级还需实机证明。

本次未调用 B站实际写操作；未提交/推送你的 Git 仓库，也未执行 npm publish。
