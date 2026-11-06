## 当前实施包 A：Life 双节奏与分类预算（未发布，未接管社交发送）

- [当前真实接线、旧生活预设显式保留、社交快速只读关注、跨进程额度、DEBUG 事件关联及风险矩阵](./2.7.1-life-a-dual-lane-budget.md) · [可编辑当前 Mermaid](./diagrams/2.7.1-life-a-dual-lane-live.mmd)。这是上传 `2.7.1-dev.4` 上的开发中增量，不表示曾经的 Phase 6 / Phase 7 全部验收，也不启用正式社交外发。下方 `dev.4` 文件是原有实现的架构记录，涉及双节奏与额度的现行行为优先参照本页。

## 当前增量：Life Agent 视频轮结束后的自主反馈与冷却恢复

- [可信视频轮结束回执如何进入同一生活决策、冷却期不误消费、忙碌诊断与安全边界](./2.7.1-dev4-life-post-video-continuity.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-life-post-video-continuity-live.mmd)。复用唯一 Life Agent、v1 事件账本及原视频 Agent，不新增发送权限；真实观看/听音、Windows/B站仍待验收。

## 当前增量：Life Agent 视频 Agent 子进程真实轮次回执与时间线

- [原视频轮次启动/退出/失败/未知的账号隔离回执、视频入选数事实来源、真实时间线与安全边界](./2.7.1-dev4-life-video-round-lifecycle.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-life-video-round-lifecycle-live.mmd)。这并不是证明作品观看/听音成功，也不开放社交发送；Windows 与真实平台仍待验收。

## 当前增量：Life Agent 内置 Python MCP 只读预约身份核验

- [跨进程误判与嵌套工具 HMAC 核验、脱敏预约拒绝原因及迁移边界](./2.7.1-dev4-life-nested-mcp-read-identity.md) · [当前 Mermaid](./diagrams/2.7.1-dev4-life-nested-mcp-read-identity-live.mmd)。同账号、同 BV、活跃执行进程仍是硬门禁；不自动清锁，不新增平台调用或外发权；Windows/真实 B站待验收。

## 当前增量：Life Agent 平台元数据真实失败追踪与无模型探测

- [跨 Python MCP 与 JS 的有界平台失败契约、同账号可信公开 BV 手动只读探测、脱敏平台错误来源](./2.7.1-dev4-life-metadata-platform-diagnostics.md) · [当前 Mermaid](./diagrams/2.7.1-dev4-life-metadata-platform-diagnostics-live.mmd)。不调用模型、不修改生活账本或发送社交内容；实际只读探测仍消耗平台请求额度，Windows/真实 B站待验收。

## 当前增量：Life Agent 自主探索只读回执与后续生活选择（未开放社交外发）

- [已结算生活契机与独立探索线索分账本语义、失败有界冷却、成功元数据后的后续自主考虑](./2.7.1-dev4-life-exploration-read-continuity.md) · [当前调用 Mermaid](./diagrams/2.7.1-dev4-life-exploration-read-continuity-live.mmd)。修复 `cues>0`、`opportunities=0` 时只读失败的错误结算；仅验证公开元数据，视频观看和社交接管仍需真实回执与独立授权。

# 当前增量：Life Agent 决策全过程 DEBUG / B站只读拒绝分类 / 旧测试入口清理

- [真实生活决策链脱敏追踪、平台拒绝分类及重复汇总、错误冻结收紧、Debug 入口和兼容说明](./2.7.1-dev4-life-decision-trace-and-read-diagnostics.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-life-decision-trace-live.mmd)。保留原生活事件、已授权只读动作及平台回执为事实源；调试记录不是第二份记忆或授权；Dev3 旧离线按钮退役。Life Agent 社交仍未接管。

## 当前增量：Life Agent 事件公平结算与影子证据门禁（社交未接管）

- [匿名生活事件逐项归属、未选中线索有界重考虑、可信只读证据仅证明“提供过”、旧社交影子短时样本诊断](./2.7.1-dev4-life-event-fairness-and-shadow-evidence.md) · [当前实际 Mermaid](./diagrams/2.7.1-dev4-life-event-fairness-shadow-live.mmd)。复用原 Life Agent／账号 v1 事件账本与原旧社交唯一 owner，未新增外发权限、社交切换开关或模型预算；Windows/真实平台待验收。

## 当前增量：Life Agent 回执边界与生活契机账本原子性（无社交接管）

- [生活契机 v1 原子写入、生活事件在执行前失败时重试/结果未知时冻结、只读失败明确返回及停机离线审查](./2.7.1-dev4-life-receipt-boundary-hardening.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-life-receipt-boundary-live.mmd)。继续复用 `AutonomousPlanner`、`life-agent-events`、`life-opportunities`，不新建状态真值或扩大权限；原 DM/评论回复器仍独占真实社交决策。Windows 与真实平台待验收。

