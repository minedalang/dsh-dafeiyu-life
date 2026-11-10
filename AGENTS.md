## 当前开发目标（dev.56，未发布）

dev.38 历史阶段新增视频/私信/评论局部 Episode Handoff 和私信自主关注候选；其余 Agent 通用动作循环尚未完整实现，参见 `docs/architecture/2.7.1-dev38-subagent-action-continuity.md`。Universal Life Episode 不是单独的视频刷片脚本：有可信回执的 Life 自主行动要归入当前账号的匿名连续性片段；下轮要重新向鱼鱼提供有效的 `resume_episode` 选择（不强制），而不是因为上次视频 Agent 结束就失去上下文。入口、步骤、账号隔离、暂停、未知冻结、写权限和评论意愿均以 `docs/architecture/2.7.1-dev36-universal-life-episodes.md` 和 4 张 Mermaid 图为准。后续每次修改 Life 调用链，运行 `npm run write:life-architecture-view`、`npm run check:life-architecture` 与 `test/v271-dev36-universal-life-episodes.test.mjs`。原实际平台回执和 Life Memory 仍是唯一事实来源，不将匿名 Episode 记录当成真实观看/发布证明。 dev.37 统一归属以 `lib/life-action-attribution.mjs` 为唯一接入契约；只有原专业执行器可信平台回执才可记已核验，未知冻结原片段，不在此执行写入；详见 `docs/architecture/2.7.1-dev37-unified-action-ownership.md`。

# 大肥鱼 · DSH 生活系统：AI 开发约定

