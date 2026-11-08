# 当前增量：dev.33 Life 全链路补链与记忆回执加固（仍为 dev.33）

**最新补丁只适用于上一份 `DSH-dev33-life-audit-source.zip`（已经包含 @提及修复、Life 架构审计和菜单加固）的源码。** 不能直接应用到最初 dev.33 或 dev.32，也不能混用两种补丁。

- 完整源码：`DSH-dev33-life-closure-source.zip`，适合在独立备份目录安装。
- 增量补丁：`DSH-dev33-life-closure-original.patch` 或 `DSH-dev33-life-closure-LF.patch` **二选一**。先执行 `git apply --check`，再执行 `git apply`。
- 修复包括：账号绑定短期好奇 `selection-curiosity` 进入 Life，19 类已核验行动种类统一，读/写动作原记忆 outbox 入队结果可观察；更新三张可编辑 Mermaid 图与源码锚点。
- **不变**：`autoComment`、原私信和评论授权、主人配置、用户历史数据、版本 `2.7.1-dev.33`、`releaseReady:false`；Windows/真实 B站/72h 尚未验收。

以下是此前 @修复版的历史说明，仅供理解，不能代替上面的最新补丁基线：

---

# dev.33 同版本维护修复：B站 @ 提及与人生记忆事实纠错

仅可从**完整 `2.7.1-dev.33` 原始源码**应用本补丁；版本号仍为 dev.33，`releaseReady:false`。

- 原始文件保留原换行时：选择 `*-original.patch`。
- 基线源码全部规范化为 LF 时：选择 `*-LF.patch`。
- **两种补丁只选一种。** 请先备份插件源码和用户数据，再在源码根目录运行 `git apply --check <补丁>`，通过才应用。
- 修复不更改 `autoComment`、Life 使能、评论授权、B站登录、模型设置，不清空任何已有真实评论或记忆。
- 首次查看「人生记忆」时修复仍清晰的旧解析器污染副本；不要将永久档案重新导入作为记忆。
- 真实 Windows/B站评论及 72h 运行尚未验收，不可声称达到正式发布要求。

详细说明：`docs/architecture/2.7.1-dev33-mention-memory-hotfix.md`。