## 当前增量：Life Agent 可靠性集成（不包含社交接管）

- [匿名生活事件的有界重试、跨进程共享模型额度/租约、公开视频元数据失败分类与短期恢复](./2.7.1-dev4-life-reliability-integration.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-life-reliability-live.mmd)。仅收紧既有 Life Agent 和既有只读契机路径，不改变旧私信/评论真实社交发送权；Windows/真实 B站 API 和 DSH Desktop 待验收。

## 当前生活决策：按本轮真实候选约束模型选择

- [Life Agent JSON 解析兼容与逐轮准确动作菜单](./2.7.1-dev4-life-decision-contract.md) · [实际调用图](./diagrams/2.7.1-dev4-life-decision-contract-live.mmd)。复用自主规划器与既有可信候选、模型额度、账号和发送门禁；格式兼容只限单个完整 JSON 代码围栏，不开放任意文本提取或额外模型重试。未执行动作仍有匿名失败诊断。

## 当前增量：dev.4 Phase 6h 社交交接排他基础（未开放真实接管）

- [旧社交路由跨进程排他检查、异常残留冻结和匿名诊断；合成子进程故障演练](./2.7.1-dev4-phase6h-social-handoff-fence.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-phase6h-social-fence-live.mmd)。只在原旧 DM/评论路由**读取**持久预约；新预约 API 尚未由生产发起，也无 Life Agent 决策或真实发送权限。Windows/真实 B站待验收。

## 当前增量：dev.4 Phase 6g 只读社交影子配对审计（待 Windows 实机）

- [同来源不可抢占、分类不可覆盖、私信/评论分渠道缺样本和分歧诊断](./2.7.1-dev4-phase6g-social-shadow-audit.md) · [生产 Mermaid](./diagrams/2.7.1-dev4-phase6g-social-audit-live.mmd)。这只是既有 Phase 5 可撤销内存影子的质量门禁，**没有**将真实社交决策权交给 Life Agent。

## 当前增量：dev.4 Phase 6f 自主调度诊断跨账号隔离（待 Windows 实机）

- [账号核验的最近决策显示、旧文件不迁移、共享模型额度不变](./2.7.1-dev4-phase6f-account-diagnostic-isolation.md) · [生产 Mermaid](./diagrams/2.7.1-dev4-phase6f-account-diagnostics-live.mmd)。未标注来源的旧历史保留在原数据/冷快照中，不误归属当前账号；不改变社交决策与外发权限。

## 当前增量：dev.4 Phase 6e/7e 自主生活可见验收（待 Windows 实机）

- [真实视频委派门禁、单列时间线与无 B站纯模拟工具](./2.7.1-dev4-life-experience-visible-acceptance.md)。明确：shadow 不通过新生活驱动启动现有视频 Agent；active 仅允许原条件下委派。模拟不能冒充真实观看或成长。

## 当前增量：dev.4 Phase 6d/7d 视频驱动归属与只读模型倾向对照（待 Windows／真实模型验收）

- [Phase 6d/7d 实际生产接线、同一设置源、显式两次模型额度与安全限制](./2.7.1-dev4-phase6d-phase7d-driver-contrast.md) · [生产 Mermaid](./diagrams/2.7.1-dev4-phase6d-phase7d-live.mmd)。只做纯模型倾向对照，**不是实际行动或人格成长因果证明**；老回复器与所有外发门禁不变。

## 当前增量：dev.4 Phase 6c 旧设置控制权 + Phase 7c 成功只读经历跨轮参考（待实机验收）

- [统一层归属、旧设置防覆盖、48h 匿名可信只读经历与真实限制](./2.7.1-dev4-phase6c-phase7c-legacy-ownership-continuity.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-phase6c-phase7c-live.mmd)。已完成的是旧入口互斥和短期决策参考，**不是全部旧模块删除或人格成长因果闭环**；上一 Phase 6b/7b 仍作为基线。

## 当前增量：dev.4 Phase 6b 排他视频时钟 + Phase 7b 关系排序对照（待实机验收）

- [影子模式旧定时器运行门禁、旧配置冲突拦截和匿名关系排序反事实标记](./2.7.1-dev4-phase6b-phase7b-schedule-growth-proof.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-phase6b-phase7b-live.mmd)。旧数据不迁移、不授权外发；关系对照不等于模型因果成长。此前 Phase 6/7a 仍作为前置基线。

## 当前开发增量：dev.4 · Phase 6 统一设置、Phase 7a 成长参考可见性（未完整验收）

