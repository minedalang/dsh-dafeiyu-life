# dev.32 · 从 dev.31 完整源码升级（未发布）

本轮只新增账号绑定的首页工具读取证据，不更改已保存的 `homeRecommendationsEnabled`、`autoComment`、Life 行为节奏或社交权限。运行程序文件版本 `2.7.1-dev.32`；数据文件继续复用原 Life Agent v1 账本并兼容旧轮次，无需迁移或重置记忆。

补丁必须以完整 dev.31 源码为基线。Original 和 LF 只选择一种；如本地代码有改动，先备份并执行 `git apply --check`。**不要覆盖 DSH 用户数据目录或凭据**。

本包未在用户的 Windows DSH Desktop、B站真实账号或 72 小时运行场景验收；保持 `releaseReady:false`。
