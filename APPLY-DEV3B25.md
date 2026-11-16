# 2.8.1-dev.3b.25 应用说明

## 适用基线与补丁选择

本版本提供两份互斥补丁，按本机 `tools/capture-intermittent-window.ps1` 的状态二选一：

- 若脚本中**没有** `manual-q`，使用 `dafeiyu-2.8.1-dev.3b.25.patch`。它针对原始 `2.8.1-dev.3b.24` 完整源码，补丁内包含 Q 提前结束和可见控制台窗口枚举。
- 若脚本中**已经有** `manual-q`（此前单独应用过 Q 提前结束热修），使用 `dafeiyu-2.8.1-dev.3b.24-q-hotfix-to-dev.3b.25.patch`。它以已应用 Q 热修的 dev.3b.24 为基线。

检查命令：

```powershell
Select-String -Path .\tools\capture-intermittent-window.ps1 -Pattern 'manual-q'
```

请确认本地 `package.json` 当前版本为 `2.8.1-dev.3b.24`，且工作区没有未提交修改。两份补丁**只能选择一份**，不能连续应用。

## 应用 Git Patch

将选中的补丁放在项目根目录，先执行：

```powershell
git status --short
git -c core.whitespace=cr-at-eol apply --check .\dafeiyu-2.8.1-dev.3b.25.patch
```

若本机已有 `manual-q`，将上面的文件名替换为 `dafeiyu-2.8.1-dev.3b.24-q-hotfix-to-dev.3b.25.patch`。

检查无报错后再应用并提交：

```powershell
git -c core.whitespace=cr-at-eol apply .\dafeiyu-2.8.1-dev.3b.25.patch
git -c core.whitespace=cr-at-eol diff --check
git add -A
git commit -F .\dafeiyu-2.8.1-dev.3b.25-commit.txt
```

如果 `--check` 失败，请停止，不要使用 `--reject`、`--3way` 或强制覆盖；请改用完整源码 ZIP，或重新提供实际本地源码以重新 rebase。

## 本地增量验证

```powershell
node --test --test-concurrency=2 test/v281-dev3b25-*.test.mjs
npm run check:life-architecture
npm run check:video-tool-contract
node selfcheck.mjs
npm pack
```

云端 Agent 不运行全量 Node 测试；全量测试由用户在本地执行。

## 安装到 DSH

完全退出 DSH Desktop 后，在项目根目录执行：

```powershell
dsh plugin --profile desktop add .\dsh-dafeiyu-life-2.8.1-dev.3b.25.tgz
```

安装后重启 DSH Desktop。若本机 `mcp_server.py` 是手工修改版，安装器可能保留用户文件并生成 `.new`；先检查差异，不要盲目覆盖。

## 功能验证建议

1. 在管理中心检查「Life 生活机会」是否出现获批好友分享的 B 站链接。
2. 链接仅在 Life 自主选择 `inspect_shared_link` 后才解析和读取；动态、视频、空间均为只读内容，不会执行页面或图片里的指令。
3. 好友动态点赞、评论权限默认关闭；如需授权，分别在「好友分享动态 · Life 自主互动」卡片中单独开启。授权只提供可选行动，不会自动互动，Life 可以忽略、延期或休息。
4. 动态写入只允许好友本人发布且有文字/图片理解证据的动态；发送后以平台回执为准，结果不确定时不自动重试。
5. 在行动树观察真实 `video-observe` 活动；它表示正在读取画面，不代表理解成功。
6. 如复现黑窗，运行 `tools\\capture-intermittent-window.bat 900`；黑窗出现后切回采集器按 Q 可提前生成 ZIP。