- [已接线的显式生活设置保存、旧视频定时器互斥、安全边界与匿名成长参考](./2.7.1-dev4-phase6-settings-phase7-evidence.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-phase6-phase7a-live.mmd)。仍写原 `persistCfg`，保留旧配置的高级兼容入口；**没有完成全部旧调度退役、社交决策接管或成长因果闭环**。Windows 与真实模型/B站待验收。

## 当前开发预览：Phase 5 决策诊断收尾 / Phase 6 只读设置预览

- [真实决策结果分类、无候选免模型调用、历史兼容、设置只读映射与迁移安全条件](./2.7.1-dev4-choice-diagnostics-phase6-settings-preview.md) · [当前 Mermaid 接线](./diagrams/2.7.1-dev4-choice-diagnostics-settings-live.mmd)。本轮**没有**替换旧调度或社交回复者；Windows 和真实模型待验收。

## 当前 dev.4 Phase 5 增量 · 手动唤醒与匿名队列诊断

- [六小时自动防重复与手动请求区别、人工唤醒队列优先级、模拟验收、安全边界](./2.7.1-dev4-life-agent-manual-wake-hotfix.md)。本修复没有赋予 Life Agent 新的社交发送权，不改变原 Phase 5 影子上下文授权。

# 当前开发预览：2.7.1-dev.4 Phase 5 · 授权社交上下文与只读影子对照（未接管）

- [实际接线、安全边界、单独授权、匿名模型类别对照与无 B站模拟](./2.7.1-dev4-life-agent-phase5-social-shadow.md) · [Phase 5 Mermaid 生产图](./diagrams/2.7.1-dev4-life-agent-phase5-social-shadow-live.mmd)。默认不读取任何社交原文；需用户单独授权且原核验入站事件有效，才能短暂阅读好友私信或核验公开评论。二次模型调用消耗原每日额度，输出不授权外发；社交仍由原回复器独占。Windows/真实模型/真实 B站尚待验收。

## 当前开发预览：2.7.1-dev.4 Phase 4 · 社交决策所有权明确化（未接管）

- [生产入口、社交旧决策归属、账号切换保护与无 B站离线验收](./2.7.1-dev4-life-agent-phase4-social-owner.md) · [Phase 4 实际生产 Mermaid](./diagrams/2.7.1-dev4-life-agent-phase4-social-owner-live.mmd)。`off/shadow/active` 均未授予 Life Agent 社交发送权；旧 DM/评论代理仍是决策者。社交归属诊断只读、短期、不含 UID/原文。Windows 与真实 B站仍待验收。

## 当前开发预览：2.7.1-dev.4 Life Agent 第三阶段 · 生活时间线与冷备份恢复

- [已实现的同账号匿名决策时间线、旧事件 schema 无损读取、完整本地快照/校验/回滚冻结与老用户验收边界](./2.7.1-dev4-life-agent-phase3.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-life-agent-phase3-journal-backup-live.mmd)。旧 UI 可替换，但旧数据备份/恢复是硬约束；现有便携业务备份**不是**完整账号和私密状态快照，新增冷快照需停机且含敏感凭证。Windows/真实平台仍待验收。

## 当前开发预览：2.7.1-dev.4 Life Agent 第二阶段 · 匿名社交唤醒接入

- [第二阶段实际接线：私信/评论已核验入站事件 → 当前账号匿名生活唤醒 → 同一 Life Agent 的自主注意/沉默](./2.7.1-dev4-life-agent-phase2-social-wakes.md) · [第二阶段实际生产图](./diagrams/2.7.1-dev4-life-agent-phase2-social-wakes-live.mmd)。社交事件不再受视频启动额度限制；当前模型只看事件类型/ID/时间，**没有聊天原文，不接管原 DM/评论回复发送权，也不产生关系事实或发送许可**。仍待 Windows 和真实平台验收。

## 当前开发预览：2.7.1-dev.4 Life Agent 第一阶段已接入；完整目标仍在实施

- [统一 Life Agent 的正式架构决策与目标图](./2.7.1-dev4-life-agent-decision-adr.md) · [目标 Mermaid](./diagrams/2.7.1-dev4-life-agent-target.mmd)。选择 C：事件驱动、单主体、连续记忆成长，允许重构旧定时视频生活驱动；**目标图不等于已完成的生产接线**。

- [第一阶段已实现接线与验收](./2.7.1-dev4-life-agent-phase1.md) · [本阶段实际生产图](./diagrams/2.7.1-dev4-life-agent-phase1-live.mmd)：同一自主规划器可选择视频探索或休息；管理中心可以关闭、影子观察或接管旧自动视频轮，默认关闭。社交决策仍由旧入口处理，Windows 和真实 B站待验收。

- [后续重构与迁移细化方案](./2.7.1-dev4-unified-life-agent-refactor-plan.md)：复用原人格、记忆、关系、待办、权限和 dev.3 回执，逐步迁移社交、工具规划与成长反馈。

