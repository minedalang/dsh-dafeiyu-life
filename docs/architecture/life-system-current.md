# Life 全景图与源码接线审计（当前 dev.33 @修复版 + 同版本菜单门禁加固）

> **可直接在 GitHub 查看渲染结果：**[Life 全景与候选图](./life-system-current-view.md)。它是根据 `.mmd` 自动生成的只读展示，不应直接编辑。
>
> **唯一维护入口：**[完整 Life 生产代码全景 Mermaid](./diagrams/life-system-current.mmd) · [八类候选精确字典 Mermaid](./diagrams/life-candidates-current.mmd)。这两张 `.mmd` **是源文件**，可直接通过 GitHub Mermaid 或支持 Mermaid 的编辑器编辑、比较和渲染；此前的 PNG 仅为概念插画，不是程序运行证明。
>
> **状态：`2.7.1-dev.33` / `releaseReady:false`**。未合并 main / Tag / 发布。图中“已接线”只指源码、相关离线契约存在，不代表 Windows、真实 B站、GGUF、72h 实机验收。

## 图例与术语纠偏

- **蓝色 = 已存在可定位的代码实现**；**黄色 = 有代码但仍有渠道差异／有限接入**；**红色 = 不能宣称具备通用闭环／尚无实机验收**。不存在任何“图里有箭头就已验收”的含义。
- **todos（待办）**：原 OwnerTodoEngine 已接受、到期且类型在 `READ_TODO_TYPES` 中的可读任务。Life 不是自动创建一切主人要求或执行任意写入待办的机器人；模型不能凭一条兴趣线索创建承诺。
- **cues（生活线索）**：`LifeOpportunities.explorationCues()` 当前仅提供账号可归属的 `interest-milestone` 和 `discussion-read`（需有效评论阅读/兴趣证据）。**无聊去刷首页不是存储的 cue**；`browse_home` 是无需 cue 也可选择的独立候选动作。
- **intentions（自主探索意愿）**：同一 `life-opportunities` 账本中模型选择后写入、带有效期和可信 BV/来源的跨轮公开探索意愿；不等于全域持久事务队列或私信发送批准。
- **opportunities（生活契机）**：`deriveDiscussionOpportunities`、跨日兴趣、`public-person-observation` 等带可信来源、可复核的具体机会；不是“只要看到评论就可回复”，也不从陌生私信正文造任意机会。
- **social（社交机会）**：入站 `dm-received` / `comment-received` 是匿名关注信号；另外有已核验双向互动的好友自主候选。真正对外回复/联系经过独立的原渠道准入、拒联、限额和事务回执。
- **video（视频能力）**：是当前账号启用且过冷却的 `bilibili.video-explore` 等可选能力，**不是已经观看视频**；`homeCandidates` 与 `homePickedCount` 分别是已读候选数和实际入选来源数，不证明画面/音频消费。
- **reflection（反思）**：`LifeReflection.status().canAutoReflect` 提供真实就绪状态，执行前还要重新核对。此维护补丁修复旧解析器接受本轮未提供 `reflect` 的问题。
- **eventRefs（匿名事件引用）**：`life-agent-events` 提供事件类型/ID/重考虑提示，不能被模型当作评论原文、已完成事实或写入授权；真实完成凭原平台回执。

## 从当前源代码核对的关键链路

| 链路 | 当前实际情况 | 审计状态 | 主要文件／后续要求 |
|---|---|---|---|
| 真实来源 → 候选 | 分别读取既有 TODO、兴趣、评论观察、人物证据与账号事件账本，之后做读动作归属协调 | **接线，但不是统一永久候选库** | `lib/life-opportunities.mjs`、`lib/autonomous-action-contract.mjs`、`lib/life-agent-events.mjs` |
| cues → 探索意愿 → 元数据 | 有真实兴趣/同 BV 阅读证据才能从 cue 提出目标，平台结果必须核实 | **已接线，有限来源** | `lib/autonomous-planner.mjs`、`lib/life-opportunities.mjs`；不能自由把任意话题转换成平台搜索词 |
| opportunities → 公众人物探索 | 仅跨日有证据的交流对象可重核身份及公开投稿；撤销来源会失效 | **已接线，有限范围** | `lib/life-opportunities.mjs`；不包括刚遇到的任意陌生评论者，也不授权跨串回复 |
| 无兴趣 → 首页 → 来源归因 | `browse_home` 不依赖 cue/event；视频 Agent 真实读取首页候选并按本轮 BV 匹配入选来源 | **代码已接线，实机待验** | `lib/autonomous-planner.mjs`、`lib/life-home-feed-evidence.mjs`、`lib/life-agent-events.mjs` |
| 反思候选 → 实际反思 | 状态已共享就绪判断；**旧解析器存在未提供 reflect 也可被接受的旁路** | **本维护补丁加固** | `lib/autonomous-planner.mjs` 新 `validateOfferedLifeAction` 严格对照本轮菜单；反思器仍执行前复核 |
| Life → 写动作 | Life 连续视频写动作借用原视频意愿桥/平台工具；社交发送走原渠道的关系和策略门禁 | **多条受控执行路径，而非单个万能网关** | `lib/life-continuation-write.mjs`、`lib/life-video-action-bridge.mjs`、`index.js`；未形成所有写动作的通用单进程原子事务 |
| 平台结果 → Life 事件 | 验证成功、失败、未知分开记录；脱敏决策轨迹只代表决策与结果分类 | **已有对应账本，不等于全场景 E2E 证据** | `lib/life-agent-events.mjs`、`lib/life-decision-trace.mjs`；真实 B站读回仍未验收 |
| 真正完成 → Life 记忆 | 目前仅白名单中的已核验动作投影进入可衰减情节；原回执仍是细节事实源 | **部分接线，需覆盖率审计** | `lib/life-action-memory.mjs`、`lib/life-memory-coordinator.mjs`；不能宣传“所有 API 调用自动入记忆” |
| 记忆 → 自主回忆 | 实时账号/授权/遗忘/时间过滤 → 词法 + 可选本地 Embedding 排序 → 回原可信记录 | **部分接线，legacy/full 与各入口不完全等价** | `lib/memory-retriever.mjs`、`lib/recall-request.mjs`；向量命中不是事实来源 |
| 反思 → 兴趣/关系/人格 → 下一轮 | 基于已有证据的反思/兴趣等更新存在，但反向影响动作的可测长期因果未完全证明 | **部分接线且长期因果未验收** | `lib/life-reflection.mjs`、`lib/life-interests.mjs`、`lib/life-voice-context.mjs` |