> 本文件只规定**当前长期有效**的开发边界和交付流程，不记录各版补丁历史。现行架构从 [`docs/architecture/README.md`](docs/architecture/README.md) 开始；历史决策通过 Git 与 [`docs/archive/README.md`](docs/archive/README.md) 查找。 当前 [RC 十三项自然行为](docs/architecture/2.7.1-rc-preflight-13-questions.md) 尚未通过 Windows、真实平台与跨日成长验收；不通过不得封 RC，所有改动应同步架构图、文档与测试。 RC8 方案优先的 UI 接线见 [`管理卡片架构`](docs/architecture/2.7.1-rc8-choice-first-management.md)；管理页、本轮生活套餐、新装/老用户授权差异及人格式证据边界见 [`RC 有机生活架构`](docs/architecture/2.7.1-rc-organic-life-controls.md)。
- 本版快速设置可直接预览、确认并保存生活、记忆与社交卡片，仍写入原配置；未完成必要验证不得新增社交授权。详见 [`快速设置内嵌卡片架构`](docs/architecture/2.7.1-dev8-inline-quick-setup.md)；V3 导览为历史增量。
## 项目与代码入口
- **当前 Life 架构图的唯一维护入口**：`docs/architecture/life-system-current.md`、`docs/architecture/diagrams/life-system-current.mmd`、`docs/architecture/diagrams/life-candidates-current.mmd`、`docs/architecture/diagrams/life-receipt-memory-current.mmd`。每次修改 Life 候选、调度、权限或回执，须同时维护 Mermaid 代码锚点，先执行 `npm run write:life-architecture-view` 更新 GitHub 预览，再执行 `npm run check:life-architecture` 与 `test/v271-dev33-life-architecture-contract.test.mjs`；图中已接线不得宣称实机验收。
- **dev.33 同版本菜单加固**：Life 每次输出须与当轮动作菜单中的 action/id/BV/capability 严格匹配；未提供的 reflect 不可从旧 parser 走漏。保持原账户、授权、回执/遗忘限制，详见 `docs/architecture/life-system-current.md`。
- **dev.35 P1/P2 补充限制**：已核验写入后可继续阅读或休息，但第二次写入须先完成真实只读核实或实际休息至少 15 分钟并重新审批；点赞不意味着必须评论。新增评论区只读与一次首页换方向，禁推断陌生人 UID。见 `docs/architecture/2.7.1-dev35-life-episode-p1p2.md`。**历史 dev.34 连续 Life Episode**：首页成功轮次的新入选候选接入原 `life-opportunities` 意愿账本；每个 Episode 最多 5 个已核验步骤，每一步重新决策，已核验 BV 去重，休息有界延后，未知写入冻结。原创评论的已知跨渠道冷却最多重考虑一次，账号变化/在途/未知不重试；不扩大任何外发许可。详见 `docs/architecture/life-system-current.md`。
- 包名与宿主插件名：`dsh-dafeiyu-life`；当前开发版本 `2.7.1-dev.56`（统一 Life 意愿所有权、移除 active 额外 social-shadow 模型比较、连续性证据时间线；继承 dev.55 取消旧每日选片限制和神经搜索改进；dev.52 统一 message-burst、dev.42 主 Session 主动聊天及 dev.41 视频间隔保留；Windows/真实平台仍待验收），稳定版基线 `2.7.0`（npm 实际发布状态仍须由维护者验证）；未经用户明确授权不得合并 `main`、创建 Tag 或发布。后续开发应重新从 `X.Y.Z-dev.N` 开始。
- dev.33 同版本维护修复：@通知只有经 B站源评论/UID/rpid/BV 核验并能分清独立留言正文时才进入回复 AI 或社交记忆；旧内部昵称歧义提示不是观众说过的话，修正仍清晰的情节副本与旧评论缓存，但不抹除已确认外发、也不恢复已遗忘内容。详见 `docs/architecture/2.7.1-dev33-mention-memory-hotfix.md`。
- dev.32：为 Life 自主首页闲逛补上**实际 MCP 首页读取**的匿名回执：由原视频 Agent 的随机轮次 ID 绑定 headless 工具调用，区分未观察到、无候选、失败、有候选；不把选片/观看与进程成功混淆，不复制 BV/UID/私密内容，也不调整视频发送门禁。见 `docs/architecture/2.7.1-dev32-home-feed-receipts.md`。
- dev.31：`LifeReflection.status()` 提供与自动反思执行器共用的就绪判断，`AutonomousPlanner` 不再凭 pending 数量提供假可用 reflect；反思被跳过的枚举原因进入脱敏日志。主 Life 模型失败后的退避在原 planner 预算账本持久化，手动唤醒不自动打开新写权限；`browse_home` 只在已打开首页推荐且原视频能力可用时列入菜单，通过原视频 Agent 先看真实首页推荐。`life-willingness` 的可选语境读取失败尽量降级，基础身份不可用仍拒绝写入。见 `docs/architecture/2.7.1-dev31-life-idle-and-home-browse.md`。
- dev.30：所有本轮已核验、具有可信来源的 Life 读写操作（包括搜索、公开作品核实、社交推荐、点赞、收藏、关注、评论、私信联络、已接受的只读待办）以 `kind:action` 投影到原 `life-memory-coordinator` → `LifeMemoryGateway`，由原有 `MemoryRetriever` 的词法＋本地向量统一召回；仅保留真实来源、账号范围与安全可公开的元数据，不录私信正文或评论原文。新事件始终受账号、权限、逐步衰减和遗忘门禁；原操作账本仅作事实证明，不从永久档案复活记忆。已安装模型“重新检查”只读状态，进度只在有进行中任务时显示。详见 `docs/architecture/2.7.1-dev30-verified-life-action-memory.md`。
- dev.28：在现有跨日公开互动的匿名人物契机之上，允许 Life 自主读取经宿主重新核验 UID 的评论者公开投稿列表，存储仍沿原账号意愿账本，只写真实 BV/标题；随后沿用 dev.27 对选定作品的逐动作写入门禁，不开放任意陌生人漫游、跨串回复或新的私信许可。见 `docs/architecture/2.7.1-dev28-public-person-life-exploration.md`。
- dev.27：Life 仅在原账号真实核验 BV 和公开内容证据后，把点赞/收藏/视频作者关注/原创顶层评论列为自主续行候选；新 `life-continuation-write.mjs` 与受控 Python 工具只协调原 `life-video-action-bridge.mjs` + Python 自主工具，不替代原 Life 再意愿、额度、身份、防重或读回核验。单轮最多一次写入，结果未知冻结；原账号意愿仅存匿名动作状态，不存评论正文。老用户授权不改动，不给评论者 UID/跨串回复权限。见 `docs/architecture/2.7.1-dev27-life-continuation-writes.md`。
- dev.26：复用原 `AutonomousPlanner`、账号隔离的 `life-opportunities` 意愿/回执与现有模型额度，在自动 Life 轮已有真实公开读取成功后最多增加 2 次模型自主选择；只允许既有名单的 `inspect_exploration`、`inspect_creator_space` 与放下，执行前重新核验账号与候选，禁止新建第二任务账本或新增外发权限。原创主评论仍由视频 Agent 的 `bili_reply` 经 Life 意愿、公开评论授权及平台回执；新增原 `life-agent-events` 视频轮次脱敏诊断。旧 `dmMode` 报告投递已退役；迁移不修改 `autoComment` 原有开关，只移除旧报告字段和错误门禁。见 `docs/architecture/2.7.1-dev26-life-continuation-and-comment-diagnosis.md`。
- dev.25：`lib/recall-request.mjs` 承担模型提出的回忆意图/查询词/日期/事件种类的结构化校验，宿主时区换算，日期与事件类型必须在当前已授权/未遗忘候选上执行硬过滤。`memoryRetriever` 只将过滤后的候选交给可选 Embedding；时间线回顾按真实发生时间排序，不能用长期记忆 `createdAt` 猜事件日期；模糊/痕迹记忆不提供精确日期。主人私信、普通 compact 社交、好友私密回忆、公开评论成功回执沿旧统一层接线，无新的事实源、权限或发送器。详见 `docs/architecture/2.7.1-dev25-temporal-intent-recall.md`。
- dev.24：本地 Embedding 仅作为 `memoryRetriever` 的候选排序提供者；不建立第二事实账本、不绕过 `LifeMemoryGateway` 权限/遗忘过滤。向量命中必须按 ID 回到实时账本重新核验；llama.cpp 只绑定 `127.0.0.1`，使用随机 API Key、关闭 Web UI，默认不开启且只有用户明确点击才下载模型。详见 `docs/architecture/2.7.1-dev24-local-embedding-recall.md`；dev.23 主动回忆契约及 legacy full/专业 Agent 未统一边界见 `docs/architecture/2.7.1-dev23-active-recall-unified.md`。
- dev.22 主人私信与主人公开评论按需共用当前账号的公开评论**成功回执**查询，无第二份账本；公开评论只可额外修正聊天回复，不能因此重做意愿或扩大外发权限。见 `docs/architecture/2.7.1-dev22-public-recall-unified.md`。dev.21 主人私信新增独立只读回忆动作，当前账号核验后可查实时长期/情节记忆，不靠主 Session 记忆开关；拒绝归档复活、跨账号读取与整段固定检讨回退。见 `docs/architecture/2.7.1-dev21-owner-active-recall.md`。dev.20 退休低额视频分享/跨渠道同人日硬限额，Life 协调全局、专业 Agent 保留授权内局部自主决策；主人查询本人公开经历优先读当前核验账号的真实记录，切号不混用。见 `docs/architecture/2.7.1-dev20-life-contract-owner-recall.md`。dev.19「大肥鱼的一天」只呈现生活行动；内核平台回执、诊断和防重仍保留，正文已展示的评论不再重复列事务卡片。见 `docs/architecture/2.7.1-dev19-owner-life-timeline.md`；dev.16 原可信证据边界不变。
- `index.js`：宿主配置、工具与 HTTP 业务入口；`client.js` 和 `lib/management-console.*`：界面；`lib/`：业务与共享层；`prompts/duty.md`：用户可修改的章程；`vendor/bilibili-mcp/`：内置 Python MCP。
- 运行数据保存在 `$DSH_HOME/bili-duty/`，不能写回插件包。不得自动覆盖用户修改的章程、配置、模型或权限；dev.4 旧视频定时驱动已退役，明确保存暂停后普通手动生活唤醒也停止；社交旧独立决策器退役，新老用户均需迁移为 Life 归属；未知发送则冻结。Phase 6/7/8 迁移核验见 [只读迁移门禁](docs/architecture/2.7.1-dev4-life-transition-readiness.md)；设置及当前增量见 [Life 双节奏与预算架构](docs/architecture/2.7.1-life-a-dual-lane-budget.md)；旧发言授权仍按原门禁执行。
- 维护原作者与第三方署名；不得声称这是 DSH/B站官方产品。

