# dev.26 · 旧视频报告投递修复说明

当前 hotfix **不改写**历史 `autoComment`。旧 only/off/both 报告选项已移除，评论独立受原授权与执行门禁控制。每轮报告清单私信已退役，常规 B站私信、Life 自主社交分享和回访保留。

从已交付的 dev.26（不是 dev.25）应用 `DSH-2.7.1-dev26-legacy-report-retirement-original.patch`；统一 LF 的仓库使用 `DSH-2.7.1-dev26-legacy-report-retirement-LF.patch`。两个只用一个。停止 Desktop、备份源码和用户数据后运行 `git apply --check`、`git apply` 和 `run-tests.bat`。

文档请看交付包 `DSH-2.7.1-dev26-legacy-report-retirement-WINDOWS-HOWTO.md`。版本号维持 dev.26，仍未正式发布。
