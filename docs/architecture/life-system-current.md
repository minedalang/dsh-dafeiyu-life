> **dev.12 增量（不冒充实机验收）**：`LifeOpportunities` 将评论成功回执作为开放式视频 Episode，局部续行按真实新观察抑制冗余唤醒；具独立跨日公开证据的评论者可凭匿名 ID 只读查看作品；五步结束有新证据时只保留一次可选延续；原兴趣/反思提供只读成长归因；设置页 npm 版本状态常驻。详见 [dev.12 自然 Life 设计](./2.8.0-dev12-natural-life-design.md)。

## 2.8.0-dev.10 · 跨渠道证据与社交意愿统一（开发预览）

- 首次可信评论模型分离行动决定与表达决定；普通聊天可自主沉默，公开回忆的第二模型仅能修正回复，不可改变动作。
- 同窗口公开候选保留限长证据摘要；混合 DM 与公开机会不带出私信原文。视频 Episode 与社交已选回复进入同一账户 FIFO 意愿证明。
- 主人/好友可信评论回复复用 `LifeWillingness.adoptSocialDecisionQueued`，精确绑定源评论、对象和最终文本；原 B站回复发送器仍负责事实核验、配额、平台事务与独立回执。
- 取消并发导致视频意愿被直接丢弃的部分情况；排队期间切号/撤权安全阻断而不是重新意愿审判。队列超时不自动重放，真实平台/Windows 仍待验。
- 见 [dev.10 跨场景自主协议](2.8.0-dev10-cross-scene-autonomy.md)；四张架构图的代码锚点与可视化预览同步维护。

**2.8.0-dev.8 增量：** Life 自己 `inspect_opportunity` 并有原机会账本同 BV 已核实决定后，可以创建 `inspected-opportunity` 原账本意愿；Life 自选 `execute_read` 中的 `watch_video` 有可信完成任务回执、同 BV/标题与当前账号时，可以创建 `completed-video-todo` 原账本意愿。两者复用 `continueLifeRead` 下一次独立模型选择、原 Life/Python 写入门禁和独立平台回执，不要求启动完整视频 Agent；不能将只读元数据当完整观看，也不强迫点赞/评论。源码 `lib/life-opportunities.mjs`、`lib/life-video-episode-evidence.mjs`、`lib/autonomous-planner.mjs`、`index.js`；真实平台仍待验收。

> **dev.6 当前单次意愿接线：** DM/评论原社交模型可一轮输出 `todoTiming=now|later`；合法 now 从原 `OwnerTodos` 原子写入后，在原 Life 运行锁下直接执行同一只读意愿，**没有第二次 Life 模型投票**；later 和旧无 timing 待办仍走普通自主规划。`assessReadExecution` 不得再次用本地情绪分数否决。原 Life 决定的朋友联系只需下游生成文案；已有社交回复中明确而经核验的好友关注采用一次性绑定证明；待办回访由 Life 决定后只生成表达。新的真实公开读取证据之后的**下一步**才允许另外自主选择。权限、账号、防重、未知冻结和真实回执仍独立执行。见 [dev.6 契约](./2.8.0-dev6-single-intent-actions.md)。

> **2.8.0-dev.4 自动恢复补充：** `AutonomousPlanner.start()` 与 `runLease.acquire()` 仅对操作系统证明原 PID 已退出、内容结构完整的原全局规划运行锁进行带竞争保护的自动回收，不改变同账号外发事务或 Life 授权账本。损坏/归属不明的锁继续拒绝，管理页展示停摆诊断。详细审计见 [dev.4 自动恢复契约](./2.8.0-dev4-planner-crash-autorecovery.md)。

> **当前 dev.74 关系契约：** 自然熟悉度由原 `SocialRelationshipIndex` 提供，不以白名单提升；当前账号新 `social-relationship-channels` 仅存已核实的渠道、方向、时间和事件摘要。公开评论再熟悉也不能直接取得主动私信资格；仅在稳定跨日双向 DM、单独主人授权、明确拒联检查、Life 决定与原 DM 事务共同通过时才有可发起机会。老关系存档仅用于历史展示，不会升级为私人发送权限。参见 [dev.74 说明](./2.7.1-dev74-three-dimensional-relationships.md)。

