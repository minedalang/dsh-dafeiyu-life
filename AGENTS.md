# 大肥鱼 · DSH 生活系统：AI 开发约定

> 本文件只规定**当前长期有效**的开发边界和交付流程，不记录各版补丁历史。现行架构从 [`docs/architecture/README.md`](docs/architecture/README.md) 开始；历史决策通过 Git 与 [`docs/archive/README.md`](docs/archive/README.md) 查找。

## 项目与代码入口

- 包名与宿主插件名：`dsh-dafeiyu-life`；当前开发版本 `2.7.1-dev.4`（Phase 6 统一设置显式保存、Phase 7a 匿名成长参考已接线；社交旧决策独占，Phase 6/7 未完整验收），稳定版基线 `2.7.0`（npm 实际发布状态仍须由维护者验证）；未经用户明确授权不得合并 `main`、创建 Tag 或发布。后续开发应重新从 `X.Y.Z-dev.N` 开始。
- `index.js`：宿主配置、工具与 HTTP 业务入口；`client.js` 和 `lib/management-console.*`：界面；`lib/`：业务与共享层；`prompts/duty.md`：用户可修改的章程；`vendor/bilibili-mcp/`：内置 Python MCP。
- 运行数据保存在 `$DSH_HOME/bili-duty/`，不能写回插件包。不得自动覆盖用户修改的章程、配置、模型或权限。
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
- P6-A/B 共用 `SocialConversationContinuity` 的账号、UID、渠道与线程隔离意图；`SocialInteractionRhythm` 统一约束三类后台自动发送（跨渠道冷却、滚动24小时每 UID 次数），配置项详见 `docs/architecture/2.7.0-dev2-public-p6-rhythm.md`，不另造私信和评论定时器；每条真实发送仍经原有 SocialPolicyGate、限额、退订、真实回执。
- [2.7.0 统一自主社交架构设计](docs/architecture/2.7.0-unified-social-agency-plan.md) 明确区分已实现接口和未来生产接线；`SocialPortraitGateway` 在经核验的白名单好友私信/公开评论入口保存可撤回的明确交流证据，按账号/UID/私密域隔离、180天衰减；它不是熟悉度、发送权限或第二人格。`LifeInterests` 保留原有可信观看兴趣证据，新增不改变长期兴趣的短期陌生主题好奇候选；兴趣缺席不等于不感兴趣。现行图见 `docs/architecture/2.7.0-dev3-portrait-open-curiosity.md`。
- `dev.4` 在同一 `SocialPortraitGateway` 中增加明确的先询问/防剧透/不主动追问证据；仅对 P6 延迟预约和到期唤醒施加可撤回的否决，不替代普通回复或外发权限。`LifeInterests` 的 `curiosityDismissed` 是主人可恢复的 30 天主题排除，不是长期不喜欢或第二份兴趣档案；现行接线见 `docs/architecture/2.7.0-dev4-portrait-curiosity-review.md`。
- `dev.5` 在原关系索引提供分阶段的可信互动元数据，`SocialPortraitGateway` 继续是唯一的枚举化交流证据源；自然联系人从已核实的 `known` 阶段开始有限画像，白名单维持旧证据兼容。`social-person-identity.mjs` 仅提供平台隔离身份键（当前 B站生产接线），不得通过同 UID/昵称自动匹配其他平台。人物详情从「逐渐熟悉的人」懒加载；原社交权限页不再维护第二份画像控件。现行图见 `docs/architecture/2.7.0-dev5-person-portrait-multiplatform.md`。画像阶段、熟悉度永远不授予外发权限。
- `dev.6` 在原 B站动作账本中记录真正入选视频的创作者相遇线索，并为主 Session 提供单 BV 的只读关注当前态／历史回执查询；`VerifiedLifeFacts` 按当前登录账号校验并分离历史动作与实时状态。默认关闭的自主关注授权不变，绝不把旧「值得看/不值得看」主人推荐标签当作新关注契机。人格成长进度条与 B站关系互动计数只改准确说明，不制造经历或跨身份关系。旧视频推荐功能的重构或删除**延后**，现行接线见 `docs/architecture/2.7.0-dev6-creator-facts-and-growth-diagnostics.md`。
- `dev.7` 私信 P6-B 增加“模型明确选定开放话题，回复后对方沉默时重新考虑”的一次性可选意图，使用原 `SocialAutonomyDecisionContract`、`SocialConversationContinuity` 和原私信发送门禁；只在已授权的入站私信线程发生，不提供无关话题的定时主动找人。到期读私信暂时失败时，只能在未尝试平台发送的前提下有限延期，未知发送不自动重试。管理页只显示不含聊天内容或对方 UID 的聚合预约状态。实际接线见 `docs/architecture/2.7.0-dev7-dm-silence-reconsideration.md`。
- 不能把允许回应入站 @ 理解成可主动 @ 他人；关闭暗号审核不会授予陌生人自动私信权限，陌生人外发仍须主人明确开启 `dmStrangerAutonomyEnabled`（独立、默认关闭的新授权）；旧版 `dmStrangerOnce` 只保留原有有限次数、单条即时回复权限，绝不能在升级时隐式扩为多条气泡或延迟续聊。

