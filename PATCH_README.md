# 2.6.1 统一已接受待办完成回访 · 发布前验收补丁

此补丁的准确基线是**上一份实际交付的** `dsh-dev6-video-push-fixed-source.zip`（dev.6 主动兴趣私信推荐热修完整源码），不需要先自行切换到未发布的正式版，也不需要再次应用旧补丁。

## 升级方法（Git Bash）

1. 确认 `dev` 分支已经包含 dev.6 的主动视频推荐修复；本地工作区须干净。
2. 将本补丁 `.patch` 解压至项目上一级目录；不要把 ZIP 或 Patch 放入仓库并提交。
3. 在项目根目录执行：

```bash
git switch dev
git status --short
git -c core.whitespace=cr-at-eol apply --check ../dsh-v2.6.1-unified-completion-followup-RC.patch
git -c core.whitespace=cr-at-eol apply ../dsh-v2.6.1-unified-completion-followup-RC.patch
node --test test/*.test.mjs
python -m unittest discover -s test -p 'test_*.py'
node selfcheck.mjs
```

如果 `git apply --check` 失败，**停止，不要 `--force`、`--reject` 或手动填入缺失文档**。先检查 Git 分支历史、本地改动与原补丁基线。

## 启用与验收

- 先备份 `$DSH_HOME/bili-duty/owner-todos.json`、`owner-todo-followups.json` 和整个用户数据目录，不修改旧状态文件。
- 管理中心「鱼鱼想做的事」中分别授权「主人完成回访」和新增的「其他请求者完成回访」（默认关闭）。
- 评论发送还需要相关评论回复权限及额度；私信须具备原渠道授权。自然熟悉不等于自动授予白名单权限。
- 用测试账号让不同 UID 在评论和 DM 发起公开视频只读请求，鱼鱼愿意接受并完成后，检查回访目的地、发送原因、同 UID 冷却和不确定回执。
- 旧 `pending` 记录保留，但如果缺少评论来源与身份信息，不能自动补猜评论地址；`uncertain` 绝不自动重试。

**验收通过后再完成 main 分支合并、GitHub Release / tag、npm 和 DSHMarket 发布。** 本地准备发行文件不意味着已经上线。