> **当前 dev.73 增量：** `LifeOpportunities` 观察/契机与 `OwnerTodos` 已接受待办并列呈现在只读计划卡片；普通自主轮受设定的最短 10/30/80 分钟节奏控制，已核验入站社交关注保持独立快节奏。`LifeDecisionTrace` 以授权待回执／超时未结算／平台已核验区分结果，不改写原状态或平台外发权限。参见 [dev.73 约束](./2.7.1-dev73-life-pace-and-decision-clarity.md)。

> **当前 dev.72 增量：** Life 同账号新机会由进程内有界队列协调，评论和私信生成后的表达授权随队列等待原证明结算；仍由原 Agent 验证身份、内容和平台回执。B站私信 -509 退避不由其他读取接口提前清零。生活时间线不再绘制稀疏关联分组，重复情绪不刷屏；设置搜索只导航，名单保存仍走原权限接口。见 [dev.72 约束](./2.7.1-dev72-life-fairness-and-owner-ui.md)。
>
> **当前 dev.71 增量：** Life 持久准入锁新增最终消费标记；过期未消费的批准可安全释放，已消费或旧版未知状态仍需离线核查。私信、评论、回访和视频分享所有提前退出路径均结算一次性证明，避免遗留账号级锁；动态评论状态将授权复核与模型失败分开显示。旧 dev.70 账本的单次恢复工具及安全边界见 [dev.71 授权恢复契约](./2.7.1-dev71-life-admission-recovery.md)。
>
> **当前 dev.70 增量：** 动态通知先按真实动态 ID／评论区 oid／rpid／UID 核验；临时读取失败有界重试，不再第三次后永久丢弃。Life 两个可见模型额度不再被隐藏 288 次合计封顶，移除跨渠道 30 秒和纯探索 6 小时隐藏静默。见 [dev.70 核验与额度边界](./2.7.1-dev70-dynamic-verification-and-visible-life-quotas.md)。
>
> **dev.69 兼容增量：** 普通评论字符串模型结果在一次 Life 表达决定之后、发送之前标准化并绑定精确正文；只读候选的隐藏次数限制退役，后台 B站读取节奏和 Life 社交注意力预算由管理页配置。视频主评论的尝试、延期、失败分别记录，不假冒 Life 自主休息。见 [dev.69 自主额度与表达修复](./2.7.1-dev69-social-expression-and-free-quotas.md)。

## dev.40 新增专业行为动态菜单与逐动作跨 Agent 公开因果桥

查看 [dev.40 自由决策与持续性源码自查](./2.7.1-dev40-autonomy-and-continuity-audit.md)。动态候选只来自当前真实工具与配置；私信／评论可最多两次请求只读证据并重新决定；视频和评论可沿同 BV 的每条真实回执共享匿名因果。其他未实现的跨 Agent 意愿事务和真实环境验收不得夸大。

> dev.38 跨专业 Agent 局部 Episode Handoff、私信可信联系人自主关注候选（限明确授权并经二次审批/平台读回）见 [专项说明](./2.7.1-dev38-subagent-action-continuity.md)。它**尚不是**所有 Agent 的通用自由行动循环。

# Life 全景图与源码接线审计（当前 dev.37 发布前检验／dev.37 跨渠道行动归属 + Universal Life Episode）

> **dev.66 增量：** 视频 MCP 在原 Headless 轮次内只记搜索/详情/字幕/评论/入选工具的受限回执；原 LifeAgentEvents 视频轮次新增脱敏漏斗计数，日报可写入真实 BV 链接与可核验分类，仍不把取标题或字幕等同看完视频。评论和私信独立调度不等待 Life `consider_social`；若 MCP 已审版本不一致，安全门禁会停止评论读取，须主人在运行诊断里核对、备份后修复。详见 [dev.66 契约](./2.7.1-dev66-video-funnel-social-integrity.md)。

> **可直接在 GitHub 查看渲染结果：**[Life 全景与候选图](./life-system-current-view.md)。它是根据 `.mmd` 自动生成的只读展示，不应直接编辑。
>
> **唯一维护入口：**[完整 Life 生产代码全景 Mermaid](./diagrams/life-system-current.mmd) · [八类候选精确字典 Mermaid](./diagrams/life-candidates-current.mmd) · [回执与可衰减记忆闭环 Mermaid](./diagrams/life-receipt-memory-current.mmd) · [统一 Life Episode Mermaid](./diagrams/life-universal-episodes-current.mmd)。这四张 `.mmd` **是源文件**，可直接通过 GitHub Mermaid 或支持 Mermaid 的编辑器编辑、比较和渲染；此前的 PNG 仅为概念插画，不是程序运行证明。
>
> **状态：`2.7.1-dev.38` / `releaseReady:false`**。未合并 main / Tag / 发布。图中“已接线”只指源码、相关离线契约存在，不代表 Windows、真实 B站、GGUF、72h 实机验收。

