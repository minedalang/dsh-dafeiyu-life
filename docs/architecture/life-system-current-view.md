# 大肥鱼 Life 源码全景（自动生成）

> 不要直接编辑此页；修改 `diagrams/life-system-current.mmd` / `diagrams/life-candidates-current.mmd` / `diagrams/life-receipt-memory-current.mmd` / `diagrams/life-universal-episodes-current.mmd` 后运行 `npm run write:life-architecture-view`。架构状态及未实现部分见 [源码审计](./life-system-current.md)。

## 一、系统全景

```mermaid
%% 大肥鱼 Life 当前源码全景（2.7.1-dev.37 · Universal Life Episode）
%% S = 有生产代码接线（非 Windows / B站实机验收）；P = 部分接线；G = 尚无完整闭环
%% 数据行只读与外发分路；不允许把权限/记忆/回执画成万能单系统。
flowchart TB
  subgraph reality["真实输入｜只接受可信事实，不接受外部提示当命令"]
    world["B站首页／公开视频／公开评论／主页"]
    socialInput["主人消息／私信／公开社交"]
    tasksInput["已接受待办／既有意愿／历史回执"]
  end
  subgraph sources["原有事实与上下文层｜依账号和来源独立核验"]
    adapter["B站受控适配器＋视频轮次来源回执"]
    socialFacts["原 DM／评论／关系来源账本"]
    canonical["原待办／生活意愿／平台事务账本"]
    eventLedger["Life 匿名唤醒事件｜eventRefs 不是事实正文"]
  end
  world --> adapter
  socialInput --> socialFacts
  tasksInput --> canonical
  adapter --> eventLedger
  socialFacts --> eventLedger
  canonical --> eventLedger

  subgraph options["Life 本轮候选｜来源不同、生命周期不同，不能互相替代"]
    todos["todos｜已接受待办中可执行的只读类型"]
    cues["cues｜跨日兴趣／真实评论阅读／本账号已选片的开放式好奇"]
    intentions["intentions｜经核验的跨轮公开探索意愿"]
    opportunities["opportunities｜明确 BV 或公开人物证据的具体机会"]
    friends["friends/social｜已证实的好友机会与匿名入站社交唤醒"]
    video["video｜原视频能力及无兴趣也可选 browse_home"]
    reflection["reflection｜执行器真实就绪状态 canAutoReflect"]
    events["eventRefs｜匿名提示 / 公平重考虑，非操作授权"]
  end
  canonical --> todos
  canonical --> intentions
  adapter --> cues
  adapter --> opportunities
  socialFacts --> friends
  eventLedger --> events
  adapter --> video
  canonical --> reflection
  events -.->|仅提示重新查原来源| todos
  events -.->|仅提示重新查原来源| opportunities
  cues --> selection
  intentions --> selection
  opportunities --> selection
  todos --> selection
  friends --> selection
  video --> selection
  reflection --> selection
  events -.-> selection

  subgraph decision["唯一 Life 自主决策中心｜不给模型任意 UID / BV / 写权限"]
    selection["候选筛选 + 去重归属 + 账号/冷却/额度检查"]
    planner["AutonomousPlanner + Life Voice + 当轮动作菜单"]
    universalEpisode["Universal Episode｜账号匿名因果片段：有真实回执才计入已完成动作"]
    resumeEpisode["resume_episode｜鱼鱼自主选择复续；来源与权限每步重新核验"]
    menuGuard["后端再次核对：action/id/BV/capability 必须确在本轮菜单"]
    rest["skip：鱼鱼自由休息；技术失败不得伪装休息"]
  end
  selection --> planner --> menuGuard
  universalEpisode -.->|只提供历史/关联，不授予权限| planner
  menuGuard --> resumeEpisode -.-> lifeEpisode
  menuGuard --> rest

  subgraph readlane["受控读取｜真实读取不等于完整观看"]
    readTodo["原只读待办"]
    explore["公开搜索/视频元数据/作者作品/已证实人物"]
    home["browse_home → 原视频 Agent → 首页候选/选片归因"]
    lifeEpisode["Life Episode · 账号绑定意愿账本 · 最多 5 个已核验步骤"]
    homeCandidateMatch["首页候选 BV 与本轮新入选 BV 精确匹配；原始 BV 只瞬时返回宿主"]
    homeEpisode["仅成功的 Life 首页轮次回执后建立 home-browse intention"]
    episodeContinuation["每步重新交给 Life 选择 · 最多追加 4 次 · 可随时休息"]
    episodeDiscussion["独立只读当前已核实 BV 的公开评论区；不强迫回复"]
    episodeHomeMore["可自愿额外获取一次首页推荐；候选未必入选"]
    episodeAftercare["已核验写入计一步 · 下一写前必须真只读或实际休息；每 tick 最多一写"]
  end
  menuGuard --> readTodo
  menuGuard --> explore
  menuGuard --> home
  readTodo --> receipts
  explore --> receipts
  home --> receipts
  home --> homeCandidateMatch -->|仅本轮精确匹配入选 BV；不等于观看| homeEpisode
  homeEpisode --> lifeEpisode
  explore -.->|搜索/人物作品/视频核验成功后进入同一意愿账本| lifeEpisode
  lifeEpisode --> episodeDiscussion --> episodeContinuation
  lifeEpisode --> episodeHomeMore --> episodeContinuation
  lifeEpisode --> episodeAftercare -.->|只读／休息后再次选择，非自动外发| episodeContinuation
  lifeEpisode --> episodeContinuation -.->|下一步重新选择；到上限/休息/结束时停止| selection

  %% @code commentReview | vendor/bilibili-mcp/mcp_server.py | async def bili_comment_consideration
  %% @code commentDiagnosis | lib/video-comment-readiness.mjs | classifyVideoCommentRound
%% @code commentAdmission | lib/life-video-action-bridge.mjs | const waitMs=choice.notBefore-now()
  %% @code commentAdmission | lib/life-video-action-bridge.mjs | const waitMs=choice.notBefore-now()
  subgraph outgoing["写入委派｜不存在一把可绕开各渠道限制的万能发送钥匙"]
    videoWrite["视频续行提议 → Life 意愿与原视频写入桥 → Python 工具"]
    commentReview["已选真实 BV → 模型明确考虑主评论：想说／不想说／证据不足；仅匿名诊断"]
    commentDiagnosis["轮次结束时枚举诊断：没考虑／想说未提议／自愿否决／技术阻断／回执未知"]
    commentAdmission["已知跨渠道冷却：到 notBefore 后最多重考虑一次；在途/未知不重试"]
    socialWrite["私信/评论/分享 → 关系与渠道授权 → 原社交发送事务"]
  end
  menuGuard -.->|仅合规候选/委派；不直接写平台| videoWrite
  home -.->|已选片后可自主考虑；不强制发言| commentReview
  commentReview -.->|有真实表达意愿才考虑原发送门禁| commentAdmission
  commentAdmission -.-> videoWrite
  commentReview -.-> commentDiagnosis
  videoWrite -.-> commentDiagnosis
  menuGuard -.->|仅好友/社交许可；不直接发送| socialWrite
  videoWrite --> receipts
  socialWrite --> receipts

  subgraph journal["结果核验｜不把失败/未知记成成功"]
    receipts["原工具回执/平台独立核实 + unknown 冻结"]
    decisions["Life 脱敏决策轨迹/匿名事件结算（非事实源）"]
    verifiedActions["成功且身份匹配的实际行动投影"]
  end
  menuGuard --> decisions
  receipts --> decisions
  receipts -->|仅经验证成功| verifiedActions

  subgraph memory["统一回忆与成长｜精确事实仍回原受权账本核实"]
    gateway["Life Memory / 协调器：可衰减情节、隐私和遗忘"]
    retriever["Recall：时间/意图/账户权限硬过滤 → 词法/可选本地向量排序"]
    growth["兴趣、情绪、关系与反思：影响下一轮候选，不授予权限"]
  end
  verifiedActions --> gateway
  verifiedActions --> universalEpisode
  lifeEpisode --> universalEpisode
  gateway --> retriever
  gateway --> growth
  retriever -.->|仅当前可召回证据| planner
  growth -.->|仅已核实新线索| cues
  growth -.->|仅已有来源的新机会| opportunities
  decisions -.->|提示下一轮，不证明写入成功| eventLedger

  subgraph gaps["当前仍未形成完整生产闭环 / 实机验收"]
    gapSocial["跨串陌生人回复/任意评论者主页：未通用开放"]
    gapRecall["所有历史/legacy full Agent 统一按需回忆：尚不完整"]
    gapGrowth["长期兴趣/人格因果、真实 Windows/平台/本地 GGUF/72h：未验收"]
  end
  gapSocial ~~~ gapRecall ~~~ gapGrowth
  classDef active fill:#e8f3ff,stroke:#3579c9,color:#17385f
  classDef partial fill:#fff7e4,stroke:#d99727,color:#6b4717
  classDef gap fill:#fff0f1,stroke:#d26975,color:#822f39
  class planner,menuGuard,selection,readTodo,explore,home,lifeEpisode,homeEpisode,homeCandidateMatch,episodeContinuation,episodeDiscussion,episodeHomeMore,episodeAftercare,verifiedActions,receipts,eventLedger active
  class friends,socialWrite,videoWrite,gateway,retriever,growth partial
  class gapSocial,gapRecall,gapGrowth gap

%% @code adapter | lib/life-home-feed-evidence.mjs | export function summarizeHomeFeedResult
%% @code eventLedger | lib/life-agent-events.mjs | export function createLifeAgentEvents
%% @code todos | lib/owner-todos.mjs | export const READ_TODO_TYPES
%% @code cues | lib/life-opportunities.mjs | const explorationCues=
%% @code intentions | lib/life-opportunities.mjs | const intentions=
%% @code opportunities | lib/life-opportunities.mjs | export function createLifeOpportunities
%% @code friends | lib/life-friend-initiatives.mjs | export function createLifeFriendInitiatives
%% @code video | lib/autonomous-planner.mjs | if(homeEnabled&&lifeSkills.some
%% @code reflection | lib/life-reflection.mjs | export function createLifeReflection
%% @code events | lib/life-agent-events.mjs | const TYPES=new Set
%% @code selection | lib/autonomous-planner.mjs | reconcileAutonomousActions
%% @code planner | lib/autonomous-planner.mjs | export function plannerActionMenu
%% @code menuGuard | lib/autonomous-planner.mjs | export function validateOfferedLifeAction
%% @code home | lib/life-agent-events.mjs | homePickedCount
%% @code lifeEpisode | lib/life-opportunities.mjs | const beginHomeExploration=
%% @code episodeContinuation | lib/autonomous-planner.mjs | const continueLifeRead=async intentionId=>
%% @code homeEpisode | index.js | const episode=lifeOpportunities.beginHomeExploration
%% @code homeCandidateMatch | lib/life-agent-events.mjs | let transientHomePickedBvids=null
%% @code videoWrite | lib/life-continuation-write.mjs | export function createLifeContinuationWriteExecutor
%% @code socialWrite | index.js | runFriendInitiative:
%% @code receipts | lib/life-video-action-bridge.mjs | export function createLifeVideoActionBridge
%% @code decisions | lib/life-decision-trace.mjs | export function createLifeDecisionTrace
%% @code verifiedActions | lib/life-action-memory.mjs | export function verifiedLifeActionEvent
%% @code gateway | lib/life-memory-coordinator.mjs | export function createLifeMemoryCoordinator
%% @code retriever | lib/memory-retriever.mjs | export function createMemoryRetriever
%% @code growth | lib/life-interests.mjs | export function recordInterestEvents

%% @code episodeDiscussion | lib/life-opportunities.mjs | const inspectVideoDiscussion=
%% @code episodeHomeMore | lib/life-opportunities.mjs | const browseHomeMore=
%% @code episodeAftercare | lib/life-opportunities.mjs | entry.writeAftercare='read-or-rest'

%% @code universalEpisode | lib/life-universal-episodes.mjs | export function createUniversalLifeEpisodes
%% @code resumeEpisode | lib/autonomous-planner.mjs | action:'resume_episode'
```