## 产品原则和不可突破的边界
- **对外品牌主张固定为「坚持鱼的自由发展」**：README 和对外宣传强调鱼鱼在持续生活、探索、社交中形成自己的喜恶与选择，而非仅执行命令；不得把愿景写成已验收能力，也不得暗示 AI 具有真实意识或绕过授权。

1. **同一条鱼、双域意愿**：主 Session 按授权执行工作请求；B站生活域保留自主接受、延期、拒绝、沉默与自然成长。模拟情绪／人格不代表真实意识。
2. **意愿不等于权限**：任何自动评论、私信、点赞、关注、动态发布等外部写入，都必须通过身份、用户授权、额度、去重和真实平台回执；未知或不确定发送结果不得盲目重试。
3. **事实不等于意愿，也不等于记忆**：真实执行回执产生后便可在授权范围内查询，不依赖是否已经回访；检索资料不等于看过画面／听过音频，草稿不等于已发布。
4. **尊重隐私和遗忘**：按真实 UID／账号／公开或私密域隔离；只读取仍可访问的可衰减记忆。永久归档是备份／审计材料，不可绕过遗忘恢复到模型上下文。
5. **老用户数据恢复优先**：旧 UI／定时流程可重构，不能静默丢失记忆、关系、待办、回执或扩大权限；备份/恢复须区分原便携白名单与停机完整本地快照，并在恢复后要求同 UID 人工复核外发。见 `docs/architecture/2.7.1-dev4-life-agent-phase3.md`。