**dev.37 同版冷却隔离维护：**`lifeVideoGate()` 的视频启动冷却仅对 `browse_home`/`use_capability` 视频委派生效，原有已核验非视频候选不受阻断。若同账号 `video-round-ended` 且存在可信已完成视频轮次匿名回执，`AutonomousPlanner` 可在冷却期提议 `review_video_feedback`，仅将模型本地考虑写入 Life 决策日志，不产生新的 Episode 已完成步骤或平台发送；无可信回执继续等待。`lifeExperienceReadiness.videoFeedbackEarliestAt` 不再错误地引用下次视频启动时间。相关内容是离线源码能力，不等于实机验收。

## 图例与术语纠偏

- **蓝色 = 已存在可定位的代码实现**；**黄色 = 有代码但仍有渠道差异／有限接入**；**红色 = 不能宣称具备通用闭环／尚无实机验收**。不存在任何“图里有箭头就已验收”的含义。
- **todos（待办）**：原 OwnerTodoEngine 已接受、到期且类型在 `READ_TODO_TYPES` 中的可读任务。Life 不是自动创建一切主人要求或执行任意写入待办的机器人；模型不能凭一条兴趣线索创建承诺。
- **cues（生活线索）**：`LifeOpportunities.explorationCues()` 现在提供账号可归属的 `interest-milestone`、`discussion-read` 和 `selection-curiosity`（仅当前账号真实已选中 BV、有效时间、主人未排除的短期好奇）。**无聊去刷首页不是存储的 cue**；`browse_home` 是无需 cue 也可选择的独立候选动作。
- **intentions（自主探索意愿）**：同一 `life-opportunities` 账本中模型选择后写入、带有效期和可信 BV/来源的跨轮公开探索意愿；不等于全域持久事务队列或私信发送批准。
- **opportunities（生活契机）**：`deriveDiscussionOpportunities`、跨日兴趣、`public-person-observation` 等带可信来源、可复核的具体机会；不是“只要看到评论就可回复”，也不从陌生私信正文造任意机会。
- **social（社交机会）**：入站 `dm-received` / `comment-received` 是匿名关注信号；另外有已核验双向互动的好友只读考虑候选；主动私信必须有单独的私人交往证据与主人授权。真正对外回复/联系经过独立的原渠道准入、拒联、限额和事务回执。
- **video（视频能力）**：是当前账号启用且过冷却的 `bilibili.video-explore` 等可选能力，**不是已经观看视频**；`homeCandidates` 与 `homePickedCount` 分别是已读候选数和实际入选来源数，不证明画面/音频消费。
- **reflection（反思）**：`LifeReflection.status().canAutoReflect` 提供真实就绪状态，执行前还要重新核对。此维护补丁修复旧解析器接受本轮未提供 `reflect` 的问题。
- **eventRefs（匿名事件引用）**：`life-agent-events` 提供事件类型/ID/重考虑提示，不能被模型当作评论原文、已完成事实或写入授权；真实完成凭原平台回执。

## 从当前源代码核对的关键链路