## 二、八类候选细目

```mermaid
%% 生活候选细目字典：这是当前项目的真实 schema 类型/选择约束，不是泛化的 AI 心理推演。
flowchart LR
  subgraph inputs["有事实来源，才能构成候选"]
    sourceTodo["原 accepted TODO：open/deferred 且到期"]
    sourceInterest["LifeInterests：账号绑定、跨日自主选片兴趣及有时效的开放式好奇"]
    sourceDiscussion["已有 BV 评论阅读 + 可核验主观疑问"]
    sourcePerson["SocialPortrait：跨日公开双向交流证据"]
    sourceLife["LifeOpportunities 意愿账本：ready/inspected、未过期"]
    episodeState["Universal Episode｜已核验步骤上下文；不可代替原目标凭据"]
    sourceSocial["匿名 dm-received/comment-received 事件"]
    sourceVideo["video-explore 可用 + 首页来源开关 + 启动冷却"]
    sourceReflect["LifeReflection.status().canAutoReflect"]
  end
  subgraph candidates["本轮实际类型 / 内容边界"]
    todos["todos：只读已接受任务（执行前复核）"]
    cues["cues：interest-milestone / discussion-read / selection-curiosity"]
    opportunities["opportunities：兴趣/评论/短期好奇的同 BV 核实；或 public-person-observation"]
    intentions["intentions：已有 BV / 作者/公开评论只读及一次额外首页；14 天有效窗"]
    resume["resume_episode：仅重新选择原账号仍可执行的公开探索意愿"]
    social["social：入站关注信号 + 已核验熟人机会；非回复许可"]
    video["video：browse_home／use_capability；不是已观看数"]
    reflection["reflection：真实可执行反思；不是 pending 大于阈值"]
    eventRefs["eventRefs：匿名事件引用 + 公平重考虑；不代表成功回执"]
  end
  sourceTodo --> todos
  sourceInterest --> cues
  sourceDiscussion --> cues
  sourceInterest --> opportunities
  sourceDiscussion --> opportunities
  sourcePerson --> opportunities
  sourceLife --> intentions
  episodeState -.->|持续性与优先考虑，并非新权限| resume
  intentions --> resume
  sourceSocial --> social
  sourceVideo --> video
  sourceReflect --> reflection
  sourceSocial --> eventRefs
  sourceVideo -.->|本轮读取证据，可唤醒但不授予权限| eventRefs
  sourceLife -.->|重考虑/过期后需重新查原账本| eventRefs
  subgraph choice["Life 一次模型选择 + 后端当轮菜单验证"]
    planner["AutonomousPlanner → validateOfferedLifeAction"]
  end
  todos --> planner
  cues --> planner
  opportunities --> planner
  intentions --> planner
  resume --> planner
  social --> planner
  video --> planner
  reflection --> planner
  eventRefs -.-> planner
  rest["skip：自愿休息；不能与技术失败混为一谈"]
  planner --> rest
  classDef partial fill:#fff7e4,stroke:#d99727,color:#6b4717
  class social,eventRefs partial

%% @code todos | lib/owner-todos.mjs | export const READ_TODO_TYPES
%% @code cues | lib/life-opportunities.mjs | const explorationCues=
%% @code opportunities | lib/life-opportunities.mjs | export function deriveDiscussionOpportunities
%% @code intentions | lib/life-opportunities.mjs | const intentions=
%% @code social | lib/life-agent-events.mjs | const TYPES=new Set
%% @code video | lib/autonomous-planner.mjs | if(homeEnabled&&lifeSkills.some
%% @code reflection | lib/life-reflection.mjs | canAutoReflect
%% @code eventRefs | lib/life-agent-events.mjs | export const lifeEventDebugRef
%% @code planner | lib/autonomous-planner.mjs | export function validateOfferedLifeAction

%% dev.33 maintenance: selection-curiosity from account-tagged verified selected BV only;
%% no free-form title search, no automatic outbound approval.

%% dev.35: Episode 的写入不是默认终点；需实际只读或主动休息 + 冷却后才能再写，仍无新权限。

%% @code episodeState | lib/life-universal-episodes.mjs | const view=e=>
%% @code resume | lib/autonomous-planner.mjs | action:'resume_episode'
```

