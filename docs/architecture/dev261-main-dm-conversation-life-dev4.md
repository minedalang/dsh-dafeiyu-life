# 2.6.1-dev.4：主 Session 与 B站私信的双向生活状态接线

> 本文是实际新增接线审计，不是声称模型具有真实意识。

## 生产路径

| 入口 | 可信输入 | 回复前读取 | 回写与证据 | 边界 |
|---|---|---|---|---|
| 选定的主 Session | `createLongTermMemory` 挂载的 `agent/inbox/inserted`，只接收用户回合；排除插件注入来源 | `emotionalState.ownerContext()`/`styleHint()`、LongTermMemory、本轮检索、已审核成长人格 | `conversationLifeFeedback.observe(main-session)`；`preparePrivateLifeEvent(owner-session,validated)` → LifeMemoryCoordinator → 隐私分域反思；可选 `dafeiyu_feel` 本轮工具回写 | 未选择 Session 或会话变化即无入口；绝不把普通聊天原文当成长期事实 |
| 主人 B站私信 Agent | 当前账号已验证的主人 UID、未处理私信 ID；上游持久化去重 | `SocialContextAssembler.ownerDm`、主人域记忆 + 现有人格、情绪 | 真实收到的私信 → `conversationLifeFeedback.observe(dm,owner)`、原私密事件；模型可在既有 JSON 决策附可选情绪，**仅确认发送成功后**回写 | 不新增 AI 调用或外发权限；结果不确定不重复发 |
| 已授权好友 B站私信 | `dmAutoreply` 经认证的收信适配器和消息去重 | `SocialContextAssembler.message` 每 UID 的记忆、熟悉度、当前心情与抽象人格 | 收信安全信号 → `conversationLifeFeedback.observe(dm,friend)`；经隐私筛选的私人经历 → SocialInteractionCoordinator/LifeMemoryCoordinator；现有互动模型输出情绪仍沿用 | 只读本人私有摘要；**自然熟人不自动获得白名单授权**；公共评论不附私信生活上下文 |
| 陌生人或未授权来源 | 仍按社交策略独立判断 | UID 分域可访问的公开上下文 | 不把陌生人普通私信自动当作主人/好友的情绪证据 | 不跨 UID、不外发私人记忆 |

## 状态反馈与隐私

- `conversation-life-feedback.mjs` 的自动反馈只接收真实互动中的强提示语，强度固定为 1；例如感谢鱼鱼、直接夸赞，或明确向鱼鱼表示需要陪伴。**不会因对方说自己难过而把鱼鱼直接设为悲伤**。模糊对话可以不更新情绪。
- 反馈账本只保存随机盐、源类别、日期和带盐 SHA-256 的事件键；不会落盘 UID、主 Session ID、私信正文或聊天摘要。按来源每日最多八次，重启仍防同一事件重复更新。情绪值按原有半衰期衰减，可在原管理中心恢复。
- 主 Session 模型可用同一轮的 `dafeiyu_feel` 工具，最多一次，单次强度限 1～2；仅当有**真实新主人回合**且模型认为自己的角色状态发生变化才调用，不能把他人的情绪照搬。此功能不强制每轮调用，也不增加独立模型请求。
- 只有被 `life-private-policy` 确定性审查后形成的无原文简短事件，才进入已有可衰减私有生活记忆；隐私过滤可能直接拒绝事件。人格变化仍由现有 LifeReflection 和 PersonalityEvolution 的候选证据阈值决定，**不会因为单次夸奖自动定型人格**。
- 完整长期事实仍通过 `dafeiyu_remember` 的语义核验写入身份记忆；此版不建立一个平行、永久保存所有聊天的聊天数据库。

## 回归与保留工作

`test/dev4-conversation-life-feedback.test.mjs` 涵盖双域去重、权限、敏感消息过滤、主人主会话挂载、DM 独立上下文与生产 wiring。`node --test` 全量回归仍需通过；真实 DSH 桌面版和 B站端到端发送须本机验收。

P5-B 的**执行前意愿复核与跨渠道公平调度**尚未在本次 dev.4 实现；P6 的连发、主动续聊和回访也未打开。主 Session 宿主并未提供一个已在本项目验证的“助手最终回复确认发送”事件，因此本版不声称主 Session 所有回复均自动成为情绪或记忆证据。
