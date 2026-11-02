# 2.6.1 RC2 发布候选：完成回访与连续子任务修复

本补丁以 `dev` 分支提交 `4206ba6`（统一完成回访 RC1）为**唯一验证基线**。不需要先应用原始的 `RC2-FOLLOWUP-RETRY.patch`，两份补丁**不能重复应用**。当前代码尚待真实 B站验收，不代表已发布。

## 应用（Git Bash）

先备份 `$DSH_HOME/bili-duty/owner-todos.json`、`owner-todo-followups.json` 和配置。将本补丁放在仓库上一级：

```bash
git switch dev
git status --short
git rev-parse --short HEAD
git apply --check ../dsh-v261-rc2-reviewed.patch
git apply ../dsh-v261-rc2-reviewed.patch
node --test test/*.test.mjs
node selfcheck.mjs
```

确保提交基线正确且工作区干净。如果 `git apply --check` 失败，请停止，不要尝试 `--reject` 或强制合并；先确认是否已经包含部分 RC2 修改。补丁采用 LF 格式，不依赖 `core.whitespace=cr-at-eol`。

## 验收重点

1. 回访同一 UID 冷却/发送间隔设为 0，确认已保存且平台授权、额度仍正常生效。
2. 真实主人或公开留言的搜索待办产生子视频后，在同轮独立考虑最多三项，每项计入 AI 预算；拒绝或延期仍有效。
3. 同一可信请求拆出的多子任务只在该组结束后汇总一条。旧账本已成功发送或结果不明时绝不重试。
4. `pending` 显示最近检查、等待原因、可重试时间；重启和跨 UID 检查。
5. 完成前不创建 GitHub Release、npm、DSHMarket 正式发行。

## Git

测试与真实环境验收通过后，按提交说明的具体文件 `git add`，使用 `fix(todos)` 类型提交，并推送 `dev`；不要将 Patch、ZIP 或运行数据提交到仓库。
