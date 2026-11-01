# 大肥鱼 2.6.0-dev.4 全业务架构审计（代码核对）

此文是 dev.3 → dev.4 代码审计和自动化测试的记录。**功能代码存在不等于 DSH Desktop/B站实机验收完成。**

## 业务经过的统一层

| 业务 | 身份与权限 | 上下文及记忆 | AI / 执行 | 事件与状态 |
|---|---|---|---|---|
| 主 Session | 绑定 Session、主人工作域 | `memoryRetriever.localContext(chat)`、主人身份长期记忆 | 主 Session 工具与独立动作授权 | LongTermMemory、MemoryConsolidator |
| 视频探索 | duty 工具白名单、公开证据校验 | 视频详情、字幕、公开视频经历 | 限权 headless + Bili MCP | `LifeMemoryCoordinator` → 经历/反思/兴趣 |
| 普通评论 / @ | `SocialPolicyGate`、评论设置、UID | `SocialContextAssembler`、`memoryRetriever.socialContext`、视频楼层/热评/梗 | interactionBatcher + 模型调用 + 平台守卫 | SocialInteractionCoordinator → Life Memory / 好友等投影 |
| 可信评论 Agent | UID/好友名册及单独行动授权 | 同一 ContextAssembler 的社交视图，不能读私密主人记忆 | ownerCommentAgent + 平台守卫 | 经证实回执后才记社交回复 |
| 普通私信 | UID、白名单/审批、通道权限 | UID 范围社交记忆、短期会话、梗知识 | interactionBatcher + 平台发送守卫 | 社交事件 outbox、关系/社交认知投影 |
| 主人私信 Agent | 验证主人 UID，独立动作 allowlist | owner DM 私有上下文，不进入公开社交检索 | tool-less planner + 每动作复核 | 专用 Agent 账本和受权动作回执 |
| 每日动态 | 公开发布权限 | 公开事件证据（不使用私密归档） | 专用生成与 Python 发布闸门 | 动态草稿、发布状态 |
| 人生反思、人格、情绪 | 真实候选 ID 与有效证据 | LifeMemoryGateway 的领域专用读取 | 反思模型、质量/权限校验 | LongTermMemory、情绪与人格投影 |
| 时间线/管理页 | 本地管理 API | 本地状态与审计，只读呈现 | 不授予自动发送能力 | 真实经历/统计与备份 |

## A-01～A-11 复查结果

| 编号 | 审计主题 | dev.4 当前代码状态 | 重要验收边界 |
|---|---|---|---|
| A-01 | 互动 persona 场景接线 | 已按 comment / dm 分流；原 `scene='social'` 例子在本次基线不存在 | 必须保留生产 wiring 回归 |
| A-02 | 有效 @ 的热评 | @ 首轮按配置尝试读取热评 | 失败必须明确降级，不能假装已读 |
| A-03 | 可信评论上下文旁路 | 已增加共享社交上下文装配和硬隐私检查 | 专用 Agent 动作授权仍独立，不合并权限 |
| A-04 | 评论 root 坐标 | `CommentRootResolver` 分离上下文读取 root 与发送 root | `target_id` 不能冒充 root；不确定时不猜 |
| A-05 | 跨域社交事件补偿 | `SocialInteractionCoordinator` 提供持久化 outbox、按 sink 重试；Life Memory 单独协调 | 运行中失败、重启恢复需实机回归 |
| A-06 | 主人私信记忆 | 以通过验证的 owner DM 渠道获取主人记忆 | 不得外泄至公开评论/好友私信 |
| A-07 | DM 连续话题记忆 | 上下文组装可结合短期消息历史 | 只能使用同 UID 的历史 |
| A-08 | FriendDirectory/legacy 镜像 | 部分旧字段仍为兼容读取 | 不把 UI 镜像误称已彻底移除 |
| A-09 | 上下文诊断 | 可观测视频、热评/楼中楼、记忆等上下文状态 | 暂不能把所有降级原因等同为生产端到端证明 |
| A-10 | 备份与社交 per-UID 状态 | Life Memory outbox 纳入备份；社交私密 outbox 不纳入通用备份 | 恢复后需要按显式策略补偿或告知 |
| A-11 | 主人聊天新记忆额度、压缩与推荐配置 | 默认 30、最高 100，保守可选凝练，推荐值与旧用户保留策略已文档化 | 旧安装不自动覆盖、不能通过永久档案恢复遗忘 |

## 后续开发要求

所有新业务必须明确 `业务入口 → UID/身份 → 场景权限 → 上下文/记忆 → 隐私规则 → AI → 动作授权 → 平台回执 → 可恢复事件投影`。特殊领域如人生反思、情绪回顾、每日动态可以使用目的明确的专用读取入口，不能因为“统一”而扩大私密记忆读取权限。

平台侧真实账号、网络抖动、未授权发送、重启后外部回执不确定等仍需要真机验收；本报告不将自动化测试覆盖等同于部署验收。

## 七个原始开发目标逐项追溯（必须与代码、图纸、测试同时更新）

本节覆盖原对话提出的完整 dev.4 范围，不把“新增类文件”当成“所有业务已接线”。