| 链路 | 当前实际情况 | 审计状态 | 主要文件／后续要求 |
|---|---|---|---|
| 真实来源 → 候选 | 分别读取既有 TODO、兴趣、评论观察、人物证据与账号事件账本，之后做读动作归属协调 | **接线，但不是统一永久候选库** | `lib/life-opportunities.mjs`、`lib/autonomous-action-contract.mjs`、`lib/life-agent-events.mjs` |
| cues → 探索意愿 → 元数据 | 有真实兴趣/同 BV 阅读证据才能从 cue 提出目标，平台结果必须核实 | **已接线，含短期可信选片好奇；来源仍受限** | `lib/autonomous-planner.mjs`、`lib/life-opportunities.mjs`；不能自由把任意话题转换成平台搜索词 |
| opportunities → 公众人物探索 | 仅跨日有证据的交流对象可重核身份及公开投稿；撤销来源会失效 | **已接线，有限范围** | `lib/life-opportunities.mjs`；不包括刚遇到的任意陌生评论者，也不授权跨串回复 |
| 无兴趣 → 首页 → 来源归因 → Episode | `browse_home` 不依赖 cue/event；视频 Agent 真实读取首页候选并按本轮 BV 匹配入选来源，成功轮次将匹配候选接入同一 `life-opportunities` 意愿 Episode | **代码已接线，实机待验** | `lib/autonomous-planner.mjs`、`lib/life-home-feed-evidence.mjs`、`lib/life-agent-events.mjs` |
| 反思候选 → 实际反思 | 状态已共享就绪判断；**旧解析器存在未提供 reflect 也可被接受的旁路** | **本维护补丁加固** | `lib/autonomous-planner.mjs` 新 `validateOfferedLifeAction` 严格对照本轮菜单；反思器仍执行前复核 |
| Life → 写动作 | Life 连续视频写动作借用原视频意愿桥/平台工具；社交发送走原渠道的关系和策略门禁 | **多条受控执行路径，而非单个万能网关** | `lib/life-continuation-write.mjs`、`lib/life-video-action-bridge.mjs`、`index.js`；未形成所有写动作的通用单进程原子事务 |
| 平台结果 → Life 事件 | 验证成功、失败、未知分开记录；脱敏决策轨迹只代表决策与结果分类 | **已有对应账本，不等于全场景 E2E 证据** | `lib/life-agent-events.mjs`、`lib/life-decision-trace.mjs`；真实 B站读回仍未验收 |
| 真正完成 → Life 记忆 | 现有 20 类可信只读/写入动作复用单一名称字典，并在合成成功回执、账号隔离、失败/未知、重复、隐私与 outbox 补偿专项通过；但各平台通路仍需真实逐项核验；原回执仍是细节事实源 | **离线契约覆盖，真实渠道仍需验收** | `lib/life-action-memory.mjs`、`lib/life-memory-coordinator.mjs`；不能宣传“所有 API 调用自动入记忆” |
| 记忆 → 自主回忆 | 实时账号/授权/遗忘/时间过滤 → 词法 + 可选本地 Embedding 排序 → 回原可信记录 | **部分接线，legacy/full 与各入口不完全等价** | `lib/memory-retriever.mjs`、`lib/recall-request.mjs`；向量命中不是事实来源 |
| 反思 → 兴趣/关系/人格 → 下一轮 | 基于已有证据的反思/兴趣等更新存在，但反向影响动作的可测长期因果未完全证明 | **部分接线且长期因果未验收** | `lib/life-reflection.mjs`、`lib/life-interests.mjs`、`lib/life-voice-context.mjs` |

## 这次实际修复（P0）

**发现：**`plannerActionMenu` 已限制反思等动作是否出现，但主 Life 模型回文的兼容解析器 `validatePlannerDecision` 对 `reflect` 无条件放行。在未展示 `reflect` 时，模型若仍输出该动作，可能造成无效选择；对于开发中的其他旧解析目标，也不能把“模型恰好猜对 ID”当作本轮授权。

**修复：**增加 `validateOfferedLifeAction(choice, actionMenu)`，在主 Life 回文完成解析、开始执行前，统一核对动作类型及其 `id` / `bvid` / `capability` 与**当轮实际提供的菜单**严格一致。未提供则返回 `skip / invalid-decision / model-action-not-offered`，不是鱼鱼自愿休息；不调用工具或外发，不制造成功事实。正常 `skip`、有效反思、原有待办/社交/首页/意愿路径不改变。原子账本及多渠道平台授权继续各自执行前核验。

回归详见 `test/v271-dev33-life-menu-hardening.test.mjs`。

## dev.34 · 连续 Life Episode 与原创评论 P0 门禁分类

