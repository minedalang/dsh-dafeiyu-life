# 2.6.0-dev.4 跨模块架构进一步审计

**审计依据：** 用户提供的 dev.3 源码、此前 A-01～A-11 审计与四张 Mermaid 审计图、以及本轮实际代码差异和自动化测试。区分源码已实现、dev.4 本次修改和真实平台尚未验证的事项。

| 编号 | 原问题 | dev.4 处理 | 边界与验证状态 |
|---|---|---|---|
| A-01 | `scene='social'` 导致普通互动异常 | 上传的 dev.3 已按 comment/dm 分流；保留并回归生产 wiring，不重复修复旧问题 | 宿主真实交互待验证 |
| A-02 | @ 首轮不取热评，陌生人更不会取 | 有效 @ 首轮 `includeHot:true`，受配置数和实际 API 数据限制 | 读取失败降级，不编造评论；专项测试 |
| A-03 | 可信评论 Agent 绕过梗、记忆、隐私统一层 | 可信/普通评论共用 SocialContextAssembler；二阶段自主视频评论同用公开安全记忆与梗；硬性隐私拒绝 | 允许不同 Agent 保留不同自主决定策略 |
| A-04 | `root_id/target_id` 混用 | CommentRootResolver 分离 contextRoot/sendRoot；不明嵌套根拒绝自动回复 | 无法验证根时宁可不发送 |
| A-05 | 多域社交投影部分写入失败后不可恢复 | 先写 SocialInteractionCoordinator outbox，独立记录并重试每个 sink；LifeMemoryCoordinator 负责经历/反思；生产视频探索、评论路径接入 | B站发送成功但本地 journal 写入失败仍需人工查验，绝不自动重发外部消息 |
| A-06 | 主人私信 Agent 缺长期主人记忆 | 经 UID 验证的主人 DM 才能用私有记忆视图；其余社交仅 UID 授权的公开视图 | owner DM 仍走独立动作允许清单 |
| A-07 | DM 记忆 query 没近期对话 | 同 UID 最近最多四条上下文加入检索 query | 不跨 UID / 不跨公开与私信会话 |
| A-08 | friendDirectory 与兼容白名单可能分叉 | SocialPolicyGate 从规范好友目录识别身份/通道，保留旧字段作为兼容和迁移镜像 | 老用户独立 patch legacy 配置需再次核对 |
| A-09 | 记忆、热评、线程检索失败难诊断 | 评论记录载入计数、社交/人生 outbox 提供待补偿统计；管理中心可查看 | 尚无每次 AI 调用的全部字段级诊断，不虚报覆盖率 |
| A-10 | 便携备份不完整包含私密侧状态 | 备份收录 Life Memory outbox 并在待补偿时拒绝生成；社交私密侧 outbox / 好友观察仍不随便携备份导出 | 这是隐私最小化边界，备份不是“完整社交账号状态快照” |
| A-11 | 每日语义额度、记忆压缩与文档不符 | 默认 30（最高 100），事实更新和去重不占新额度；超额候选持久暂存、恢复；压缩 opt-in 且保留来源 ID | 旧配置不会被强行重置；模型产出的伪造洞察不入库 |

## 实际实现的统一层

- **SocialPolicyGate：** 用平台 UID、好友目录与通道区分 owner、friend、stranger；不把好友关系自动等同于发布授权。
- **SocialContextAssembler：** 视频、评论根/楼中楼、可选字幕/热评、UID 隔离的记忆召回、梗知识、人格和情绪。普通与可信 Agent 共用读取契约。
- **CommentRootResolver：** `target_id` 仅表示直接父评论，不能猜测根；顶层回复需保留可验证的位置语义。
- **SocialInteractionCoordinator：** 对社交认知、可信好友偏好/关系、公开经历和成功回复投影逐 sink 写入、去重、恢复。日志不保存原始私信正文和陌生人原始 UID。
- **LifeMemoryCoordinator：** 只管 Life Memory 经历、反思候选和兴趣，不替代全局社交 outbox，也不从永久档案恢复已遗忘信息。
- **MemoryConsolidation：** 仅限主人普通聊天的非稳定记忆；本地相关性筛选与 AI 来源约束，失败原记录不改，默认关闭，定期按需运行。

## 没有强行统一的必要分域

生活动态只能读取公开证据；情绪回顾使用专用情绪事件；时间线是只读聚合；人生反思依靠候选 ID / 可衰减证据；主 Session 的工作任务和主人私信 Agent 都必须保持动作授权独立。统一的是**身份来源、只读证据、模型使用、发送边界、状态补偿**，不是把所有数据塞进一个 JSON。

## 测试与发布限制

新加入故障注入、重启恢复、UID 隔离、默认额度、记忆压缩安全和 root 位置专项测试。Node / Python / Host-Client / 打包的实际结果以最终独立验证记录为准。自动化测试不能替代 Windows DSH Desktop 与 B站账号真实端到端验收。dev 分支和 npm/市场发布状态以实际仓库为准。