## 所有新需求必须先执行「统一层归属检查」（硬性开发门禁）

**修改业务代码、提示词、配置或 AI 决策前**，阅读 [`docs/architecture/2.6.2-unified-layer-change-gate.md`](docs/architecture/2.6.2-unified-layer-change-gate.md)，先列出：

`入口 → 复用的统一层 → 唯一事实／状态源 → 新增场景信息 → 权限和隐私边界 → 受影响渠道 → 回归测试`

| 能力 | 当前唯一职责归属 |
| --- | --- |
| 基础人设、成长人格、当前连续情绪、表达风格 | `Life Voice Context`（`lib/life-voice-context.mjs`；情绪数据由 `lib/emotional-state.mjs` 维护） |
| 实际经历与待办成功回执的事实视图 | `lib/verified-life-facts.mjs` 与可信任务／平台执行记录 |
| 当前可回忆的人生经历 | `LifeMemoryGateway`、`memoryRetriever`（受衰减和权限限制） |
| 身份、关系上下文 | `SocialContextAssembler` 等现有关系层；熟悉度不能授予权限 |
| 生活意愿和自主决策 | 现有生活域意愿／模型决策层；社交意愿分数不是强制回复概率 |
| 发言许可、冷却、去重、送达核验 | `SocialPolicyGate`、渠道发送适配器及回执协调层 |
| 当前评论／私信连续话题 | 场景层只提供已核实的原文、同 UID 近期交互与线程线索，**不再造人格或情绪提示** |

**现有统一层无法合理承载新功能时，允许新增统一层**，但必须先证明：① 现有层职责确实不匹配；② 新能力有跨入口复用需求或独立生命周期；③ 明确唯一写入源、读写接口、失败与迁移边界；④ 与旧层无重叠责任；⑤ 至少有两个入口的接线或清晰的后续接入计划。不得为单个 Bug 临时造一个“万能层”。审批标准及设计模板见变更门禁文档。
## 2.7.0 社交自主统一职责（正式版维护门禁）