| 原始目标 | 生产入口 → 适用统一层 → 数据出路 | 本次源码验证 | 需要留到 DSH 实机的部分 |
|---|---|---|---|
| 1. Memory Consolidation | 主 Session `dafeiyu_remember` → `LongTermMemory` 先去重/事实键更新 → 每日新增配额/持久候选 → `MemoryConsolidator` (默认关闭、3–8 条同主题) → 带 `sourceIds/evidenceKeys` 的凝练记忆 | 验证 30 条默认、100 条配置范围、重复强化不占额度、原始事实仍可回溯、输出不被证据支持时不提交 | 真实模型输出质量和长期累积行为 |
| 2. Life Memory 可靠协调 | 视频探索、评论真实事件 → `LifeMemoryCoordinator` 持久化 outbox → episode → reflection candidate → interest projection；反思再映射长期认识、情绪、人格 | 模拟 reflection sink 中断后重启恢复；重复事件不重复提交；永久档案不授权回读 | Windows 断电/文件系统 IO 失败的真实恢复 |
| 3. Social Context & Event Coordination | 社交入站和确认外发回执 → `SocialInteractionCoordinator` 持久化、分别 checkpoint → socialCognition/friendLearning/friendRelationships/LifeMemory 子域 | 模拟单 sink 故障、重启后仅补失败 sink、无外部重发、拒绝写入原始陌生私信数据；检查风险记录格式 | B站远端回执不确定、自动重试前后的真机状态 |
| 4. 评论、@、私信统一记忆与视频上下文 | 普通 DM/comment → `interactionBatcher.prepareContexts` → `SocialContextAssembler`；可信评论/owner DM 使用同一装配器的专用方法；memoryRetriever 由 UID+channel 决定读取视图；@ 首轮尝试热评 | 验证 owner DM 可以用私有记忆、公开 owner 评论不能，所有人的记忆不能跨 UID；@ 在首轮 AI 前请求热评；同 UID DM 历史参与检索 query | B站 API 是否确实返回主评论、字幕、热评内容 |
| 5. 身份、隐私、意愿、模型和动作策略 | `friendDirectory/socialTier` → `SocialPolicyGate`，`interactionPrivacy` 是确定性内容禁区，`dualContextAgency` 只输出意愿；`invokeInteractionPrompt` 调用模型；Node action gate + Python `_guard` 作最后授权 | 验证公开/私有记忆隔离、场景选择、策略用真实 UID 判定；只在收到平台成功回执后记录已回复 | B站开关/真实登录/限额在各平台动作接口上的操作验收 |
| 6. 原始生产接线、root、热门评论故障 | dev.3 生产入口已有 `comment`/`dm` 分流，原错误 `scene='social'` 不存在；`CommentRootResolver` 区分 `contextRoot`/`sendRoot`；未知 root fail closed；@ 首轮请求热门评论 | 复核 dev.3 基线，新增生产接线、顶层/嵌套/缺失根、热评/模型调用顺序测试 | 真正带有不同 URI 形态的 B站通知抽样验证 |
| 7. 技术图、审计、开发约束和精简 README | `docs/architecture/` 中原始审计图、最新实现图和本审计文档；AGENTS 添加统一层调用规范；README 仅保留用户关心的概要 | 文档路径、Mermaid 源、package files 白名单和正文引用自动检查 | 真实发布包安装后的本机文档入口 |

### 之前七段分析工作对应的验证位置

| 之前的分析步骤 | 本轮核对结果 |
|---|---|
| 设计统一上下文 | `SocialContextAssembler` 提供评论、普通 DM 和 owner DM 的独立方法；视图由 `SocialPolicyGate` 和 `memoryRetriever` 判定。 |
| 统一了社交上下文 | 普通 `interactionBatcher` 与可信评论 Agent 使用同一装配模块，不强行合并各自的决策及发送权限。 |
| 设计了事件协调方案 | `SocialInteractionCoordinator` 以平台事件构造幂等键，按投影逐项保存完成状态；`LifeMemoryCoordinator` 继续仅管理人生记忆域。 |
| 完善了事件协调方案 | 恢复时验证持久化状态格式、仅保存允许的投影字段；故障后不重新调用平台发送；已成功 sink 不重复写入。 |
| 统一上下文接口并整合事件流程 | 视频、评论、记忆、梗、人格走场景化装配；平台确认回执进入 outbox；有效反思证据再进入长期记忆/人格/情绪。 |
| 核对了根评论语义 | 顶层评论发回 `sendRoot=0`，读取使用自身根；楼中楼使用明确的 URI/root_id；直接父评论 `target_id` 仅作为定位线索，不能自动升为根。 |
| 完善了统一架构 | 最新 `implemented-unification-*.mmd` 与旧审计图并存；把专用领域读取视为有意的最小权限边界，不能用“单函数大一统”破坏隔离。 |

## 无法用此次自动化证明已彻底消除的风险

1. **A-08 旧配置兼容字段**：`dmWhitelist` 等旧字段有兼容读取；管理界面保存会同步名册，但其他写配置入口仍需监控。此项状态标记为**兼容保留，未彻底单一事实源**，不得写成已彻底修复。
2. **A-09 上下文诊断**：当前有视频可用性、热评数量、楼层数、记忆/梗命中等指标，尚未对所有失败原因生成统一带 request ID 的状态记录；标记为**部分覆盖**。
3. **A-10 可携带备份**：为了避免把私密好友数据传播到通用备份，好友侧观察和 SocialInteractionCoordinator 私密 outbox 未加入普通 portable backup；使用者不能把 portable backup 当成完整社交状态镜像。恢复前应确保待补偿为零，个人数据必须本机保留或按独立隐私策略备份。
4. **人类验收**：B站登录、通知详情、回执不确定以及 Windows Desktop 机器上的实际行为，不属于本地自动化测试可证明的范围。任何相关结论应标记“待真实环境验收”。
