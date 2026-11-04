# 大肥鱼 · DSH 生活系统：AI 开发约定

> 本文件只规定**当前长期有效**的开发边界和交付流程，不记录各版补丁历史。现行架构从 [`docs/architecture/README.md`](docs/architecture/README.md) 开始；历史决策通过 Git 与 [`docs/archive/README.md`](docs/archive/README.md) 查找。

## 项目与代码入口

- 包名与宿主插件名：`dsh-dafeiyu-life`；当前开发版本 `2.7.1-dev.1`，稳定版基线 `2.7.0`（npm 实际发布状态仍须由维护者验证）；未经用户明确授权不得合并 `main`、创建 Tag 或发布。后续开发应重新从 `X.Y.Z-dev.N` 开始。
- `index.js`：宿主配置、工具与 HTTP 业务入口；`client.js` 和 `lib/management-console.*`：界面；`lib/`：业务与共享层；`prompts/duty.md`：用户可修改的章程；`vendor/bilibili-mcp/`：内置 Python MCP。
- 运行数据保存在 `$DSH_HOME/bili-duty/`，不能写回插件包。不得自动覆盖用户修改的章程、配置、模型或权限。
- 维护原作者与第三方署名；不得声称这是 DSH/B站官方产品。

## 产品原则和不可突破的边界

- **对外品牌主张固定为「坚持鱼的自由发展」**：README 和对外宣传强调鱼鱼在持续生活、探索、社交中形成自己的喜恶与选择，而非仅执行命令；不得把愿景写成已验收能力，也不得暗示 AI 具有真实意识或绕过授权。

1. **同一条鱼、双域意愿**：主 Session 按授权执行工作请求；B站生活域保留自主接受、延期、拒绝、沉默与自然成长。模拟情绪／人格不代表真实意识。
2. **意愿不等于权限**：任何自动评论、私信、点赞、关注、动态发布等外部写入，都必须通过身份、用户授权、额度、去重和真实平台回执；未知或不确定发送结果不得盲目重试。
3. **事实不等于意愿，也不等于记忆**：真实执行回执产生后便可在授权范围内查询，不依赖是否已经回访；检索资料不等于看过画面／听过音频，草稿不等于已发布。
4. **尊重隐私和遗忘**：按真实 UID／账号／公开或私密域隔离；只读取仍可访问的可衰减记忆。永久归档是备份／审计材料，不可绕过遗忘恢复到模型上下文。
5. **老用户兼容优先**：新功能不自动扩大发送权限，账号切换不跨账号沿用待办、授权、私信游标或回执。备份／恢复保留校验、用户确认与私密数据隔离。

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
- 实际读成功/失败生成最小只读回执（不含评论正文、评论者 UID、私信原文或模型隐私上下文）。`bili_discussion_note` 可在本轮确实读到评论后保存一次主观临时疑问；它不进入长期记忆、兴趣分数、关系索引、待办账本或外发口径。错误或风控不能伪装成“无评论”。见 `docs/architecture/2.7.1-dev1-video-discussion-life.md`。
- `2.7.1` 后续记忆治理、契机协调及兴趣/关系反向影响生活的能力仍属于规划，不得在 dev.1 提前宣称完成。

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