- 新的回复／延迟／续聊必须先走 `SocialAutonomyDecisionContract`，它**不得被当作已获发送权**；后台私信与公开评论/@ 均已接入统一决策与 P6-A/B，但公开 P6 默认关闭、私信 P6 默认开启且不授予额外写权限；情绪和人格只从 Life Voice 装配一次。
- P6-A/B 共用 `SocialConversationContinuity` 的账号、UID、渠道与线程隔离意图；`SocialInteractionRhythm` 统一约束三类后台自动发送（跨渠道冷却、未结算事务；旧同一人24小时次数硬限额自 dev.20 退役），配置项详见 `docs/architecture/2.7.0-dev2-public-p6-rhythm.md`，不另造私信和评论定时器；每条真实发送仍经原有 SocialPolicyGate、限额、退订、真实回执。
- [2.7.0 统一自主社交架构设计](docs/architecture/2.7.0-unified-social-agency-plan.md) 明确区分已实现接口和未来生产接线；`SocialPortraitGateway` 在经核验的白名单好友私信/公开评论入口保存可撤回的明确交流证据，按账号/UID/私密域隔离、180天衰减；它不是熟悉度、发送权限或第二人格。`LifeInterests` 保留原有可信观看兴趣证据，新增不改变长期兴趣的短期陌生主题好奇候选；兴趣缺席不等于不感兴趣。现行图见 `docs/architecture/2.7.0-dev3-portrait-open-curiosity.md`。
- `dev.4` 在同一 `SocialPortraitGateway` 中增加明确的先询问/防剧透/不主动追问证据；仅对 P6 延迟预约和到期唤醒施加可撤回的否决，不替代普通回复或外发权限。`LifeInterests` 的 `curiosityDismissed` 是主人可恢复的 30 天主题排除，不是长期不喜欢或第二份兴趣档案；现行接线见 `docs/architecture/2.7.0-dev4-portrait-curiosity-review.md`。
- `dev.5` 在原关系索引提供分阶段的可信互动元数据，`SocialPortraitGateway` 继续是唯一的枚举化交流证据源；自然联系人从已核实的 `known` 阶段开始有限画像，白名单维持旧证据兼容。`social-person-identity.mjs` 仅提供平台隔离身份键（当前 B站生产接线），不得通过同 UID/昵称自动匹配其他平台。人物详情从「逐渐熟悉的人」懒加载；原社交权限页不再维护第二份画像控件。现行图见 `docs/architecture/2.7.0-dev5-person-portrait-multiplatform.md`。画像阶段、熟悉度永远不授予外发权限。
- `dev.6` 在原 B站动作账本中记录真正入选视频的创作者相遇线索，并为主 Session 提供单 BV 的只读关注当前态／历史回执查询；`VerifiedLifeFacts` 按当前登录账号校验并分离历史动作与实时状态。默认关闭的自主关注授权不变，绝不把旧「值得看/不值得看」主人推荐标签当作新关注契机。人格成长进度条与 B站关系互动计数只改准确说明，不制造经历或跨身份关系。旧视频推荐功能的重构或删除**延后**，现行接线见 `docs/architecture/2.7.0-dev6-creator-facts-and-growth-diagnostics.md`。
- `dev.7` 私信 P6-B 增加“模型明确选定开放话题，回复后对方沉默时重新考虑”的一次性可选意图，使用原 `SocialAutonomyDecisionContract`、`SocialConversationContinuity` 和原私信发送门禁；只在已授权的入站私信线程发生，不提供无关话题的定时主动找人。到期读私信暂时失败时，只能在未尝试平台发送的前提下有限延期，未知发送不自动重试。管理页只显示不含聊天内容或对方 UID 的聚合预约状态。实际接线见 `docs/architecture/2.7.0-dev7-dm-silence-reconsideration.md`。
- 不能把允许回应入站 @ 理解成可主动 @ 他人；关闭暗号审核不会授予陌生人自动私信权限，陌生人外发仍须主人明确开启 `dmStrangerAutonomyEnabled`（独立、默认关闭的新授权）；旧版 `dmStrangerOnce` 只保留原有有限次数、单条即时回复权限，绝不能在升级时隐式扩为多条气泡或延迟续聊。
## 2.7.1-dev.9 当前生产归属（RC6–RC10 为历史增量）

- dev.9 增加跨 DSH 进程的持久 Life 决策准入；未结算或未知状态不自动释放，恢复需离线确认并检查平台事务。候选重建/自动续行仍未完成；原发言权限不变。见 `docs/architecture/2.7.1-dev9-durable-life-admission.md`。
- DSH 原生设置镜像失败时，以插件自身 `config.json` 及生效配置双重回读作为保存判断；不可伪称宿主已经同步。
- UI v2 继续使用顶部横导航及原数据接口；普通自主社交不能由主人逐条审核或代发，历史权限不自动扩张，动态草稿审核独立保留。详见 `docs/architecture/2.7.1-dev8-life-ui-v2.md`。

- 新老用户均迁移到 Life 的 DM+comment 双渠道唯一决策归属，旧 `legacy` 不再作为生产发送兜底。原授权、记忆、待办、关系、跨进程工具和回执保留。迁移未核验/在途/未知发送时双渠道冻结；主人 Agent/回访受 Life 归属约束，自动视频分享需 Life 最终决定。当前架构与 Mermaid 见 `docs/architecture/2.7.1-rc-unified-life-social-migration.md`。仍为 dev.7，Windows/真实 B站/长时运行未验收。
## 2.7.1-dev.1 真实视频评论区观察边界