- **一次探索的生命周期**：复用账号隔离的 `life-opportunities` 意愿账本，不新建第二任务库。首页真实入选、可信搜索、同 BV 评论好奇、公开人物投稿读取均可作为 Episode 第 1 步；后续元数据核验、作者公开投稿读取、受控写入回执继续记录在同一条 intention。
- **最多 5 个已核验步骤**：主决策之后每一步都重新调用 Life 模型选择，最多追加 4 次；鱼鱼可随时休息或结束。每个已核验 BV 持久去重；同一作者的公开投稿读取按当前 BV 记录；写入结果未知时 Episode 冻结等待人工复核，成功写入后结束。
- **首页接线**：只有 Life 自主发起的 `browse_home` 进程正常结束、账号一致、视频轮次回执持久化成功，并且首页候选 BV 与本轮新增入选 BV 精确匹配后，才从匹配 BV 建立 `home-browse` Episode。匹配 BV 只从事件账本瞬时返回宿主，不长期存储；候选只代表真实入选，不代表完整观看；下一步必须重新读取同一 BV 的平台元数据。
- **后续唤醒**：每个完成的 Episode 步骤使用意愿 ID + 步数生成独立匿名 `exploration-ready` 唤醒，避免第一步事件被结算后永久去重后续步骤。自愿休息将当前意愿延后 1 小时，不会立刻再次推送；达到 5 步、主动结束或写入未知均不自动续排。
- **原创评论 P0**：评论 Life 审批遇到可精确识别的 `life-cross-channel-rest`，且仍属于同一账号时，可等待 `notBefore` 后最多重新进行一次 Life 意愿判断；不自动重发平台评论。`life-choice-in-progress`、账号变化、结果未知不会重试。技术阻断单独计数为 `blocked`，不再误记成鱼鱼自愿拒绝。
- **可观测性**：管理中心展示 Episode 来源、进度 `n/5`、已核验 BV 数与最近回执；轮次评论诊断区分主动不评论与技术阻断。

离线专项见 `test/v271-dev34-life-episode.test.mjs`。此版本仍未完成真实 Windows/B站/72h 实机验收，保持 `releaseReady:false`。

## dev.37 · 统一行动归属、实际发送回执与因果关系

这次不改变 Life 自主选择的权威，也不取消专业 Agent 内部的工具选择。新增 `lib/life-action-attribution.mjs`（**仅记录，不执行**），只在原成功回执明确后把 `owner/channel/sourceRef/receiptId/action` 关联到现有匿名 Episode；owner 只允许 `life`／`owner`／`reactive`，渠道为白名单枚举，原 UID/BV/评论/私信/标题只在原事实源中，Episode 继续保存脱敏哈希。

- 私信/评论独立平台回执可使同一 Life 选择下的多条消息各自有可去重步骤；没有精确回执的社交写入不冒充已完成 Episode。原 Life 意愿批准不是第二次实体平台写入。
- 已接受只读待办沿完成时间产生稳定回执； Life Planner 与原待办执行器共用，不双计。真实反思批次生成来源稳定的摘要回执。待办回访的发送结果归到**原待办**，不创建另一个无关社交片段。
- 失败或被挡不算已完成，未知发送只允许冻结已经存在且同源的 Episode，绝不自行补发。
- 单纯拥有 Episode ID 不代表获得原评论回复/陌生人主页或私信权限，仍保留各专业执行门禁。外部平台实际读取/账号切换/72 小时行为因果均待实机验收；独立调度器尚未整合为单一全局调度器。

详见 [dev.37 设计与验收](./2.7.1-dev37-unified-action-ownership.md)。

## 尚未完全实现、后续优化顺序

1. **P1 · 事实入记忆覆盖表**：把已有 20 类合成成功回执矩阵扩展为每个真实渠道的 `source → receipt → verifiedLifeActionEvent → episode → recall` 实机回归矩阵，检查忘记后的撤销与账号切换；不要把 `eventRefs` 或调试记录当作记忆。目前已统一白名单且有离线回执专项，但还不能证明每种真实工具调用均已完成平台读回。
2. **P1 · 人物与评论线程可信目标**：有真实评论楼层 ID、BV、作者 UID、原文等一致证据，才考虑陌生评论者的公开作品与跨串回复；需反骚扰节奏/单独授权，不能由视频作者 UID 代替。
3. **P1 · 真实 UI 与端到端闭环**：Windows/Desktop+B站双账号、首页推荐有效候选→真实入选→视频元数据→合法写入→独立平台核验→可召回经历，验证失败/未知、断网、重启与撤权路径。
4. **P1 · 回忆入口一致性**：将 remaining legacy/full 和专业 Agent 的可访问记忆路径分别登记，验证“相关信息能召回”和“不可见/已忘信息绝不会返回”，本地 639MB GGUF CPU 实跑及失败词法回退。
5. **P2 · 长期生活因果**：持续 ≥72h 对照 Life 决策、首页偶遇兴趣、社交互动、反思与后续真实意愿；明确区分模型被提供的证据、实际使用的证据和后续平台行为。

以上优化是**明确的未完成项**，本次补丁没有擅自扩大评论/关注/私信授权，也没有虚构长期实机验收。