## 这次实际修复（P0）

**发现：**`plannerActionMenu` 已限制反思等动作是否出现，但主 Life 模型回文的兼容解析器 `validatePlannerDecision` 对 `reflect` 无条件放行。在未展示 `reflect` 时，模型若仍输出该动作，可能造成无效选择；对于开发中的其他旧解析目标，也不能把“模型恰好猜对 ID”当作本轮授权。

**修复：**增加 `validateOfferedLifeAction(choice, actionMenu)`，在主 Life 回文完成解析、开始执行前，统一核对动作类型及其 `id` / `bvid` / `capability` 与**当轮实际提供的菜单**严格一致。未提供则返回 `skip / invalid-decision / model-action-not-offered`，不是鱼鱼自愿休息；不调用工具或外发，不制造成功事实。正常 `skip`、有效反思、原有待办/社交/首页/意愿路径不改变。原子账本及多渠道平台授权继续各自执行前核验。

回归详见 `test/v271-dev33-life-menu-hardening.test.mjs`。

## 尚未完全实现、后续优化顺序

1. **P1 · 事实入记忆覆盖表**：为每个只读/已核验写入动作建立 `source → receipt → verifiedLifeActionEvent → episode → recall` 的渠道化回归矩阵，检查忘记后的撤销与账号切换；不要把 `eventRefs` 或调试记录当作记忆。当前有白名单事件投影，但还不能证明每种真实工具调用均已接线。
2. **P1 · 人物与评论线程可信目标**：有真实评论楼层 ID、BV、作者 UID、原文等一致证据，才考虑陌生评论者的公开作品与跨串回复；需反骚扰节奏/单独授权，不能由视频作者 UID 代替。
3. **P1 · 真实 UI 与端到端闭环**：Windows/Desktop+B站双账号、首页推荐有效候选→真实入选→视频元数据→合法写入→独立平台核验→可召回经历，验证失败/未知、断网、重启与撤权路径。
4. **P1 · 回忆入口一致性**：将 remaining legacy/full 和专业 Agent 的可访问记忆路径分别登记，验证“相关信息能召回”和“不可见/已忘信息绝不会返回”，本地 639MB GGUF CPU 实跑及失败词法回退。
5. **P2 · 长期生活因果**：持续 ≥72h 对照 Life 决策、首页偶遇兴趣、社交互动、反思与后续真实意愿；明确区分模型被提供的证据、实际使用的证据和后续平台行为。

以上优化是**明确的未完成项**，本次补丁没有擅自扩大评论/关注/私信授权，也没有虚构长期实机验收。

## 以后修改代码时如何保持图与项目同步

1. 编辑本目录 `diagrams/life-system-current.mmd`（总体接线）和 `diagrams/life-candidates-current.mmd`（候选字典），按真实源码变更颜色/箭头/文字；PNG 只能作为非规范性展示。
2. 每个主要节点下 `%% @code node | lib/... | 某个实现标记` 是机器检查锚点。代码重命名、移动或删除后，若不同时调整图，会触发测试失败；**此检查不能证明行为正确，只能阻止明显的图／实现漂移**。
3. 先运行 `npm run write:life-architecture-view` 更新 GitHub 预览，再运行 `npm run check:life-architecture` 和 `node --test test/v271-dev33-life-architecture-contract.test.mjs test/v271-dev33-life-menu-hardening.test.mjs`，并执行受影响渠道的完整测试和真实环境验收。`.github/workflows/life-architecture.yml` 在 push / PR 中执行这两个门禁；源图和检查脚本一起由 npm 包 `files` 字段保留。
4. 变更涉及新渠道、授权、事实源或记忆投影时，同步本页审计矩阵、`docs/architecture/README.md`、`AGENTS.md`；本页不替代具体实现文档。

**发布门槛未变化：**实际 Windows Desktop、真实 B站、真实本地 GGUF、账号切换、备份升级、连续 72 小时和跨日成长验收未完成前，`releaseReady:false`；不合并 main、不创建 Tag、不发布。