- 自主视频轮开放原只读 `bili_comments` 与 `bili_comment_thread`；不得因为浏览评论自动发言、创建待办或认识评论者。视频轮的 Python MCP 环境明确标记 `BILI_DISCUSSION_VIDEO_AGENT=1`，每轮最多读取 6 条不同 BV 的评论列表、2 条已出现在本轮对应 BV 列表里的真实楼层；其他主人查询与后台互动不被这些视频轮额度影响。
- 实际读成功/失败生成最小只读回执（不含评论正文、评论者 UID、私信原文或模型隐私上下文）。`bili_discussion_note` 可在本轮确实读到评论后保存一次主观临时疑问；原有日报工具 `bili_report_append` 也可在写日报的同次调用中可选附带真实阅读 BV 的主观反应，使用同一安全写入者；未提供感受时仅可记录匿名诊断，不得编造主观事实；它不进入长期记忆、兴趣分数、关系索引、待办账本或外发口径。错误或风控不能伪装成“无评论”。见 `docs/architecture/2.7.1-dev1-video-discussion-life.md`。

## 2.7.1-dev.2 私信短期上下文生命周期

- `dm-context-retention.mjs` 只负责按 UID 清理后台普通私信中可给模型的短期原文：近期对话最长 14 天，旧来信片段最长 7 天，旧版无法证明日期的旧片段不得进入模型。`dmHistoryLimit=0` 不保留新的普通私信上下文。已读 ID、拒联、严格审批、未知发送结果和硬额度不是聊天原文，不因到期清理而重新开放发送。
- 主人专属 Agent 保留自己的受限上下文，普通聊天最多 14 天，已成功确认的补充回复仍只保留 24 小时；与主 Session 语义记忆整理、好友交流偏好画像和可衰减 Life Memory 不合并原文。绝不能用过期私信正文生成新的事实或长期人物认识。
- 管理中心「后台私信 → 私信上下文与记忆边界」提供当前账号的只读统计和显式清理按钮；清理只影响后台普通私信上下文，不能扩大任何外发授权，也不能清空安全去重或恢复已遗忘资料。详见 `docs/architecture/2.7.1-dev2-dm-memory-governance.md`。实际 Windows / B站环境仍需验收。

## 2.7.1-dev.3 生活行动契机首批接线

- `life-opportunities.mjs` 只从**当前登录 B站账号**的真实非空评论列表阅读回执与之后的临时主观感受派生短期可选线索；不能把主观疑问写成已验证外部事实、长期记忆、兴趣偏好或已接受待办。按账号 HMAC 伪名隔离决策记录，过期观察不得重放；失败、延期、忽略和放弃均有可验收记录。
- 复用 `AutonomousPlanner` **原有一次模型调用/既有模型每日额度、时段、冷却和同一 busy 门禁**，不增加平行定时器。AI 只能选择对既有 BV 进行只读 `bili_video_info` 元数据核实，或延期/放下/跳过；真实只读平台回执必须匹配最初 BV，失败不认定观看或成功事实。主人原有“提醒待办”操作仍保持 `todosOnly`，新增「人生记忆 → 生活行动契机」可单独触发只读考虑。
- `promptFor` 可以使用当前账号最近核实成功的 BV 元数据作为下一轮视频 Agent 的弱生活线索，但不得强迫搜片、形成待办、点赞、评论、私信或关注；所有对外写入继续遵守原权限。当前仅接入**公开评论观察**的首批契机，兴趣/人物的跨日反馈和跨场景语义冲突仍留后续开发。架构/源码及验收详见 `docs/architecture/2.7.1-dev3-life-opportunities.md`。

## 2.7.1-dev.3 补充 · 多来源契机和事实来源门禁