## 以后修改代码时如何保持图与项目同步

1. 编辑本目录 `diagrams/life-system-current.mmd`（总体接线）和 `diagrams/life-candidates-current.mmd`（候选字典）、`diagrams/life-receipt-memory-current.mmd`（行动回执与记忆闭环），按真实源码变更颜色/箭头/文字；PNG 只能作为非规范性展示。
2. 每个主要节点下 `%% @code node | lib/... | 某个实现标记` 是机器检查锚点。代码重命名、移动或删除后，若不同时调整图，会触发测试失败；**此检查不能证明行为正确，只能阻止明显的图／实现漂移**。
3. 先运行 `npm run write:life-architecture-view` 更新 GitHub 预览，再运行 `npm run check:life-architecture` 和 `node --test test/v271-dev33-life-architecture-contract.test.mjs test/v271-dev33-life-menu-hardening.test.mjs`，并执行受影响渠道的完整测试和真实环境验收。`.github/workflows/life-architecture.yml` 在 push / PR 中执行这两个门禁；源图和检查脚本一起由 npm 包 `files` 字段保留。
4. 变更涉及新渠道、授权、事实源或记忆投影时，同步本页审计矩阵、`docs/architecture/README.md`、`AGENTS.md`；本页不替代具体实现文档。

**发布门槛未变化：**实际 Windows Desktop、真实 B站、真实本地 GGUF、账号切换、备份升级、连续 72 小时和跨日成长验收未完成前，`releaseReady:false`；不合并 main、不创建 Tag、不发布。

## 同版本闭环加固：已落地与仍需实机验证

- **真实选片好奇 → cues**：只有当前账号且来源于真实 `autonomous-selection`、明确精确时间和 BV 的短期好奇才能成为 `selection-curiosity`。主人明确排除、账号切换、来源未绑定或过期时不可进入 Life 菜单。下一步仅能核实**同一 BV 的公开元数据**，不能把标题当新搜索词，也不能由此增加任何写权限。之前来源不明的兴趣仍可在管理 UI 查看，不会伪造账号归属。
- **行动种类一致**：`lib/life-action-memory.mjs` 的 `LIFE_ACTION_NAMES` 为 20 类可信经历的单一字典，`LIFE_VERIFIED_WRITE_ACTIONS` 为 14 类平台完成动作；`life-agent-events` 与 `life-memory-gateway` 复用同一集合。已确认事件进原 `life-memory-coordinator` outbox，异常由 outbox 补偿，不再用模型输出或匿名 `eventRefs` 补写记忆。
- **执行成功与记忆结果分开**：视频写入桥在平台确认后等待记忆回调，返回 `memoryQueued`。失败/未知平台结果不会写成功经历；若**平台已经确认成功但记忆未能入队**，仍保持平台事实为成功、明确给出 `memoryQueued:false`，不得因此重复外发。后台原始协调器已接收后但下游尚未落库的状态属于可补偿。只读 Life 行为也等待原 outbox 入队，记忆异常不会触发二次平台读取。
- **审计矩阵与实机真值**：新增 `life-receipt-memory-current.mmd` 及逐动作离线契约。它们证明源代码的匹配、失效、回忆隔离和冻结分支，不代表陌生评论者的任意跨串发言已获得合适的 B站独立回执，也不能证明 Windows / GGUF / 72h 真实验收。

**仍故意保留的边界：**“所有 todos 可任意创建与写入”“不验证对象也可查看陌生人的主页并跨串回复”“一个公共发送器绕过渠道权限”都不是本系统的目标。读写仍复用原专业适配器；模型不能单独赋予自己平台权限。若要让刚遇到的陌生评论者进入社交行动，必须先有精确评论 ID、作者 UID、楼层关系与平台重查、独立反打扰/限额及独立写回核验，目前未开启此高风险新能力。


## dev.33 同版本原创主评论闭环诊断维护（2026-11-08）

本次修复不是强迫鱼鱼发表评论，也没有放宽原自动评论许可。来自真实用户决策 DEBUG 的结论：`browse_home → capability-launched` 只表示启动了视频 Agent；后续 `video-exploration → delegated` 只表示 Life 同意继续探索；这两种事件都**不是模型已经提出原创评论**，更不是平台可见回执。此前选片后没有明确的评论考虑回执，DEBUG 无法区别模型没有进入考虑、想说却没调用工具、Life 拒绝、或平台未知。