- [2.7.1-dev.3 · 跨语言预约、待办事务与顺路热评](./2.7.1-dev3-cross-language-execution-and-comment-followup.md)：Node/Python 同一只读预约、待办短事务锁和独立的顺路热门评论回复链。[生产图](./diagrams/2.7.1-dev3-cross-language-execution-live.mmd)。
## 当前开发预览：2.7.1-dev.3 自主待办与生活意愿的共享只读动作协调（增量）

- [2.7.1-dev.3 · 先前：共用 JS 只读执行预约与保守恢复](./2.7.1-dev3-durable-read-execution.md)：已实现跨 Node 进程只读互斥、同账号作用域、人工恢复；Python Headless 与社交写操作尚未接入。 [当前生产执行图](./diagrams/2.7.1-dev3-durable-read-execution-live.mmd)。

- [真实已接受待办、生活契机与跨轮意愿的共用动作身份、去重和执行前核验](./2.7.1-dev3-shared-action-arbitration.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev3-shared-read-actions-live.mmd)。只在原 `AutonomousPlanner` 内对**同一只读动作**协调候选；待办仍是履约账本，生活意愿仍可自然放下，外部发送权限不变。管理中心可查匿名去重而非虚假完成。新增 JS 共享调用入口已实现部分跨进程预约；独立 Python 视频 Agent、其余工具及真实 B站端到端验收仍未覆盖。

# 大肥鱼 · 当前技术架构

> 本页是维护者的**当前架构入口**，不是版本流水账。任何涉及统一层、事实源、权限、事件流、渠道接线和存储的修改，必须同步更新本页、相应说明、Mermaid 图与回归测试。根 README 始终面向用户。

- [新功能可验收性契约：触发、选择、真实回执、隐私、费用与使用者验收步骤](./acceptance-observability-contract.md)。代码测试通过不能代替用户可观察的真实行为。

## 当前界面：统一生活设置与开发诊断分层

- [普通使用只需生活开关和活跃度；旧模式、影子对照与运行诊断折叠；模型 JSON/动作无效有安全分类](./2.7.1-dev4-unified-life-agent-lifestyle-migration.md)。该界面优化不等于已完成旧社交接管或真实模型验收。

## 当前开发增量：dev.4 · Phase 6/7/8 迁移验收状态与暂停门禁（非封版）

- [基于原设置、Life Agent、跨进程交接与发送事务的只读迁移核验](./2.7.1-dev4-life-transition-readiness.md) · [生产 Mermaid](./diagrams/2.7.1-dev4-life-transition-readiness-live.mmd)。普通手动生活唤醒尊重暂停，旧社交决策者和 Phase 7/8 缺口会明确列为未完成；不会自动发送、迁移、发布或解除残留锁。

## 当前开发预览：2.7.1-dev.4 统一生活驱动与简单设置（尚非全域社交接管）

- [旧视频定时器物理退出、Life Agent 单一自主视频驱动、活跃程度预设/高级配置、老用户手动迁移和权限边界](./2.7.1-dev4-unified-life-agent-lifestyle-migration.md) · [实际接线 Mermaid](./diagrams/2.7.1-dev4-unified-life-agent-lifestyle-live.mmd)。普通社交、回访仍维持现有独立控制和发送许可；Windows/真实 B站未验收。

## 当前开发预览：2.7.1-dev.4 Phase 6 Final 集成候选（在途排空，未封版）

- [跨进程旧决策/发送在途排空、可信评论共享事务、失败保守冻结与缺口矩阵](./2.7.1-dev4-phase6-final-social-drain.md) · [实际接线 Mermaid](./diagrams/2.7.1-dev4-phase6-final-social-drain-live.mmd)。仅完成交接前的可核验条件；**未开放 Life Agent 社交接管、未完成全域写入适配、未完成 Windows 和 B站验收**。旧 6h/6ijk 文档仍用于查单项来源和历史。

## 当前开发预览：2.7.1-dev.4 Phase 6i/6j/6k 社交外发逐消息安全基础

- [旧 DM/评论发送适配器上的逐事件原子占位、可信回执、异常冻结与匿名管理诊断](./2.7.1-dev4-phase6ijk-social-send-transactions.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-phase6ijk-send-transactions-live.mmd)。只在旧 DM/评论外发路径接入；此时 **Life Agent 社交决策和外发仍未启用**，并非生产可用的双 owner 原子交接，也不覆盖自主分享/回访等其他发送入口。Windows/真实平台仍待验收。

## 当前开发预览：2.7.1-dev.3 私密关系对自主生活的最小可信影响（增量）