**当前增量并非 `dev.3` 整体完成：** 本轮自主生活意愿重构复用 `life-opportunities.mjs` 同一账号匿名状态文件保存可选短期 `intentions`，复用 `AutonomousPlanner` 的同一 AI 额度与 Life Voice。只有当前账号可证明的跨日自主选片兴趣允许鱼鱼自选目标后搜索公开主题，再跨轮核实真实搜索 BV；模型自由目标不得作为外部搜索参数，任何返回 BV 必须重新核实。已有评论、人物只读候选不变，私信/关注等外发未接入。详细现行能力与未覆盖入口见 `docs/architecture/2.7.1-dev3-unified-life-intentions.md`。

- `LifeInterests` 已有的真实自主选看证据新增可选的 B站凭据作用域标签；只有登录账号确切可追溯、跨至少两天的多条非私密选片才派生兴趣契机。无账号标签的旧数据只用于原有兴趣展示/校对，不因软件升级自动变成当前账号的行为指令。延迟超过两天的导入/补偿不能自动打当前账号标签。
- `SocialPortraitGateway` 的当前账号运行目录可提供从**公开评论**多日不同真实事件得到的脱敏交往偏好线索；需至少两次独立、跨日公开表达，既不访问私信正文也不产生联系人名单、模型可用 UID 或发送许可。撤回、清除、来源过期应立即使候选失效。
- 原 `LifeOpportunities`、`AutonomousPlanner` 和管理页承接多来源，只能核实已知 BV 元数据或在本地复核公开交流证据，不能写入待办/记忆/社交关系，更不能私信、@、评论或关注。模型提交未知 ID、跨来源动作、当前数据源缺失都不能报告为真实意愿或成功回执；每日 AI 限额及发送门禁不变。见 `docs/architecture/2.7.1-dev3-life-opportunities.md`。

- `dev.4` Life Agent 社交仍由旧 DM／评论回复器唯一决策和发送；Phase 6g 的只读影子审计限制同来源唯一配对和首次分类不可覆盖，不增加发送权（[`当前文档`](docs/architecture/2.7.1-dev4-phase6g-social-shadow-audit.md)）；Phase 5 单独、默认关闭的 `lifeAgentSocialContextOptIn` 只允许核验好友普通 DM 与公开评论的 10 分钟／420 字进程内影子上下文，模型额外分类计入原每日额度，不授权外发；生产说明见 [`Phase 5`](docs/architecture/2.7.1-dev4-life-agent-phase5-social-shadow.md)，旧归属契约见 [`Phase 4`](docs/architecture/2.7.1-dev4-life-agent-phase4-social-owner.md)。

## 任何架构变更必须同步更新文档（与代码同一次提交）

以下均属于架构变更：新增／撤销统一层、改变状态来源、事件与数据流、模型上下文装配、渠道接线、权限边界、数据存储、业务 API 或恢复流程。

- **必须更新** `docs/architecture/README.md` 中的当前入口和职责，并修订对应的当前架构说明、可编辑 Mermaid 图（必要时更新 SVG/PNG）与跨渠道接线／风险矩阵；新层必须补完整的数据契约与边界。
- 旧审计、提案或版本图**必须标明历史／规划**，不得继续列为当前真值。历史变更说明写 CHANGELOG、Release Notes 或归档，不堆进 AGENTS 和根 README。
- **必须补测试**：最终模型输入的唯一人格／情绪来源、跨 UID 与私密域隔离、可信事实与真实回执、权限和发送幂等、旧数据兼容。只有文档变更时验证文档索引与链接。
- **必须交付可验收入口**：对新行为明确「怎样触发／在哪查看／真实执行回执／未执行与失败原因／隐私与成本边界」，不允许仅凭 UI 占位、提示词或单元测试宣称真实功能已验收；若无法观察，应明示缺口并优先补可见性。统一规范见 `docs/architecture/acceptance-observability-contract.md`。
- 如果一轮修改确实**不改变架构**，在提交说明中写明“架构接线未变”；不能默默跳过判断。
## 研发、测试、提交和发布
- 先定位真实生产入口及现有接口，再实现并添加定向测试；不要把脚本层 mock 当作真实 B站发送成功，也不要为了让测试变绿恢复错误的重复逻辑。
- 检查 Node.js 全量测试、相关 Python 测试、`node selfcheck.mjs`、`npm pack --dry-run` 与 `git diff --check`；某项失败／超时应如实报告。
- 交付注明基线、变更文件、复用的统一层、新增内容、未覆盖入口、实机待验收项，提供 Git Patch、中文 Conventional Commit 和适用于 `dev` 的 Git 命令。不得自动发布。
- **版本阶段门禁**：开发阶段使用 `X.Y.Z-dev.N`，不要提前把 `package.json` 填为 `X.Y.Z`；正式封版时再同步升级 `package.json`、`package-lock.json`、README、CHANGELOG、Release Notes、测试与 Git Tag。GitHub 预览标签 `vX.Y.Z-dev.N` 不属于正式 Latest，npm 预览必须使用独立 dist-tag。
- README 写面向用户的理念、特色与首用步骤，**不放开发历史流水账**；技术细节与架构更新进入 `docs/architecture/`。
## 使用与安装诊断