## 三、可信回执与记忆闭环

```mermaid
%% 同版本 Life 补链维护：模型/菜单不是平台成功证据
%% @code source | lib/life-video-action-bridge.mjs | createLifeVideoActionBridge
%% @code commentReview | vendor/bilibili-mcp/mcp_server.py | async def bili_comment_consideration
%% @code commentOutcome | lib/video-comment-readiness.mjs | classifyVideoCommentRound
%% @code catalog | lib/life-action-memory.mjs | LIFE_ACTION_NAMES
%% @code verified | lib/life-action-memory.mjs | export function verifiedLifeActionEvent
%% @code wake | lib/life-agent-events.mjs | VERIFIED_COMPLETION_KINDS
%% @code outbox | lib/life-memory-coordinator.mjs | createLifeMemoryCoordinator
%% @code episode | lib/life-memory-gateway.mjs | function asEpisode
%% @code recall | lib/life-memory-gateway.mjs | function recall
%% @code growth | lib/life-interests.mjs | recordInterestEvents
%% @code curiosity | lib/life-interests.mjs | scopedCuriosityOpportunityEvidence
%% @code planner | lib/autonomous-planner.mjs | export function plannerActionMenu
%% @code bridge | index.js | const rememberVerifiedLifeAction
%% @code unknown | lib/life-continuation-write.mjs | status:'uncertain'
flowchart TB
  source["真实平台操作｜原视频/评论/DM 事务"]
  universalCausal["匿名因果 Episode｜账号隔离、分段延续、暂停与未知冻结；不是第二记忆库"]
  postWrite["同 Episode 的已核验写入：只计一步，下一写前只读或休息且每轮一写"]
  commentReview["视频入选后主动考虑主评论：想说／不想说／证据不足；不等于发送"]
  commentOutcome["结束后的独立 DEBUG｜未考虑／未提议／Life 否决／平台未知"]
  receipt{"原渠道可信结果?"}
  verified["行动事件仅接受 verified=true 与当前账号"]
  unknown["冻结/失败｜不得写成成功，不自动重试"]
  catalog["19 类 Life 行动统一字典｜含 13 类写操作"]
  wake["匿名 Life 事件引用｜仅提醒下轮考虑"]
  bridge["原进程回调 await 接收记忆入队｜不发送第二次"]
  outbox["原 Life Memory 协调器持久化补偿队列"]
  episode["可衰减情节｜有账号/私密/删除边界"]
  pending["可补偿；诊断不伪装已写入"]
  recall["实时账号/权限/遗忘过滤，再词法/向量检索"]
  growth["真实已选片证据可形成兴趣候选"]
  curiosity["当前账号、有真实 BV、未过期、未排除的开放式好奇"]
  planner["Life 自主决定是否核实同一 BV，或不做"]
  commentReview -.->|自愿提出评论，仍需原外发门禁| source
  commentReview -.-> commentOutcome
  source --> receipt
  verified -.-> postWrite -.->|安全限制，不是写授权| planner
  receipt -.-> commentOutcome
  receipt -->|独立确认成功| verified
  receipt -->|失败或未知| unknown
  verified --> catalog
  verified --> universalCausal
  verified --> wake
  catalog --> bridge
  bridge --> outbox
  outbox --> episode
  outbox -->|已排队但投影暂失败| pending
  episode --> recall
  universalCausal -.->|仅提供可信行为上下文| planner
  episode --> growth
  growth --> curiosity
  curiosity --> planner
  planner --> source
  classDef green fill:#e6f8ed,stroke:#2a9961,color:#16452d
  classDef yellow fill:#fff4de,stroke:#c48a20,color:#65440d
  classDef red fill:#fff0f0,stroke:#c66565,color:#762b2b
  class verified,catalog,wake,bridge,outbox,episode,recall,curiosity,planner,postWrite green
  class pending yellow
  class unknown red

%% @code postWrite | lib/life-opportunities.mjs | entry.writeAftercare='read-or-rest'

%% @code universalCausal | lib/life-universal-episodes.mjs | export function createUniversalLifeEpisodes
```