- [账号绑定的好友明确兴趣与鱼鱼自己的公开兴趣交集、关系熟悉度门禁、原模型调用、只读行为与匿名验收](./2.7.1-dev3-private-affinity-life-bridge.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev3-private-affinity-life-live.mmd)。只提供最多三条**匿名共同兴趣参考**，不从私信创造搜索词、候选工单或主动联系。旧无来源账号标签的好友兴趣**不会**参与；尚未形成完整私人共同经历与主动社交机制，真实环境仍需验收。

## 当前开发预览：2.7.1-dev.3 自主生活意愿与跨场景只读探索（增量）

- [真实来源、统一决策、模型自选探索目的、公开搜索、跨轮 BV 核实、短期意愿与管理中心验收](./2.7.1-dev3-unified-life-intentions.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev3-unified-life-intentions-live.mmd)。复用原 `LifeOpportunities` 状态文件、`AutonomousPlanner`、Life Voice 和只读 B站适配器。现可从**账号归属明确的跨日兴趣或真实评论疑问**形成模型自主意愿；支持继续核实 BV、按真实作者身份读取公开投稿并选另一部 BV 核实，不依赖回到刷视频轮。没有开放自主关注／私信、私人聊天意愿外传或任意工具组合。

## 当前开发预览：2.7.1-dev.3 评论感受实际工具调用链补充

- 视频 Agent 的 `bili_report_append` 可顺带提交经过同一 BV 评论阅读证据验证的**可选**临时感受；单独 `bili_discussion_note` 保留。管理中心新增“日报后未附感受”匿名计数，区别于成功/拒绝，不冒充鱼鱼的内心判断；无额外模型调用、无外发或待办权限变化。见 [dev.3 当前生活契机说明](./2.7.1-dev3-life-opportunities.md) 和 [评论只读 Mermaid](./diagrams/2.7.1-dev1-video-discussion-live.mmd)。

## 当前开发预览：2.7.1-dev.3 多来源生活契机（评论、兴趣、公开交流）

- [生产链路、数据来源、选择回执、手动验收、账号隔离、剩余风险](./2.7.1-dev3-life-opportunities.md) · [现行 Mermaid 生产图](./diagrams/2.7.1-dev3-life-opportunities-live.mmd)。现支持本账号真实非空评论阅读后临时反应、有明确账号归属的跨日自主选片趋势、当前账号公开评论中跨日有证据的交流偏好；复用现有 `AutonomousPlanner`，不另设定时器或任务账本。仅可核实原有 BV 公开元数据或在本地复核公开交流，不增加社交发送权限。无账号归属的历史兴趣不迁移为行动契机；完整长期人物语义记忆和真实 Windows/B站仍待验收。

## 当前开发预览：2.7.1-dev.2 补充：好友兴趣的时序纠错

- [白名单好友明确兴趣的历史/当前区别、弱化态度、同 UID 后续修订及原推荐安全边界](./2.7.1-dev2-friend-interest-correction.md) · [现行数据流 Mermaid](./diagrams/2.7.1-dev2-friend-interest-correction-live.mmd)。复用既有 `friend-learning.mjs` 证据账本和管理中心「好友兴趣变化」入口，不建立第二套长期人物记忆；通用跨源记忆纠错仍待后续阶段。

## 当前开发预览：2.7.1-dev.2 补充：真实按需读取与匿名逐轮诊断

- [生产接线、模型自主检索、UID 权限、失败保护及可观察性](./2.7.1-dev2-true-on-demand-retrieval.md) · [Mermaid 实际数据流](./diagrams/2.7.1-dev2-true-on-demand-live.mmd)。精简首轮不检索长期记忆、人物画像、梗；模型有需要才请求并由本 UID 的只读源返回。待办与推荐进度仍保留已有事实一致性守卫，不能将其写成全面动态检索。

## 当前开发预览：2.7.1-dev.2 增量：后台对话上下文可选模式

- [精简按需与原始完整双模式：覆盖范围、模型主动扩展证据、原契约安全约束、真实调用计数](./2.7.1-dev2-dialogue-context-modes.md) · [实际生产接线 Mermaid](./diagrams/2.7.1-dev2-dialogue-context-modes-live.mmd)。新安装默认精简；普通私信和使用共用批处理器的评论/@ 生效，**不作用于独立主人私信 Agent 或 DSH 主 Session**。需要额外证据时模型可多续推一次，未使用真实 AI 的质量/成本尚未验证。

## 当前开发预览：2.7.1-dev.2 私信短期上下文治理

- [短期原文来源、自动与人工清理、账号/UID/权限边界及当前生产接线](./2.7.1-dev2-dm-memory-governance.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev2-dm-memory-governance-live.mmd)。只处理后台普通私信和主人专属 Agent 的短期原文生命周期；主 Session 语义整理、Life Memory、好友画像仍是各自现有来源，**尚未实现跨来源的完整语义纠错或统一遗忘审计**。