- DSH Desktop 通常执行 `dsh plugin --profile desktop add dsh-dafeiyu-life`，重启后在「设置 → 大肥鱼」安装依赖、扫码登录、完成所需 Headless 模型验证；安装入口与市场实际版本须单独确认。
- 插件可自行安装 Python 运行依赖／uv；遇故障先用设置页自检和 `duty.log`，不要要求用户先全局安装任意工具或绕过安全门禁。
- 新安装的明确可选功能、旧版既有设置、First Start 必需验证是不同状态；不能通过隐式改默认值打开外部写入。


## README 是用户首页，不是开发版本日志（dev.52 起强制执行）

- 根目录 `README.md` 必须当作**最终发布页的简洁用户介绍**维护：价值主张、最重要的 2.7.1 新功能（自主 Life、原主 Session 自然对话、真实记忆／兴趣脉络、社交与安全）、安装／配置、权限及诚实的验收状态优先。
- 禁止在 README 顶部不断追加 `dev.xx` 小版本逐条通告、长篇技术实现、完整补丁清单和流水账。每次新开发版只更新一个当前版本标识，并仅在影响用户功能时修改相关的一两句话。
- 每一个开发版本的详细变更、故障原因、测试、约束与代码锚点应写在 `CHANGELOG.md`、`RELEASE_NOTES_v2.7.1.md`、`docs/architecture/` 和交付包的 `TEST-RESULTS.md`；不要重复抄进 README。
- 不得为了推广声称未真实验收的功能已在 Windows、B站或 DSH 各宿主全部通过；模型选择、发送提议、提交工具、平台确认严格区分。
- 社交行为回归时以主人权限、账号隔离、入站核验、Life 自主意愿、未知回执禁止自动重试为硬边界。不要用强制最低评论数取代自主表达；先解释有证据的行为诊断和技术拒绝原因。
- 可视化链接只能依赖已核实的同源 ID；相似词、同日和相近话题不构成因果。兴趣的累计证据不能伪装成某条具体 BV 的关联。


## README 与版本文档维护规则（长期有效）

- README 是用户首页，不是开发版本日志：主要介绍产品价值、2.7.1 Life 自由生活与神经回忆特色、安装、权限边界和必要链接，**不堆叠每个 dev 的详细变更**。
- 每个 dev 的代码差异、迁移、测试和技术限制写在 CHANGELOG 与 `docs/architecture/2.7.1-devNN-*.md`；`docs/README.md` 仅保留当前版本、架构、未来规划与历史归档的入口。
- 新功能必须先核对原统一层，明确唯一可信事实源、记忆/权限/隐私边界、受影响入口和测试；更新四张 Life Mermaid 图与架构说明。不得以 UI 简化删除模型任务、扩大社交发送权限、复活已遗忘经历或把通用标题标记当成梗事实。


### dev.56：Life 为行为主体，专业 Agent 负责读取与表达辅助
- 所有专业 Agent 的观察、候选措辞和工具请求都是数据，不构成 Life 自主意愿；Life 的 `skip/defer/act` 决策必须独立有效且只对原候选有效。
- 单个对外行为只做一次最终 Life 意愿决定，发送阶段只执行权限/账号/防重/配额/平台回执检查；评论必须与 Life 本次已选公开正文严格一致。
- active 社交唤醒不可再执行 `social-shadow` 二次模型比较。通用 shadow 干跑与历史记录是不同概念。
- 时间线只能按确证轮次或同源 Episode 关联，不能凭日期或近邻时间发明因果关系；文档见 `docs/architecture/2.7.1-dev56-life-owned-intentions-and-journeys.md`。