- 新的原视频 Agent `bili_comment_consideration(bvid, decision, reason)` 是**只读诊断动作**，只在自主原创评论开关、原额度和当前 Life 桥均准备好时出现在该 Agent 白名单。模型自己对已入选 BV 可报告 `want`（想说）、`pass`（不想说）或 `insufficient`（真实资料不足）；该返回不会产生发送批准，也不把模型自述当平台事实。
- `/life-comment-review` 仍使用原 Life 视频桥 token、当前账号 UID、随机 24 位轮次号，并以真实选片账本二次核验。每一条本轮新入选 BV 最多一条诊断；旧轮、别的账号、无实际入选均拒绝。评论正文、UID、标题、BV **均不写入** Life DEBUG 或匿名轮次账本。
- 原生 `bili_reply` 独立发送路径仍须经 Life 再意愿、原 B站额度、去重与独立平台读回。主 Session 手工评论继续要求主人确认，不混同于视频 Agent。结果未知不重复发送。
- 视频进程结束时新建 `mode=video-round` DEBUG，记录枚举结果及入选、评论考虑、提议、审批、验证聚合数。`model-review-not-observed` 只代表**没有观察到模型提交考虑工具**，不能认定模型明确拒绝；`wanted-but-not-proposed` 指模型自述想说但未观察到发布工具调用；`life-bridge-not-ready` 是技术条件不满足，不是鱼鱼不情愿。
- 没有本机视频 Agent 逐工具日志，就不能追溯升级前那几轮模型实际如何考虑；无法凭选片数重建不存在的评论决策。

详见 `test/v271-dev33-video-comment-consideration.test.mjs`。以上是离线逻辑和诊断接线，Windows / 真实 B站仍需验收。

## dev.35 · Episode 自然连贯与安全互动状态

本轮把 Episode 已核验写操作改成**非终结步骤**；等待 `read-or-rest` → `read-verified` 或真实休息 `resting` 以后，且满最短冷却，才允许下一 Life tick 考虑另一种合法写操作；同一 tick 永不连发两次。可独立读取当前已核实 BV 的 10 条公开评论、最多额外读取一次首页推荐。仅保存已核验动作种类／BV／时间，交给本 Episode 后续自主选择，不将点赞推断为评论意愿。

实现文档：[dev.35 P1/P2](./2.7.1-dev35-life-episode-p1p2.md)；真实 Windows/B站、陌生人跨串社交与跨日人格因果仍需单独验收。

## dev.36 · 统一 Life Episode 核验状态（未发布）

**本版本新增跨活动因果层，不替换原 Life Memory 或机会账本。** 已确认的自主首页视频轮次、继续公开阅读、只读待办、反思、部分已确认的主动社交和原平台核验写入，会在当前账号的 `life-episodes/<accountTag>.json` 中保存匿名来源摘要与完成步骤。所有 BV、UID、评论、标题、模型原因留在原受权事实源中。只读模型历史不再依赖随机抽样；优先考虑同一账号仍开放的原意愿，可以 `resume_episode` 也可以休息。

每个片段最多 5 个核验步骤，达到上限不强迫外发；当将来同一来源又有新的真实行动时，新建关联的下一段。未知发送结果在片段中冻结；暂停后复活必须重新检查当前账号、原机会、原额度。`resume_episode` 既不是直接网络调用，也不是新评论许可。全部模型调用共用原 Life 日额度与原 Agent 单轮规则。

**验收证据**：`test/v271-dev36-universal-life-episodes.test.mjs` 包含从首页真实回执开始、下一轮主动 `resume_episode`、连续三个有平台读取回执的探索步骤和自愿休息的端到端离线模拟；还验证账号隔离、重复回执、暂停/未知、五步分段、无需有效意愿时不自动唤醒。

**仍未完整覆盖的微观动作**：独立视频 Agent 内部每一次未发送的微小浏览/模型想法、尚未从原渠道产生可核验回执的陌生人互动，不应该伪造成已完成 Episode 步骤。并非所有后台 AI 模型调用都可自动变成真实生活经历。此项与真实 Windows/B站/72h 仍待实机确认。

### dev.36 同版本维护：Life Episode 首步不限首页