## 当前开发预览：2.7.1-dev.1 视频评论区只读生活体验

- [真实评论区浏览、楼中楼只读预算、可信阅读回执与暂时主观反应](./2.7.1-dev1-video-discussion-life.md) · [实际生产接线 Mermaid](./diagrams/2.7.1-dev1-video-discussion-live.mmd)。自主视频轮独立决定是否阅读评论；复用现有 `bili_comments` / `bili_comment_thread`，在 Python 只读工具的实际接口结果上生成回执。`bili_discussion_note` 仅记录有本轮阅读证据的暂时问题/反应，不写兴趣档案、人物画像、长期记忆或待办；发送权限仍由原有闸门管理。**更广泛的长期认识纠错与生活契机协调仍未实施。**

## 2.7.0 正式版封版架构（继承 dev.10 生产接线）

- [统一自主社交决策、P6-A/B 续聊、好友画像、私信自由与 @ 回复权限架构](./2.7.0-unified-social-agency-plan.md) · [目标 Mermaid](./diagrams/2.7.0-social-agency-target.mmd) · [入站 @ 实际接线](./diagrams/2.7.0-incoming-at-live.mmd) · [后台私信自主决策与 P6-A/B 实际接线](./diagrams/2.7.0-dm-autonomy-live.mmd)。**`2.7.0` 封版继承入站 @、私信与公开评论/@ P6-A/B（两个公开 P6 开关默认关闭）和跨渠道互动节奏；好友证据画像已完成限定明确交流偏好与可撤回的跨 DM/评论首阶段，兴趣系统增加有限、低权重的短期开放探索。已经支持按关系阶段使用有限的明确交流画像；更丰富的长期叙事画像与兴趣自主探索仍未全部实现**；下列 2.6.2 图仍是其余渠道的现行生产调用关系。

- [dev.10 行为审计修复：私信停止联系、模型自主表达、关闭话题、待办具体对象与兴趣真实选看证据](./2.7.0-dev10-life-behavior-hardening.md) · [dev.10 实际生产 Mermaid](./diagrams/2.7.0-dev10-life-behavior-live.mmd)。本轮新增的是已有私信状态与已有兴趣档案中的**事实约束**，不是新的生活意愿层。明确停联阻断同账号 UID 的即时/延期私信；隐私请求隔离私密上下文，程序只检查出站、不填充固定答复；旧「值得看/可以看」仍参与原视频判重显示，但**不再充当兴趣自主选择证据**。旧无来源兴趣记录保留供审阅但不得进入兴趣记忆、选片或 Python 表情包排序。实际模型/B站待验收。

- [dev.8 社交推荐从模型承诺到待办保存回执的闭环](./2.7.0-dev8-social-todo-commitment.md) · [dev.8 实际生产 Mermaid](./diagrams/2.7.0-dev8-social-todo-live.mmd)。公开评论/@ 与私信共用同一模型结构化提案和原待办账本；未经核验的“记下了”不再可直接外发，冲突交回同一模型修订而非插入程序模板；最多 3 条独立只读建议、失败安全停止、无正文诊断。

- [dev.7 私信 P6 沉默续聊与诊断补齐：统一层、一次性意图、安全复核、真实生产图](./2.7.0-dev7-dm-silence-reconsideration.md) · [dev.7 实际生产 Mermaid](./diagrams/2.7.0-dev7-dm-silence-live.mmd)。模型可针对尚未结束的私信对话，在正常回复后提出一次“对方沉默再考虑”，不是默认催聊；已保留原来的当轮 `defer` 与延迟补充。只读收件箱暂时失败可有限安全延期，私信页能看到匿名预约聚合数据。

- [dev.6 创作者相遇线索、关注/收藏事实与成长统计诊断：统一层归属、权限和延后事项](./2.7.0-dev6-creator-facts-and-growth-diagnostics.md) · [实际生产 Mermaid](./diagrams/2.7.0-dev6-creator-facts-live.mmd)。新增 B站自主选看后按真实创作者累积相遇线索；关注当前态按单目标 B站 API 查询，与本插件已有关注/取关/收藏的历史回执严格区分。旧推荐功能重构已延后，默认外发权限不变。

- [dev.5 人物详情中的关系分层画像与多平台身份预留：统一层归属、隐私、覆盖矩阵](./2.7.0-dev5-person-portrait-multiplatform.md) · [实际生产 Mermaid](./diagrams/2.7.0-dev5-person-portrait-live.mmd)。人物详情在「逐渐熟悉的人」逐 UID 懒加载已有证据；B站现行接线，其他平台不推测合并；自然联系人到 `known` 才能积累有限明确偏好，不能据此授予发送权。