## 四、统一 Life Episode 因果持续性

```mermaid
%% dev.37 统一归属 + dev.36 Universal Episode：有意义的自主动作共享因果归属，不改变原平台授权
flowchart TB
  child["可选首步：真实 B站首页轮次完成 + 本轮新挑中 BV 精确匹配"]
  firstOther["其他可选首步：已核验的待办、反思、公开机会、社交、非首页视频探索"]
  eligible["当前可续行来源：原视频意愿／未完成已接受只读待办／尚有效的公开机会"]
  canonical["原有 LifeOpportunities 跨轮公开探索意愿｜唯一 BV 事实源"]
  attribution["LifeActionAttribution｜主人请求 / Life 自选 / 被动社交；只接原回执"]
  socialReceipt["社交 / 私信 / 评论多条平台回执：精确去重，不把一次意愿当成功"]
  todoReceipt["已完成只读待办 + 原任务回访：同一因果片段"]
  reflectionReceipt["反思批次真实处理回执：零条长期认识也算真实反思"]
  record["createUniversalLifeEpisodes｜只保存当前账号匿名摘要/因果步骤 + 允许的归属枚举"]
  context["当前片段最多五个已核验步骤；历史可跨段关联"]
  due["有原账号可执行目标且至少两分钟后才优先唤醒"]
  menu["鱼鱼仍可选择合法原动作/休息；视频意愿可选 resume_episode；不增加新权限"]
  read["查看视频元数据／评论区／作者作品／一次额外首页｜真实只读回执"]
  write["原 Life 意愿审批 → 原专业平台发送 → 独立核验｜不强制主评论"]
  pause["自愿休息、预算不足、授权变化或未知结果：暂停/冻结"]
  other["其他已核验 Life 待办/反思/社交/人物行动也有关联 Episode"]
  memory["原 Life Memory 与各渠道真实回执仍为事实权威"]
  child --> canonical --> attribution --> record
  socialReceipt --> attribution
  todoReceipt --> attribution
  reflectionReceipt --> attribution
  firstOther -->|已有真实回执；无需经过首页| record
  record --> context --> eligible --> due --> menu
  menu -->|自主继续| read -->|成功并核验| record
  menu -->|自行考虑互动，单轮最多一次写| write -->|成功且平台核验| record
  menu -->|放下或暂不继续| pause
  write -->|结果未知| pause
  other --> record
  record -.->|因果索引，不可冒充事实| memory
  pause -.->|之后仍需原目标有效、权限通过| menu
  classDef safe fill:#e8f4fd,stroke:#4689b6,color:#173d5c
  classDef caveat fill:#fff1e7,stroke:#d68a3c,color:#74421c
  class record,context,menu,due,attribution,socialReceipt,todoReceipt,reflectionReceipt safe
  class pause,write caveat

%% @code child | index.js | const episode=lifeOpportunities.beginHomeExploration
%% @code canonical | lib/life-opportunities.mjs | const continuations=
%% @code firstOther | lib/autonomous-planner.mjs | const good=new Map([
%% @code eligible | lib/life-episode-entrypoints.mjs | export function eligibleLifeEpisodeSources
%% @code record | lib/life-universal-episodes.mjs | export function createUniversalLifeEpisodes
%% @code context | lib/life-universal-episodes.mjs | const view=e=>
%% @code due | lib/life-universal-episodes.mjs | const due=(
%% @code menu | lib/autonomous-planner.mjs | action:'resume_episode'
%% @code read | lib/autonomous-planner.mjs | const continueLifeRead=async
%% @code write | lib/life-video-action-bridge.mjs | createLifeVideoActionBridge
%% @code pause | lib/life-universal-episodes.mjs | const pauseLatest=(
%% @code other | index.js | onEpisodeAction:proof=>universalLifeEpisodes.record(proof)
%% @code memory | lib/life-memory-coordinator.mjs | createLifeMemoryCoordinator

%% @code attribution | lib/life-action-attribution.mjs | export function createLifeActionAttribution
%% @code socialReceipt | lib/life-willingness.mjs | const exact=typeof receiptId
%% @code todoReceipt | index.js | sourceRef:'todo:'+original.id
%% @code reflectionReceipt | lib/life-reflection.mjs | result.receiptId=receiptId
```
