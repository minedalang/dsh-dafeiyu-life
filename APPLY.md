# 2.8.1-dev.3b.33.18-life-choice-audit 安装与回滚说明

本包从 `2.8.1-dev.3b.33.17-notification-sentinel` 累积升级，是开发候选，不是正式 2.8.1 发布版。

## 升级前

1. 完全退出 DSH，确认旧插件进程已结束。
2. 备份当前插件源码/安装包，以及 `%USERPROFILE%\.dsh\bili-duty` 整个个人数据目录。
3. 保留 `config.json`、账号隔离目录、私信收件箱、Life 待办、人工复核、`bili-read-budget.json`、通知哨兵快照、网络退避和未知发送状态。
4. 不要清空或手工编辑 `life-shared-bili-links` 账本；本版只增加证据等级/延期状态等可兼容字段。

## 推荐安装

优先使用本包的本地 TGZ：

`dsh-dafeiyu-life-2.8.1-dev.3b.33.18-life-choice-audit.tgz`

通过你已经验证可用的本地 DSH 插件安装/替换流程安装。不要执行 `npm publish`，不要改用远程 GitHub 最新版覆盖本包。

也可以使用 `source/` 完整源码替换当前工作树。完整源码不包含 `node_modules`、VCS 元数据、本机配置、个人数据或诊断日志压缩包。

## Git Patch 安装（从 .17）

必须在精确匹配的 `2.8.1-dev.3b.33.17-notification-sentinel` Git 源码树中执行：

```powershell
git -c core.whitespace=cr-at-eol apply --check .\patches\dafeiyu-2.8.1-dev.3b.33.17-to-18-life-choice-audit.patch
git -c core.whitespace=cr-at-eol apply .\patches\dafeiyu-2.8.1-dev.3b.33.17-to-18-life-choice-audit.patch
```

补丁已从 `.17` 基线独立回放并逐文件校验。不要把它应用到 `.16`、`.14` 或其他不同源码树。

## 重启后验收

1. 重启 DSH，确认插件正常激活、设置页和管理中心可打开，版本显示 `2.8.1-dev.3b.33.18-life-choice-audit`。
2. 确认双通知哨兵和原有 5 分钟私信普通计数、5 分钟互动计数、60 秒活跃私信、30 分钟一致性核对没有被改动。
3. 用一条来自当前仍有权限联系人的 B站官方安全链接进行受控验证：Life 应能自主选择是否读取；多条链接时只读取其精确选择的一条。
4. 验证视频链接只显示 metadata-only 回执时，Life 不会说自己已经播放/看过视频。
5. 可在测试联系人上验证权限撤销后旧分享链接不再读取；不要为了测试而频繁请求 B站。
6. 观察短链解析是否进入共享读取预算；预算/资源延期应显示为延期，不应被记录成内容失败。
7. 观察 `duty.log` 和管理页诊断，不要通过手动高频网络测试试探 `-509`。

## 回滚

完全退出 DSH，恢复升级前备份的 `.17` 插件源码/安装包。个人数据目录保持原样；不要删除分享链接账本、计数快照、请求预算、私信队列或未知发送状态。若 `.17` 忽略本版新增的证据字段，保留原文件即可，不要手动改写。

## 当前限制

- 安全链接读取仍只支持本版明确列出的 B站 HTTPS 官方域名和受限 `b23.tv` 短链；不支持任意外站 URL。
- 多条私信链接每轮最多由 Life 主动选择读取一个，其余保留为独立 Life 机会。
- 视频 metadata-only 不等于实际播放/观看；动态文字与图片观察也分别记录。
- 本包没有实现 2.9.x 通用注意力系统、抖音或游戏平台 Adapter；这些只写入未来计划文档。
- 离线测试不等于 Windows 真实账号验收，也不证明 B站 `-509` 已根治。