- `dev.10` 行为审计修复：`dm-autoreply` 原已核验私信收件状态按登录账号+UID保存明确停止/恢复私信的消极同意事实，发送前硬门禁优先于熟悉度、P6 与白名单；恢复只撤销停联，不扩大授权。`InteractionBatcher`、公开评论私密询问与主人邀请评论继续使用**唯一 Life Voice 模型**自主决定措辞或沉默，程序不追加审核彩蛋与隐私固定拒绝；隐私问询必须去除私人上下文并核查拟发文字。已关闭会话不得进入 P6 续聊预约。`LifeInterests` 只采可信自主选看证据，`watched.mjs` 单独保留旧推荐 picked 字段而标记实际自主选看来源，不把旧「值得看」视为喜好。生产图及风险矩阵见 `docs/architecture/2.7.0-dev10-life-behavior-hardening.md`。自然语言承诺/停联识别并非全语义穷举，Windows/真实模型/B站仍需验收。
- `dev.9` 发布门禁审计修正：`SocialTodoReplyContract` 对明确数量的入账声称、同条消息内先否定后肯定的承诺及“全部记下”与已核实多个 BV 不一致的情况，在发送前校验真实待办条数；失败仍只交同一模型自主修订，绝不拼接固定回复。与 `dev.8` 共用原账本和原发送门禁，架构接线未变，未完成 Windows／B站验收前不发布正式版。
- `dev.8` 对已核实的陌生人/好友推荐复用原 `SocialAutonomyDecisionContract` 与 `owner-todos` 唯一账本；模型同一轮自主输出回复/结构化只读候选，可信验证成功才允许声称入账。回执不一致最多追加一次同一 Life Voice 模型修订，禁止程序生成固定对外回复；纠错再次失败则不外发。仅记录不含正文/UID/原始 JSON 的限量决策诊断。见 `docs/architecture/2.7.0-dev8-social-todo-commitment.md`。

## 2.7.1-dev.1 真实视频评论区观察边界

- 自主视频轮开放原只读 `bili_comments` 与 `bili_comment_thread`；不得因为浏览评论自动发言、创建待办或认识评论者。视频轮的 Python MCP 环境明确标记 `BILI_DISCUSSION_VIDEO_AGENT=1`，每轮最多读取 6 条不同 BV 的评论列表、2 条已出现在本轮对应 BV 列表里的真实楼层；其他主人查询与后台互动不被这些视频轮额度影响。
- 实际读成功/失败生成最小只读回执（不含评论正文、评论者 UID、私信原文或模型隐私上下文）。`bili_discussion_note` 可在本轮确实读到评论后保存一次主观临时疑问；原有日报工具 `bili_report_append` 也可在写日报的同次调用中可选附带真实阅读 BV 的主观反应，使用同一安全写入者；未提供感受时仅可记录匿名诊断，不得编造主观事实；它不进入长期记忆、兴趣分数、关系索引、待办账本或外发口径。错误或风控不能伪装成“无评论”。见 `docs/architecture/2.7.1-dev1-video-discussion-life.md`。
- `2.7.1` 后续记忆治理、契机协调及兴趣/关系反向影响生活的能力仍属于规划，不得在 dev.1 提前宣称完成。

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

- `dev.4` Life Agent 社交仍由旧 DM／评论回复器唯一决策和发送；Phase 5 单独、默认关闭的 `lifeAgentSocialContextOptIn` 只允许核验好友普通 DM 与公开评论的 10 分钟／420 字进程内影子上下文，模型额外分类计入原每日额度，不授权外发；生产说明见 [`Phase 5`](docs/architecture/2.7.1-dev4-life-agent-phase5-social-shadow.md)，旧归属契约见 [`Phase 4`](docs/architecture/2.7.1-dev4-life-agent-phase4-social-owner.md)。

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

## 2.7.1-dev.2 补充 · 真实按需证据读取和可验收性

精简模式首次请求不得执行长期记忆、梗或人物画像检索；这些读取只由本 UID 的 `contextRequests` 引发，检索无命中需显式返回 `not-found`，失败时不得发送请求中的草稿。完整模式仍保留原来的读取行为；原有待办/推荐事实回执、私密分域、发送权限不容为降低成本而绕开。运行诊断可显示最近 12 个 **匿名** 批次的请求类型与命中状态，严禁写入 UID、正文、提示词或记忆内容。参见 `docs/architecture/2.7.1-dev2-true-on-demand-retrieval.md`。

## 2.7.1-dev.2 增量 · 上下文模式约束

后台普通 DM 与走 `interaction-batch.mjs` 的评论/@ 支持 `interactionContextMode=compact|full`（生产默认 `compact`）；原始完整提示词不能删除。精简模式的 `contextRequests` 只可请求当前 UID 及该渠道 `SocialContextAssembler` 已授权的资料；长期记忆、画像和梗在请求后才检索，最多一轮续推；首次申请不得外发/接受待办。事实校验、已接受任务回执、平台发送权限、隐私和 P6 边界永远属于后端，不能被上下文模式覆盖。主人私信 Agent 和 DSH 主 Session 不经过该选择器，不能把它写作“全局四渠道切换”。参见 `docs/architecture/2.7.1-dev2-dialogue-context-modes.md`。

## 2.7.1-dev.2 补充 · 白名单好友兴趣纠错（局部）

`friend-learning.mjs` 是当前帐号内白名单好友明确兴趣自述的唯一证据写入源，不等同于 `SocialPortraitGateway` 的交流偏好或完整人物记忆。时序自述只能在同一消息内以真实主题为依据，历史喜欢不得冒充当下；兴趣减弱记录为 `uncertain`，不等于讨厌；同 UID 的后续明确自述可以覆盖用于主动推荐的当前投影，但不能恢复全局退订、拒联或其它发送权限。管理中心「社交互动 → 好友兴趣变化」显示可复核状态。见 `docs/architecture/2.7.1-dev2-friend-interest-correction.md`。未实现跨来源全面语义纠错。
