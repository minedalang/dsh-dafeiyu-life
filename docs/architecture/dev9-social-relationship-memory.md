# 2.6.0-dev.9 社交关系与记忆接线说明

- `SocialPolicyGate`/`socialTier`：唯一权限来源；`friend` 仍表示白名单权限角色。
- `SocialInteractionCoordinator`：可信已验 UID 输入事件；`recordPerson` 仅记录 UID、渠道、方向、时间及哈希事件 ID，无原文；其既有 outbox 不存陌生人 UID。
- `SocialRelationshipIndex`：独立 SQLite 轻量索引（people/daily/seen），限速和去重、按活跃度的关系阶段与权重。`stage=friend` 不应被解释为 `socialTier=friend`。`get()`/`preferenceHint()` 是未来 2.6.1 的只读接口，不得作为发消息依据。
- `SocialContextAssembler`：可在评论上下文中有限注入熟悉阶段，不加载关系明细或私密画像。
- `LifeMemoryGateway`：**只对新写入的公开 social 经历**按 UID 关系调整半衰期，不重写老经历；所有历史细节只可从仍清晰的 episodic 副本读取。模糊/痕迹/遗忘不可逆。
- `management-console`：只读关系分页 API；清除必须本机同源确认，DSH Mobile 继续只读。
- 未改变 `SocialPolicyGate.canTrustComment`、`canLearn`、`canViewIdentity`、私密记忆门禁、私信主动联络、主动回访和后台外发开关。
- 2.6.1 统一待办可读取 `preferenceHint(uid)` 作为非授权的队列排序参考；任何行动须另经权限和真实平台回执。

注意：relationDecay 不是全局 15-120 天记忆参数。只对新的公开 social 事件有效，不得把关系索引里已遗忘事件用于重建历史。

## Windows SQLite 连接生命周期（dev.9 修复）

- 插件 `apply()` **不创建或打开**社交关系数据库。只有真实的关系事件投影、关系上下文/记忆读取，或分页管理 API 首次需要查询时，才初始化 `SocialRelationshipIndex`。
- `ctx.effect` 在真实宿主卸载时调用 `close()`。这避免无社交活动的旧 HTTP 测试夹具因 Windows 不能删除仍被 SQLite 打开的 `%TEMP%` 文件而集中 `EPERM`；并避免无关接口初始化阶段产生不必要的磁盘锁。
- 新增 `test/dev9-relationship-index-windows-lifecycle.test.mjs` 覆盖不访问关系的插件初始化，以及首次访问后的关闭、文件重命名和清理。仍需在 Windows Git Bash 中运行完整 `run-tests.bat` 确认实际兼容。

## dev.9 联系人昵称与展示增强

- `GET /relationships` 继续只读分页，返回每人的公开社交记忆参考半衰期及短期公开昵称缓存，不在关系索引中保存私信正文和陌生人人设。
- `GET /relationships/nicknames?uids=...` 仅在同源管理页面按需读取已认识的 UID，单次最多 8 人，后端每小时最多 30 次真实 B站查询；没有登录凭证不请求；在线失败不会新增关系。
- SQLite `people` 表原位增加 `nickname`、`nickname_at`，七天过期，原关系分数和权限身份均不受昵称影响。此表仅用于本机展示和自然关系计算；不要将昵称当做可信身份。
- 关系列表以 UID 链接保底显示，查询成功后补上昵称与熟悉度条、关系敏感的参考衰减周期；不会逐页无限扫描整个 B站用户库或额外调用模型。