首页只是一个有真实回执的可能首步，已接受只读待办、反思、公开观察与社交活动都可以独立产生 Episode。`life-episode-entrypoints.mjs` 现在把有效非视频 TODO／公开契机加入原意愿之外的可续行来源，用于**重新考虑**而非自动执行；视频专属 `resume_episode` 与非视频常规菜单动作依旧分别由原权限、来源和执行器核验。生成图见 `diagrams/life-universal-episodes-current.mmd`。

## dev.37 同版本维护：Episode 可恢复与主评论只读考虑

- **入口 → 统一层 → 事实源**：`AutonomousPlanner` 的原 `lifeOpportunities.continuations()` 输出是本轮候选的唯一可信来源；`prioritizeLifeContinuationCandidates()` 仅按该来源中已经存在的匿名 Episode 排序，不从 Episode 创造可执行 ID。`UniversalLifeEpisodes.due()` 现在把已过 `nextAt` 的 `paused` 和 `active` 一样纳入可考虑范围，但仍要求原意愿有效、已核验动作、同一账号和模型额度。`review` 状态绝不进入。
- **评论选片与回执**：原 `bili_ledger_mark` 可选同次携带三个有限 `comment_decision` 值；必须先成功写入新入选行，才会向原 `/life-comment-review` 发送不含文本的当前轮只读意愿回执。旧视频、跳过、别的账号、额度关闭、模型没有明确提供意愿，均不能由工具伪装成成功考虑。直接 `bili_comment_consideration` 保留兼容，但模型应在真实标记之后调用；失败理由只返回四个安全枚举。
- **权限边界**：read-only consideration 不调用 `/life-action`、不签发写入 grant，不构成内容阅读或实际发言证明；`bili_reply` 继续受独立 Life 选择、账号、平台额度、单轮写入及真实读回控制。未知结果冻结，不自动尝试第二次发送。
- **可观测性**：匿名 S0/S1 快照增加 `pausedCooling`、`pausedWithoutEligibleSource`、`pausedDueWithSource`，区分自愿休息未到时、原意愿消失、已到时可自愿续行；此前导出的快照不能追溯补造当轮评论意愿。
- **回归**：`test/v271-dev37-episode-comment-recovery.test.mjs`、`test/test_dev37_episode_comment_review.py`，另需既有 Episode、视频写入、发布审核全量回归。真实 Windows/B站及 72 小时未验收。


## dev.53 · 当前回忆投影、Life 调度和主评论诊断（未发布）

`LifeMemoryGateway → MemoryRetriever（原当前允许集合）→ 可选 EmbeddingMemoryIndex → memoryNeuralProjection → 神经管理 UI`；仅在该管理 UI 使用真正查询向量 cosine 与匿名节点 ID 映射，不影响聊天主 Session 的实际检索时序。`AutonomousPlanner.status → systemHealthSnapshot → 健康横幅/额度卡片`；不新增 Life 定时器。`LifeVideoActionBridge → VideoCommentReadiness` 将 Life 延期/拒绝/技术异常作为不同证据；平台验证/授权不变。当前关联图：`diagrams/life-receipt-memory-current.mmd`。完整边界和回归参见 [dev.53 实现说明](./2.7.1-dev53-semantic-recall-comment-health.md)。真实环境未验收，`releaseReady:false`。


## dev.54 调度恢复与行动日记

Life 自动调度仍由唯一 `AutonomousPlanner` 管理；状态轮询和手动唤醒可在定时器消失后恢复原检查，不新增定时器或发送许可。主人时间线的 BV/UID 只来自同账号已核验记录。神经回忆结果筛选和梗证据门槛不建立第二事实账本。详见 [dev.54](2.7.1-dev54-life-recovery-and-owner-ui.md)。

## dev.55 视频选片额度修复

每轮视频 Agent 的真正启动条件仍为账号、总开关、Life 自主规划、视频启动间隔、模型/平台预算，不再因今日已入选 50 条或关闭日报后已经跑过一轮而拒绝探索。`lib/video-pick-policy.mjs` 在运行时兼容旧 `$DSH_HOME/bili-duty/duty.md` 章程，移除已失效的每日挑中配额句，并在视频提示末尾显式覆盖残留的旧数字规则；用户磁盘上的自定义章程不被改写。`countPickedToday`、判重表、`### BV` 标题仍只作为可信入选统计；旧“额度满只看标题”的 skip 行允许重新真实阅读，但不能伪造已看、已发布事实。所有外发授权、额度、防重、Life 意愿和平台核验不变。详见 [dev.55](2.7.1-dev55-daily-pick-quota-retirement.md)。