- [dev.4 好友画像长期边界与开放好奇候选审阅：状态契约、跨渠道矩阵和失败回退](./2.7.0-dev4-portrait-curiosity-review.md) · [dev.4 实际生产 Mermaid](./diagrams/2.7.0-dev4-portrait-curiosity-live.mmd)。P6 到期再次核对可撤回的好友边界；主人可以排除/恢复短期好奇主题，不能修改长期兴趣或任何外发权限。

- [好友交流证据画像与开放好奇探索第一阶段：数据契约、隐私和覆盖矩阵](./2.7.0-dev3-portrait-open-curiosity.md) · [dev.3 实际生产 Mermaid](./diagrams/2.7.0-dev3-portrait-open-curiosity-live.mmd)。

- [公开评论/@ P6 与跨渠道发送节奏（实际生产接线、配置与风险矩阵）](./2.7.0-dev2-public-p6-rhythm.md) · [生产 Mermaid](./diagrams/2.7.0-dev2-public-p6-rhythm-live.mmd)。

## 管理中心的社交入口（2.7.0）

- [社交互动／评论／私信的页面职责、唯一设置源与折叠导航](./2.7.0-social-management-navigation.md) · [可编辑导航 Mermaid](./diagrams/2.7.0-social-management-navigation.mmd)。**本轮 UI 将评论与 DM 设置移动到记录上方并默认折叠；P6 功能与跨渠道节奏的业务行为由上述生产链路独立实现**。

## 修改任何功能之前

- [统一层归属、可以新增新层的条件与架构文档同步门禁](./2.6.2-unified-layer-change-gate.md)
- [当前系统静态审计及未完成的实机验收](./2.6.2-system-audit.md)：**审计基线是当时的开发快照**，其中标为“未实现”的能力可能在后续单独文档中已有更新；以最新代码及下方当前接线文档为准。

## 当前公共层及业务接线

| 主题 | 模块或真实状态来源 | 维护入口 |
| --- | --- | --- |
| 同一人格、成长人格、连续情绪 | `life-voice-context.mjs`、`emotional-state.mjs` | [人格上下文](./2.6.2-life-voice-context.md) · [跨渠道模拟](./2.6.2-one-fish-simulation.md) |
| B站自主关注契机与动作当前态 | `vendor/bilibili-mcp/mcp_server.py` 原账号隔离动作账本；单目标 B站平台只读核验；`verified-life-facts.mjs` 短期动作事实投影 | [dev.6 生产契约](./2.7.0-dev6-creator-facts-and-growth-diagnostics.md) |
| 可信经历与对外主张核验 | `verified-life-facts.mjs`、可信执行回执 | [统一事实、回访背景](./2.6.2-unified-facts-and-followup-context.md) |
| 可衰减记忆、分域反思 | `LifeMemoryGateway`、`memoryRetriever` | [记忆与反思权限](./life-memory-domain-reflection-v2.6.0-dev.4.md) |
| 社交身份、关系、对外权限 | `SocialContextAssembler`、`SocialPolicyGate`；按账号隔离的 `SocialPortraitGateway` 只存明确交流证据；`social-person-identity.mjs` 负责平台隔离展示键 | [关系索引](./dev9-social-relationship-memory.md) |
| 社交只读推荐意愿与已保存待办 | `interaction-batch.mjs` 的同一社交模型输出；`social-todo-intake.mjs` 来源/只读/意愿核验；`owner-todos.json` 原唯一任务账本；`social-todo-reply-contract.mjs` 保守出站一致性检查 | [dev.8 生产契约](./2.7.0-dev8-social-todo-commitment.md) |
| 自主任务、完成进度与回访 | 已接受任务账本、执行回执、意愿及发送层 | [父子探索](./2.6.1-unified-exploration-relationship-visualization.md) · [普通私信进度](./2.6.2-dm-todo-progress.md) |
| 公开评论成功回执与接收人 | `seen.md` 主账本；平台已核验的目标作者与当前账号 runtime 的确认索引，按 BV + 出站 rpid 匹配 | [公开回复接收人契约](./2.6.2-comment-recipient-receipts.md) |
| 评论/@ 的来源与时效 | 平台通知、原评论回查及接线诊断 | [原评论恢复](./2.6.2-at-original-comment-recovery.md) · [通知时间](./2.6.2-at-invitation-diagnostic-times.md) |
| 可选严格私信审核 | 仅在 `dmApprovalEnabled=true` 时识别投喂申请；默认关闭，不作为普通自主交流的前置条件 | [私信自主决策与 P6-A/B](./2.7.0-unified-social-agency-plan.md) |
| 后台普通私信与主人专属 Agent 的短期聊天原文保留 | `dm-context-retention.mjs` 控制普通私信的 14 天近期原文和 7 天旧来信片段，`owner-dm-agent.mjs` 控制主人专用短期会话；不会影响主 Session 语义记忆、Life Memory、好友画像、拒联及收件去重 | [2.7.1-dev.2 记忆治理接线](./2.7.1-dev2-dm-memory-governance.md) |
| 生活行动契机首批只读闭环 | `life-opportunities.mjs` 合并当前账号的真实评论观察、多日自主选片兴趣、公开评论交流偏好；复用原 `AutonomousPlanner` 意愿与限额。BV 元数据真实回执可成为下一轮视频弱线索，公开人物只在本地复核、不主动联系 | [dev.3 实际生产契约](./2.7.1-dev3-life-opportunities.md) |
| 自主视频轮评论区只读生活体验 | 原 Python `bili_comments`/`bili_comment_thread`，受本轮根评论关联与读预算约束；只读 `video-discussion-reads` 最小回执及可选临时反应 | [dev.1 实际生产契约](./2.7.1-dev1-video-discussion-life.md) |
| 视频资料、情绪与意愿边界 | 字幕／视觉证据、当前情绪状态 | [视觉和情绪优化](./2.6.2-vision-emotion-willingness.md) |
| 账号与数据可靠性 | 账号绑定、备份校验、只读预算 | [账号切换](./2.6.1-account-identity-switch.md) · [备份兼容](./2.6.1-backup-utf8-compatibility.md) · [轮询与管理 UI](./2.6.2-polling-memory-ui.md) |

**事实 ≠ 意愿 ≠ 权限 ≠ 已发送。** 完成任务的成功回执可在合规渠道查询，不应等待回访发送；人格、情绪、事实和可衰减记忆必须使用现有统一层，不能在各聊天入口重复拼装。关系熟悉度不自动授予对外发送权限。

## 事实与人格契约的当前边界

`VerifiedLifeFacts` 已经是自动发言的共享**高置信事实校验接口**，目前支持按视频 BV、视觉／听觉类型匹配成功回执，但不是任意自然语言的全语义判真服务。未能明确对应视频的肯定经历不会借用其他视频的证据；完整视听必须有额外的真实完整回执。详情见 [统一事实与回访契约](./2.6.2-unified-facts-and-followup-context.md)。

`Life Voice Context` 是自动生成文字时的人格、成长与连续情绪的唯一装配层。各场景只追加任务事实、互动历史与授权相关数据，不能重新在模型提示中拼一份情绪／成长描述。主 Session 的长期记忆检索与稳定成长人设是不同职责。详情见 [人格上下文](./2.6.2-life-voice-context.md)。

## 当前图（编辑源优先）

- [开发者架构 Mermaid](./diagrams/2.6.2-life-system-current.mmd) · [SVG](./diagrams/2.6.2-life-system-current.svg)
- [用户理解版 Mermaid](./diagrams/2.6.2-life-system-user.mmd) · [SVG](./diagrams/2.6.2-life-system-user.svg)
- [统一人格 Mermaid](./diagrams/2.6.2-life-voice-unified.mmd)
- [事实和外发 Mermaid](./diagrams/2.6.2-verified-facts-outbound.mmd) · [SVG](./diagrams/2.6.2-verified-facts-outbound.svg)
- [@ 原评论恢复 Mermaid](./diagrams/2.6.2-at-comment-recovery.mmd)
- [Life Memory 六层 Mermaid](./life-memory-overview-v2.6.0-dev.4.mmd) · [SVG](./life-memory-overview-v2.6.0-dev.4.svg)

修改生产调用图时必须检查图中所称“当前已实现”与源码一致；不能仅更新图、不更新代码，也不能把计划图冒充实现图。

## 历史基准（保留审计，不是最新运行图）

- [2.6.0-dev.4 全业务架构审计](./system-architecture-audit-v2.6.0-dev.4.md) · [补充审计](./AUDIT_v2.6.0-dev.4.md)
- [业务入口](./diagrams/business-entrypoints-v2.6.0-dev.4.mmd) · [评论与私信](./diagrams/social-interaction-current-v2.6.0-dev.4.mmd) · [记忆同步](./diagrams/memory-event-sync-current-v2.6.0-dev.4.mmd)
- [已实施统一层（当时）](./diagrams/implemented-unification-v2.6.0-dev.4.mmd) · [统一层目标（当时）](./diagrams/unified-layers-target-v2.6.0-dev.4.mmd)
- [早期首次引导](./first-start-and-headless-gate-v2.6.0-dev.4.md) · [早期推荐设置](./recommended-settings-v2.6.0-dev.4.md)
- [早期自主任务与回访](./2.6.1-accepted-task-followup.md) · [历史提案，不是现行真值](./2.6.2-verified-life-events-proposal.md)

旧版规划、重复说明和未使用草稿的清理清单参见 [历史文档索引](../archive/README.md)。正式版本说明参见 [发布文档](../release/README.md)。
