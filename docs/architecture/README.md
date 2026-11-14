> **2.8.1-dev.2c 视觉模式统一（开发预览）：** [DSH/Ollama 两路识图、统一大肥鱼原图人工验收与旧 Endpoint 退役](2.8.1-video-perception-dev2c.md)。历史 auto/复用视觉设置升级后需重新明确启用。

> **2.8.1-dev.2b 开发预览（2026-11-14）：** [可选本机视觉模型安装、自检、使用边界与开源参考](2.8.1-video-perception-dev2b.md)。Ollama 仍须用户自行安装；MiniCPM-V 4.7 部分版本兼容性待验证。

> **2.8.1-dev.2a 实施入口（2026-11-14）：** [视频感知证据协议、分阶段开发与本地 MiniCPM-V / Qwen3.5 一键安装规格](2.8.1-video-perception-dev2a.md)。仅首批只读证据合同已接线；不代表本地视觉模型安装器已实现。

# 2.8.0 现行架构与开发历史

**当前源码版本：2.8.0。** 现行事实请优先阅读 [Life 当前接线](life-system-current.md)、[统一行动协议](2.8.0-unified-life-action-protocol.md) 和 [2.8.0 发布与实机验收记录](2.8.0-final-release-audit-20261114.md)。下方按 `dev.N` 命名的节点为**历史增量文档**；其中的“当前”“未正式发布”等措辞只适用于对应开发阶段，不描述今天的版本号。

---

## 2.8.0-dev.17 用户最新源码基线修订

[多气泡自然分段、主人额度排除、持久互动节奏卡片和 ZIP 基线补丁](2.8.0-dev17-uploaded-zip-quota-burst.md)。仍需真实 Windows/B站验收。

## 2.8.0-dev.17 当前增量（基于 dev.16）

[网络退避恢复、主人私信 10 秒快通道接线、短反馈上下文锚定与 Windows 测试修复](2.8.0-dev17-network-backoff-fast-dm-recovery.md)。这是源码与日志驱动的离线修复；真实 Windows／B站连接恢复验收仍需完成。

## 2.8.0-dev.16 当前增量入口（优先阅读）

[同一 Life 意愿的兼容视频多动作／私信缓冲跨进程保护／公开场合隐私](2.8.0-dev16-composable-writes-private-memory.md)。此版本仍是开发预览，**未通过** Windows／真实 B站／真实模型服务商／72 小时验收。历史文档下方即使写着“当前”，也按其开发时间看作历史。

**2.8.0-dev.16 私信按段经历提炼（当前交付）：** [临时双向缓冲、AI 按段整理、可衰减经历与原有反思](2.8.0-dev16-private-conversation-extraction.md)。以用户上传源码为基线修复普通/主人私信真实回执与自然收尾接线；原文仅短期保留，统计按账号隔离。未完成 Windows/B站实机验收。

**2.8.0-dev.16 当前增量：** [私信可衰减共同交流、私密反思与跨渠道熟人理解](2.8.0-dev16-private-relationship-memory.md)。仅供同一账号、同一 UID 关系理解，绝不把私聊直接公开；真实平台及完整语义隐私仍待验收。

> **2.8.0 最新开发收口（基线 dev.16）**：统一 Life 意愿、私信渐进表达、主人对话接力、10–60 秒活跃轮询、跨日记忆与成长诊断现行入口分别参见 [dev.16 架构](2.8.0-dev16-dm-progressive-fast-poll-life-rest.md)、[统一 Life 行动协议](2.8.0-unified-life-action-protocol.md)、[当前 Life 接线](life-system-current.md) 和 [发布就绪审计](2.8.0-release-readiness.md)。正式版仍需 Windows、B站、长时稳定性和完整安全回归；以下 dev.13/12/10 等说明均为历史开发节点。

> **历史 2.8.0-dev.13 发布前审计**：Life 成长数据可视化与双向证据链只读诊断，尚未证明真实行为因果；详见 [dev.13 自然自由度与成长闭环审计](./2.8.0-dev13-growth-audit-closeout.md)。Windows/真实 B站/72h/历史失败仍为正式发布阻断项。

> **当前 2.8.0-dev.12 自然 Life 开发预览**：开放式评论后 Episode、经核验增量才主动继续、单次可选后续章节、已证实评论者公开作品只读候选、匿名成长归因及 npm 常驻状态。详见 [dev.12 设计和验收](./2.8.0-dev12-natural-life-design.md)；真实 Windows/B站/模型、跨日长期因果仍未验收。

**2.8.0-dev.10 跨场景意愿与发送闭环：** [可信评论沉默、分离行动/表达意愿、公开证据仲裁、视频与社交 FIFO、精确外发凭据及回执语义](2.8.0-dev10-cross-scene-autonomy.md)。当前开发预览，未真实平台验收。

**2.8.0-dev.9 唯一意愿协议：** [统一的视频观察、Life 一次意愿、可信行动凭据与跨渠道安全矩阵](2.8.0-unified-life-action-protocol.md)。本版将原 2.8.1 计划中的 P0 统一机制纳入 2.8.0 开发预览，尚未真实平台验收。

**2.8.0-dev.8 视频探索互动接线与 npm 更新提示：** [现行设计、权限与回归](2.8.0-dev8-video-entry-and-update.md)。保留原账号意愿账本、原外发与平台回执边界；非正式版、未做真实 Windows/B站验收。

**2.8.0-dev.7 界面收口（不改变模型或写入门禁）：** 行动树与真实生活时间线在「鱼鱼正在做」同一张卡片显示；「鱼鱼想做」提供三句话区分线索、契机和已接待办。此段是 dev.7 历史说明；视频续行、主人 DM 和统一契约已在 dev.9 迁移，Vue 重构仍属后续研究。

**2.8.0-dev.6：** [一项行为一次 Life 意愿、原任务执行和新证据续行的边界](2.8.0-dev6-single-intent-actions.md)。已接受的立即只读任务不再由第二模型投票，陌生账号/外发权限依旧安全复核；真实平台待验。

**2.8.0-dev.5：** [真实私信作品邀请 → 已接受只读待办的即时 Life 自主考虑与本机时区时间线](2.8.0-dev5-dm-work-acceptance-wake.md)。不强迫观看、不绕过外发门禁或模型退避；真实环境待验。

**2.8.0-dev.3 历代正式版备份协议兼容审计：** [第一代无签名与第二代 SHA-256 备份、安全恢复确认及管理界面调整](2.8.0-dev3-official-backup-compatibility.md)。这属于代码与离线协议测试，不替代真实 Windows/旧资料恢复验收。

> **2.8.0-dev.1 发布审计与目前未完成的门禁**：参见 [2.8.0 发布就绪审计](2.8.0-release-readiness.md)。当前仍是开发预览，未正式发布。

**当前开发预览 dev.77：** [历史生活记录状态说明、来源直达与 Life 管理页实时事件流](2.7.1-dev77-life-owner-realtime.md)。真实 Windows DSH/B站长时运行尚未验收，不可发布正式 2.7.1。

**当前开发预览 dev.76：** [安全跨轮主评论机会恢复、统一生活看板与十三项 RC 准入审计](2.7.1-dev76-release-readiness-and-comment-recovery.md)。仍为未发布开发版，不能代替真实 Windows/DSH、B站和跨日验收。

**上一开发预览 dev.75：** [生活决策行为审计、真实动作树、计划独立页与管理文案](2.7.1-dev75-owner-life-activity-map.md)。代码接线不等于真实平台验收，所有外发仍走原安全门禁。

**当前开发预览 dev.74：** [三维社会关系、私人联系独立资格及拒联/发送门禁](2.7.1-dev74-three-dimensional-relationships.md)，仅有离线验证，真实 Windows/B站待验。

**上一开发预览 dev.73：** [Life 生活线索/契机/待办关系、活跃度与意愿回执诊断](2.7.1-dev73-life-pace-and-decision-clarity.md)，未完成 Windows 与 B站实机验收。

**上一开发预览 dev.72：** [Life 并发公平协调、B站只读退避、生活时间线与管理 UI](2.7.1-dev72-life-fairness-and-owner-ui.md)，未完成 Windows 与平台长期验收。

# 架构文档：现行事实与历史增量（当前 2.8.0-dev.16，未发布）

**dev.71 Life 授权账本防滞留：** [过期未消费授权安全释放、发送路径结算、旧账本离线复核与状态诊断](2.7.1-dev71-life-admission-recovery.md)。已消费或旧版状态未知的批准仍需停机核查，不自动推断平台未发送，也不重放旧动作。

**dev.70 动态核验与隐藏额度恢复：** [只读核验失败自动恢复、精准楼中楼来源证明及 Life 额度边界](2.7.1-dev70-dynamic-verification-and-visible-life-quotas.md)。跨轮旧选片主评论仍需后续实现；真实外发没有自动开放。

**dev.69 自主额度与评论表达修复：** [修复 Life 评论精确授权、退休不可见只读限制、显式后台预算和主评论审阅诊断](2.7.1-dev69-social-expression-and-free-quotas.md)。不扩大任何外发权限、不重放旧未知结果。

**dev.68 评论自主意愿与技术空轮诊断：** [取消隐藏的陌生人考虑额度、精确释放旧延期与视频技术退避辨析](2.7.1-dev68-social-choice-and-idle-diagnostics.md)。保留原有外发权限、真实来源核验、幂等和安全校验。

**dev.67 生活日记与记忆图谱显示修复：** [真实生活事件投影、决策日志边界及记忆点阵等比交互](2.7.1-dev67-life-diary-neural-visuals.md)。本轮只是可视化与交付规范更新，Life 决策／社交执行／记忆事实源接线不变。

**dev.66 视频与社交诊断增量：** [视频工具真实回执漏斗、Life 与专业 Comment Agent 边界及 MCP 安全修复](2.7.1-dev66-video-funnel-social-integrity.md)。本轮修改只改善视频探索目标、诊断数据流与显式修复完整性；外发权限和实际社交调度所有权不变。

**历史开发版本 2.7.1-dev.71：** 上述为当前未发布源码增量，唯一可信动作回执、授权及账号隔离继续遵循 [实际架构](CURRENT-ARCHITECTURE.md)。

**历史开发版本 2.7.1-dev.62：** [生活时间线可信关联、真实选片记账时刻](2.7.1-dev62-life-timeline-provenance.md)。

**dev.61 既有主评论整改：** [Life 主评论、入选证据、委派故障与旧章程一致性](2.7.1-dev61-life-state-comment-repair.md)。原 dev.60 社交恢复继续保留，模型错误不算主动沉默。

**先看唯一当前事实源：** [CURRENT-ARCHITECTURE.md](CURRENT-ARCHITECTURE.md) · [CURRENT-RC-ACCEPTANCE.md](CURRENT-RC-ACCEPTANCE.md)。
旧版文档均是**当时的开发增量或历史设计**，其中保留的“当前/已实现”字样不应被理解为 dev.73 的实际开发接线。请勿通过旧迁移/影子说明重新启用退役入口。

---

## 历史开发版本（当时） 2.7.1-dev.58：模型配置页 Provider 下拉渲染修复（未发布）

- [dev.58 DOM 选项节点复用缺陷与测试](2.7.1-dev58-provider-dom-options.md)：修复默认及八项任务 Provider 下拉因跨 select 重用同一批 option 节点而被浏览器搬空；没有改变 DSH 模型发现、Life 意愿、发送权限或记忆数据流。

## 历史开发版本 2.7.1-dev.57：Life 模型故障归因与 Provider 发现（未发布）

- [dev.57 模型失败退避与主人管理](2.7.1-dev57-life-model-backoff-and-catalog.md)：退避倒计时、连续失败次数、故障类别、HTTP 状态与请求 ID 仅安全只读显示；确认后可清理仅 Life 规划模型的失败退避，绝不直接重试或解除发送权限；Provider 下拉恢复 DSH 当前模型与保存历史标识（标识不代表连接可用）。`duty.md` 继续作为可定制视频工作章程，但每日入选额度以代码规则为准。

## 历史开发版本 2.7.1-dev.56：统一 Life 意愿归属与连续经历（未发布）

- [dev.56 Life 独立意愿、社交影子比较退役与因果证据时间线](2.7.1-dev56-life-owned-intentions-and-journeys.md)：统一视频原创评论和 DM/Comment 草稿的 Life 最终表达归属、保留发送权限；active 社交快速考虑只执行单次模型选择；无法证明关联的记录不强行连线。部分专业能力的主动多行为规划尚未完整迁移。

## 历史开发版本 2.7.1-dev.55：取消旧每日选片数量限制（未发布）

- [dev.55 日选片 50 条旧章程误拦修复](2.7.1-dev55-daily-pick-quota-retirement.md)：不再因今日入选总数停止读字幕或核验详情；无日报每天一次的视频轮次隐藏限制移除。仍有模型/视频启动节奏及平台读取预算，不增加任何外发授权。

## 历史开发版本（当时） 2.7.1-dev.54：Life 自动恢复与主人管理界面（未发布）

- [dev.54 Life 调度恢复、真实 BV/UID 时间线、默认模型 UI、神经检索、梗证据与设置简化](2.7.1-dev54-life-recovery-and-owner-ui.md)：仍待真实 Windows DSH / B站长时验收，不新增外发授权。

## 历史开发版本（当时） 2.7.1-dev.53：神经高维语义搜索与 Life 调度可观测性（未发布）

- [dev.53 神经回忆场、真实高维余弦关系、主评论审批与 Life 健康](./2.7.1-dev53-semantic-recall-comment-health.md)：全屏可直接输入搜索；本地 Embedding 可用时，用查询向量同基 PCA 投影与真实余弦分数驱动连线，3D 距离只作空间展示；无模型显式回退关键词。修复真实向量索引 ID/匿名节点 ID 错位；评论拒绝与延期/技术异常分开记录；Life 今日额度、心跳、下次考虑公开只读，真正异常显示告警。**未新增人格卡片、外发授权或自动发言；Windows 实机及长期成长待验收**。

## 历史开发版本（当时） 2.7.1-dev.52：Life 行为证据脉络、评论回复与私信读取治理

- [dev.52 评论事务、证据可视化、回复可用性和文档界面](./2.7.1-dev52-life-evidence-and-reply-recovery.md)：已核验入站评论不被主动联系冷却误拦；人工复核重试不伪造旧 Life 决策证明；私信读取按关系控制无变化详情扫描；真实经历、生活线索、兴趣与行为仅通过可信 BV 建立来源连线；生活时间线移除过度诊断。

## 历史开发版本（当时） 2.7.1-dev.51：全量神经记忆图谱与聊天内短暂停顿续聊

- [dev.51 神经回忆全景、高密度绘图、Life 自主短暂停顿接话与实机边界](./2.7.1-dev51-neural-atlas-short-pause.md)：默认 1000，可选 2000/10000 个**可回忆**节点；搜索命中有色、非命中变灰、按真实衰减阶段调节亮度，三种来源连线只显示有证据的边，搜索 3D 聚焦；主人在原 Session 回复后暂停约 90 秒由 Life 自主决定是否续上，不占长时联系冷却／额度，外部权限不变。
## 历史开发版本（当时） 2.7.1-dev.50：视频节奏、主人 UID、主 Session 工具和记忆衰减

- [dev.50 视频节奏、主人 UID、主 Session 工具和记忆衰减](./2.7.1-dev50-owner-video-memory.md)：视频最短启动间隔可配置为 1～1440 分钟（旧值保留），每轮阅读／挑选为软参考目标，首次设置可明确保存唯一主人，移除 DSH 工具不支持的 `minItems/maxItems`，3D 节点明暗反映已记录记忆阶段；未增加外发授权。
## 历史开发版本（当时） 2.7.1-dev.49：三维神经回忆场与逐渠道后台状态（未发布）

[dev.49 三维视图、Embedding PCA 只读空间投影、点击选中与健康状态实现边界](2.7.1-dev49-neural-3d-and-channel-health.md)。不重新生成 embedding、不显示内部向量、不引入另一套记忆。行为/权限不变；`releaseReady:false`。

## 历史开发版本（当时） 2.7.1-dev.48：Life 自主选择公开补读、神经回忆与后台技术健康（未发布）

[dev.48 生产接线、真实证据约束与已知未完成范围](2.7.1-dev48-neural-recall-and-social-reads.md)。不新增 Life 数据库、子 Agent 或私信发送渠道，旧许可不迁移开启；系统状态取已有本地快照。Windows/B站实机未验收，`releaseReady:false`。

## 历史开发版本（当时） 2.7.1-dev.47：Life 可读生活时间线（未发布）

[社交快速考虑与子 Agent 调度关系、生活时间线安全原因类别、可信回执边界](2.7.1-dev47-owner-readable-life-timeline.md)。这是从原 LifeAgentEvents 投影的只读用户卡片，不新增社交所有权或发送权限，`releaseReady:false`。

## 历史开发版本（当时） 2.7.1-dev.46：Life 全动作解释日志（未发布）

[dev.46 Life 决策细节、模型输入来源/指纹、社交事件逐项结算与隐私边界](2.7.1-dev46-life-decision-explain.md)。此日志不保存私信正文或模型隐藏思考，也不伪造平台发送回执。

## 历史开发版本（当时） 2.7.1-dev.45：私信平台限流与交流默认值（未发布）

[dev.45 统一 -509 读取限流、请求观测及卡片式交流权限](2.7.1-dev45-dm-read-budget-and-owner-defaults.md)。本版仍为开发预览，不把主 Session/微信真实气泡与 B站送达视作已验收。

# 历史开发版本（当时） 2.7.1-dev.44：自主交流边界、沉默续聊与后台恢复（未发布）

[dev.44 代码接线与限制](2.7.1-dev44-contact-and-recovery.md)：联系人配置卡片只控制允许交流的时间和额度；Main Session/主人私信可分别授权沉默续聊；统一联系尝试账本、Life 调度心跳、B站 -509/DNS 持久网络退避及插件本地配置保存确认。实机行为仍待验收，`releaseReady:false`。

## 历史开发版本（当时） 2.7.1-dev.43：统一自然多气泡输出（未发布）

- 普通私信、主人私信、主 Session 共用 `message-burst` 协议和 P6-A 条数设置。
- 主 Session 的多气泡属于一个逻辑回复批次，后续消息用连续续步 Turn 保证 DSH Chat 紧凑视图逐条显示。
- B站逐气泡回执未知时停止，不自动重发；真实 Windows/B站验收待完成。
- 详见 [dev.43 统一自然多气泡架构](2.7.1-dev43-shared-message-burst.md)。

## 历史开发版本（当时） 2.7.1-dev.42：主 Session 可选自主联系（未发布）

[Owner chat architecture, opt-in, evidence, cooldown, session delivery boundary](./2.7.1-dev42-main-session-self-initiated-chat.md) and [P6-A DM diagnostics and living Life Voice](./2.7.1-dev42-main-chat-style-p6-diagnostics.md). Host followup is **not** a verified outgoing chat bubble; no WeChat adapter was added.

## 历史开发版本（当时） 2.7.1-dev.41：视频 Agent 启动间隔可配置

[配置契约、启动门禁、旧设置保护与离线验收](./2.7.1-dev41-video-agent-configurable-interval.md)：dev.41 当时默认 20 分钟、允许 20～1440 分钟；dev.50 已放开到 1～1440 分钟，旧值保留；自动与手动启动共用同一账号级真实启动冷却，且独立于 Life 模型考虑频率。`releaseReady:false`，Windows／真实 B站尚待验收。

## dev.40 同版本维护：Life 管理页旧开发选项清理

[管理界面清理与兼容边界](./2.7.1-dev40-closure-fix06-life-settings-cleanup.md)：移除普通 Life 页的开发者折叠、影子对照、模拟演示和迁移演练；保留真实视频 Agent 手动入口，并把评论者公开投稿只读授权放回评论设置。仅 UI 调整，架构接线未变；旧配置不重置，`releaseReady:false`。

## 历史开发版本（当时） 2.7.1-dev.40：动态候选、子 Agent 连续取证与跨 Agent 公开 Episode 桥

[dev.40 各入口自由决策／连续性详细审计](./2.7.1-dev40-autonomy-and-continuity-audit.md)：视频／私信／评论／主人私信／待办／自主社交／反思均按当前实际能力决定下一步，且共享受权限裁剪的 Episode；评论和私信有界连续只读取证；视频与评论可沿同 BV 的真实回执关联。**尚不代表全部 Agent 具备无限或完整开放式跨轮行动**。发布未获批准，Windows 与真实 B站未验收。

## 历史开发版本（当时） 2.7.1-dev.39：专业 Agent 续行交接扩展（未发布）

[dev.39 各入口源码覆盖矩阵、自主程度与未达标事项](./2.7.1-dev39-cross-agent-continuity-audit.md)。主人私信、待办、回访、社交快速唤醒和公开反思获得不同权限范围的 Episode 上下文；不是新增万能工具或全部 Agent 开放式持续循环。源码离线测试不能代替 Windows/B站验收；`releaseReady:false`。

## 历史开发版本（当时） 2.7.1-dev.38：专业 Agent 持续性（未发布）

[专业 Agent Episode 动作持续性与私信联系人关注（第一阶段）](./2.7.1-dev38-subagent-action-continuity.md)。视频、私信和公开评论读取按来源裁剪的 Life Episode 摘要；长期可信好友私信可在模型自主决策后提出关注候选，只有独立授权、原 Life 再决定和 B站关系读回均通过才执行并入账。待办、反思及自由社交尚未全量迁移成通用 Agent 内部多步决策循环，Windows/B站未实机验收；`releaseReady:false`。

## dev.37 同版本维护：评论意愿先选后补记（未发布）

[实际 `picked=1 / reviewRejected=1` 的跨语言原因和修复](./2.7.1-dev37-episode-comment-recovery.md#2026-11-08-同版本-s0-修复已入选后补登记被误拒)。Python 入选工具即使看到本轮已经记过的 BV，也只跳过重复写文件，不再挡住本轮只读意愿补记；宿主继续查账号、轮次、真实新入选与一次性去重。真实评论发布仍待验收，`releaseReady:false`。

## dev.37 同版本维护：Life 指挥专业 Agent 的源码审计与协调保护（未发布）

[编排覆盖矩阵、四项缺陷修复、剩余架构边界与测试](./2.7.1-dev37-life-agent-coordination-audit.md)。普通 Life 休息不再随机暂停其他 Episode；视频 Agent 的二次意愿判定后重新核验账号和能力状态，人工视频启动与 Life 共享 20 分钟启动间隔（不阻断已完成反馈只读考虑）；失败原因保留安全枚举。实际统一能力注册表只有视频，待办/反思和私信/评论仍保留专业调度；`releaseReady:false`。

- [**dev.37 同版本 Episode 续行与主评论考虑修复**](./2.7.1-dev37-episode-comment-recovery.md)：到期自愿暂停恢复优先候选；选片时可附带只读评论意愿；各写入门禁不变。
- [**dev.37 发布验收代码修复与 S0/S1 现场执行**](./2.7.1-dev37-release-acceptance.md)：唤醒按钮修复、只读匿名证据导出、真实 Windows/B站/账号/72h/GGUF 验收步骤；未完成外部验收不能宣布发布。
- [**dev.37 行动归属与原回执闭环**](./2.7.1-dev37-unified-action-ownership.md)：专业 Agent 保留执行权、统一来源和回执归属、待办/反思/社交跨片段去重；实机验证限制。
## 历史开发版本 2.7.1-dev.37：统一自主生活 Episode（未发布）

[可编辑 Universal Life Episode 源图](./diagrams/life-universal-episodes-current.mmd) · [源码与行为契约](./2.7.1-dev36-universal-life-episodes.md) · [自动渲染的四张全景图](./life-system-current-view.md)。只有当前账号真实行动/回执才能计入已核验 Episode；管理中心会提示首步超过 60 分钟未推进及缺少可执行原意愿的片段。Life 可在下一轮自主选择 `resume_episode`，也可休息；B站评论、关注等仍由原权限和平台核验控制，`releaseReady:false`。

## 历史开发版本 2.7.1-dev.35：Life Episode P1/P2 自然互动（开发预览）

[Episode 写入后继续只读／休息、安全再写、额外首页、评论区只读与跨步记忆](./2.7.1-dev35-life-episode-p1p2.md)。已实现的功能与长期未实机验证的效果分开标注；主 Mermaid 图、候选图、回执记忆图均需保持同步，`releaseReady:false`。

## 历史 Life 全景图与源码接线审计（当时为 dev.37）

**优先阅读**：[GitHub 可直接渲染的完整 Life 图](./life-system-current-view.md) · [Life 完整源码关系与审计矩阵](./life-system-current.md) · [可编辑的 Mermaid 全景图](./diagrams/life-system-current.mmd) · [todos / cues / intentions / opportunities 等候选字典图](./diagrams/life-candidates-current.mmd) · [可信行动回执与记忆闭环图](./diagrams/life-receipt-memory-current.mmd)。这四张图用实际生产代码锚点校验；`npm run check:life-architecture` 和相关 Node 回归用于避免图与实现明显脱节。仍有未完全接通的渠道、模型实机及 72h 验收，`releaseReady:false`。

## 历史开发版本 2.7.1-dev.34：连续 Life Episode 与评论 P0 阻断分类（未发布）

[Life Episode、首页候选续行与五步边界](./life-system-current.md#dev34--连续-life-episode-与原创评论-p0-门禁分类) · [完整 Mermaid 源图](./diagrams/life-system-current.mmd)。一次首页闲逛或可信探索可进入同一账号绑定意愿，最多五个已核验步骤；每步重新交由 Life 决策，排除重复 BV，允许自愿休息或结束。已知跨渠道评论冷却仅在同账号下重考虑一次，技术阻断不再伪装成主动拒绝。没有新增 Agent、任务库、评论授权或平台自动重发；真实 Windows/B站/72h 仍待验收，`releaseReady:false`。

## dev.33 同版本维护修复 · @ 提及边界与 Life 事实纠错（未发布）

[真实评论入口、历史记忆及后续续聊边界](./2.7.1-dev33-mention-memory-hotfix.md) · [Mermaid 处理图](./diagrams/2.7.1-dev33-mention-memory-hotfix.mmd)。解决“@大肥鱼怒了看看”昵称不可靠边界时，把内部诊断字样当成对方说话并污染人生记忆的 Bug；仍可回忆的经历校正为不能确认正文的 @ 提及，已完成回复事实保留。`releaseReady:false`。

## 历史开发版本（当时） 2.7.1-dev.33：首页闲逛独立决策与候选来源精确归因（未发布）

[dev.33 生产接线、匿名来源归因与安全边界](./2.7.1-dev33-home-browse-attribution.md) · [Mermaid 可编辑流程](./diagrams/2.7.1-dev33-home-browse-attribution.mmd)。Life `browse_home` 不再依赖匿名事件或 `quiet-window` 成功入队；原账号、Life active、视频能力、20 分钟间隔与首页推荐开关仍是硬门禁。首页工具返回 BV 与本轮新增入选 BV 精确匹配，持久化只保留来源数量，轮次哈希在完成时清除。没有新 Agent、模型计费、定时器或写权限；仍需 Windows/B站/72h 实机验收，`releaseReady:false`。

## 历史开发版本 2.7.1-dev.32：Life 首页候选真实读取回执（未发布）

[dev.32 生产读回与账号绑定说明](./2.7.1-dev32-home-feed-receipts.md) · [Mermaid 可编辑流程](./diagrams/2.7.1-dev32-home-feed-observation.mmd)。Life `browse_home` 不等于实际调用首页推荐或观看成功；现可在原视频轮次里分别看到首页工具真实调用状态、有效 BV 候选数量和原选片账本新增数量。无新首页 Agent、无额外模型计费、无外发授权扩张；仍需 Windows/B站/72h 实机验收，`releaseReady:false`。

## 历史开发版本 2.7.1-dev.31：Life 真实反思就绪 / 模型失败退避 / 自由逛首页

[dev.31 生产代码接线、权限与实机验收](./2.7.1-dev31-life-idle-and-home-browse.md) · [Mermaid 决策图](./diagrams/2.7.1-dev31-life-activity-recovery.mmd)。针对真实 33 轮 DEBUG 中的空转：反思现在必须经过与执行器一致的有效性判定；模型失败自动退避不再在短周期里重复扣额；没有兴趣候选时鱼鱼依然可自主选择首页闲逛，由**原**视频 Agent 使用真实首页推荐。模型自己可选休息、不强制刷片；基础身份无法建立与原写入权限不放宽。该版本仍需 Windows／真实模型／B站／72小时验收；`releaseReady:false`。

## 历史版本 2.7.1-dev.30：真实读写行动的统一入记忆与本地模型状态修复


[dev.30 已核验行动／衰减／向量召回架构](./2.7.1-dev30-verified-life-action-memory.md) · [可编辑 Mermaid 数据流](./diagrams/2.7.1-dev30-verified-actions-recall.mmd)。Life 实际执行并经原平台/账本验证的读取、分享、互动进入原可衰减 Life 记忆与 Recall Service；旧已确认分享可安全补录。账号、UID/隐私、遗忘及未知回执边界不变。已安装模型重检改为只读状态刷新，无任务时隐藏安装/索引进度。仍需 Windows/真实模型/B站验收；`releaseReady:false`。

## 历史版本 2.7.1-dev.29：Life 子系统关系、可选语义安装与视频推荐接续

[系统关系、首次模型安装与推荐续聊修复](./2.7.1-dev29-life-subsystems-and-video-link-handoff.md) · [全系统图](./diagrams/2.7.1-dev29-life-subsystems-overview.mmd) · [推荐接续图](./diagrams/2.7.1-dev29-video-share-handoff.mmd)。单一 Life 协调专业系统；已发送的同账号同 UID 分享回执比模糊记忆优先，旧无标签记录不冒认。依然未发布，真实 Windows/B站/本地 GGUF 运行待验收。


## 历史版本 2.7.1-dev.28：公开交流对象的自主作品探索（未发布）

[dev.28 当前生产接线、人物身份与权限边界](./2.7.1-dev28-public-person-life-exploration.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev28-public-person-life.mmd)。鱼鱼可从跨日有证据的公开交流中自主提出了解对方公开投稿的愿望；后台重新解析匿名证据，确认账号/UID/公开视频一致，把已核实 BV 加入原 Life 意愿，之后可继续探索并按 dev.27 原写入门禁表达。没有新增任意陌生人漫游或跨评论串回复许可；真实 Windows/B站仍未验收。

## 历史版本 2.7.1-dev.27：Life 安全读写连续行动（未发布）

[dev.27 主动探索写入的唯一归属与执行门禁](./2.7.1-dev27-life-continuation-writes.md) · [可编辑 Mermaid 图](./diagrams/2.7.1-dev27-life-continuation-writes.mmd)。已有公开探索的真实视频 BV 可由鱼鱼自愿选择点赞、收藏、关注作者或原创主评论，选择后同轮立即停止，绝不连续发多条；复用原平台工具、Life 意愿二次审批与回执。没有开放评论者主页、跨串回复或私信授权，仍需 Windows/B站真实验收。

## 历史开发版本（当时） 2.7.1-dev.26：有界连续生活探索与主评论逐轮诊断（未发布）

[dev.26 Life 自主续行和原创主评论诊断](./2.7.1-dev26-life-continuation-and-comment-diagnosis.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev26-life-continuation-comment.mmd)。复用原 `AutonomousPlanner`、Life 意愿和回执，只在已核验的只读探索完成后加入最多两次由鱼鱼选择的继续动作，停止/失败/额度耗尽不增加外发；管理页区分视频主评论工具是否开放以及生命周期中的提出、准入、核验。修复包移除旧报告与原创评论的耦合，迁移不更改原有 `autoComment` 授权。Windows、真实 B站和长时行为待验收。
**dev.26 修复增量：**旧视频每轮清单私信投递及 `dmMode/dmUid` 已退役，原创主评论独立授权；历史 `only` 配置迁移时不改变 `autoComment`，移除旧报告阻断；外发仍由原评论权限与 Life 门禁控制。历史文档中的 `dmMode` 只作旧行为记录。

## 历史版本 2.7.1-dev.25：带时间/意图约束的统一回忆（未发布）

[dev.25 日期、意图和权限约束架构](./2.7.1-dev25-temporal-intent-recall.md) · [可编辑 Mermaid 数据流](./diagrams/2.7.1-dev25-temporal-intent-recall.mmd)。Agent 仍自行判断是否回忆；原查询词可选补充可核验的日期、活动/交流类型。`RecallRequest` 由本机时区转换并且先经过真实数据源的账号/UID/遗忘限制，再按事件真实发生时间硬过滤，在这个子集内融合词法和可选本地 Embedding。宽泛时间线查询优先按事件发生时间排序。legacy full 和部分专用 Agent 尚未全量接线；Windows/真实模型/B站/长期运行仍未验收。

## 历史版本 2.7.1-dev.24：本地 Embedding 语义回忆（未发布）

[dev.24 本地语义回忆架构与安装边界](./2.7.1-dev24-local-embedding-recall.md) · [可编辑 Mermaid 图](./diagrams/2.7.1-dev24-local-embedding-recall.mmd)。在 dev.23 的模型主动回忆契约上，增加本地 Qwen3 Embedding + llama.cpp CPU Runtime；向量只排序当前权限过滤后的候选 ID，之后必须回到实时记忆账本重新核验。默认关闭、用户确认后下载；模型未安装/索引未就绪/运行时不可用时退回词法检索。主人公开评论成功回执账本仍为独立只读来源。真实模型推理、Windows、B站及长期生活未验收。

## 历史版本 2.7.1-dev.23：AI 主导的跨渠道主动回忆（未发布）

[dev.23 当前统一回忆接口、生产接线与未覆盖边界](./2.7.1-dev23-active-recall-unified.md) · [可编辑 Mermaid 图](./diagrams/2.7.1-dev23-active-recall.mmd)。主人私信移除规则式记忆预检索；普通私信/评论的 compact 首轮由模型给出 `recallQueries`，统一检索器依当前身份与渠道取仍可访问的长期/可衰减记忆；受信好友公开评论按需读取公开安全记忆。主人跨日公开评论仍读原成功回执账本。传统 `full` 模式及某些专业 Agent 仍有生成前装配逻辑（兼容保留），不宣称所有入口已统一或真实语义召回完善。Windows / B站 / 长期生活未验收。

## 历史版本 2.7.1-dev.22：跨日公开评论回忆与统一层边界（未发布）

[dev.22 历史接线、权限/失败边界和跨渠道矩阵](./2.7.1-dev22-public-recall-unified.md) · [可编辑 Mermaid 图](./diagrams/2.7.1-dev22-public-recall.mmd)。主人私信 `public_comments` 和主人公开评论按需回忆使用同一个成功回执主账本；公开评论回忆第二轮只能修正 `chat` 内容，不能再授权社交动作。未做向量检索、不新建存储、不开放私密记忆；Windows/真实 B站/跨日成长仍待验收。

## 历史版本 2.7.1-dev.21：主人私信主动回忆与自然事实修正（未发布）

[生产接线、检索权限和兼容边界](./2.7.1-dev21-owner-active-recall.md) · [可编辑 Mermaid 架构图](./diagrams/2.7.1-dev21-owner-recall.mmd)。主 Session 记忆开关不再阻断已验证主人私信的主动只读回忆；分步搜索、详情和近期行动回查与原事实校验对接，普通聊天提示词精简。真实模型/B站和长时行为验收尚未完成。

## 历史版本 2.7.1-dev.20：共享 Life 状态契约、主人经历回忆及低额门禁退役（未发布）

[当前唯一入口、数据流和风险边界](./2.7.1-dev20-life-contract-owner-recall.md) · [可编辑 Mermaid 架构图](./diagrams/2.7.1-dev20-life-contract-owner-recall.mmd)。Life 管全局生活协调，专业 Agent 保留授权内局部自主，状态来自原人格/情绪/兴趣/记忆/关系源；行动只由可信回执反向反馈。主人查询自己的公开经历优先读同账号记录，旧版两种低额计数门禁退役，真实平台及跨日验收待完成。历史各版图仍保留但不再标为当前。

## 历史版本 2.7.1-dev.19：真实生活时间线面向用户的展示边界（未发布）

[UI 投影原则、去重与回归](./2.7.1-dev19-owner-life-timeline.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev19-owner-life-timeline.mmd)。管理页只展示真实可读的生活事件，评论在正文已存在时不再显示第二条技术回执；可信事务和视频核验日志仍按原渠道保留，不改变外发许可或续行依据。

## 历史版本 2.7.1-dev.18：生活时间线时序修正与原创评论诊断（未发布）

[现行数据流与验收边界](./2.7.1-dev18-timeline-original-comment-diagnostics.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev18-timeline-original-comment-diagnostics.mmd)。修正毫秒时间戳排序、区分原创主评论与回复，并将报告「只发私信」和自主评论权限冲突显性化；不会隐式开启公开外发。**本轮尚未取得用户本机配置、真实视频 Agent 调用日志，不能断言无主动评论的最终原因。**

## 历史版本 2.7.1-dev.17：Life 决策诊断错误分类与影子提示（未发布）

[诊断修复与回执边界](./2.7.1-dev17-life-trace-correction.md) · [流程图](./diagrams/2.7.1-dev17-life-trace-correction.mmd)。修复未注册的视频轮次反馈误显示成「技术错误」；社交快速考虑不记录未被模型使用的视频上下文，`social-shadow-reply` 明确不表示已发送。此版未改变社交外发、模型额度、视频时钟、记忆或平台回执。

## 历史版本 2.7.1-dev.16：视频评论核验与动态恢复（未发布）

[可信评论读回、动态异常恢复与证据展示](./2.7.1-dev16-comment-receipts-recovery.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev16-comment-receipts-recovery.mmd)。顶层视频评论由平台 ID、作者、视频和原文比对，读不到并非未发送；动态重启遗留的 `publishing` 不自动重试。Life 时间线按证据源展示，原权限与限额不改。真实 B站、Windows、72 小时验收尚未执行。

## 历史版本 2.7.1-dev.15：独立视频状态／动态发布核验（未发布）

[生产数据流、核验边界及旧记录兼容](./2.7.1-dev15-independent-platform-receipts.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev15-independent-platform-receipts.mmd)。视频 Agent 内部四类可查询动作由宿主单独只读回查，生活动态额外匹配作者、ID 和正文后才成为 Life 已核验经历；未知状态继续冻结，不重新发。旧社交事务、账号权限、动态通知线索、Life 公平调度均保留；Windows/B站真实接口与 72 小时验收尚未完成。

## 历史版本 2.7.1-dev.14：统一可信行动续行（未发布）

[完成回执接线与安全边界](./2.7.1-dev14-unified-completion-continuation.md) · [Mermaid 架构图](./diagrams/2.7.1-dev14-unified-completion-continuation.mmd)。正式私信、评论等收到可靠平台回执后可触发独立 Life 再考虑；内部反思和熟人已发送回执也可触发。视频进程完成仍沿用原轮次链；动态仅 API 受理、Python 视频写入仅自报时不作完成认定。**原权限、回执及不可重发门禁不变，Windows/B站及 72 小时真实生活尚未验收。**

## 历史版本 2.7.1-dev.13：Life 公平调度、可信行动续行与时间线（未发布）

[生产数据流、恢复及安全边界](./2.7.1-dev13-life-continuation-fairness.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev13-life-continuation-fairness.mmd)。沿用 dev.12 账号事件账本，不新增行动发送器。仅可信只读执行完成触发新考虑，分类候选轮换避免单一渠道遮蔽其他来源；从账本显示真实读取回执，不代表观看或发言。Windows／真实 B站及全渠道长期队列尚待验收。

## 历史版本 2.7.1-dev.12：Life 匿名候选续行与 firststart 统一流程（未发布）

[当前接线、合同与限制](./2.7.1-dev12-life-cue-continuity-firststart.md) · [Mermaid 图](./diagrams/2.7.1-dev12-life-cue-continuity-firststart.mmd)。原账号事件账本可承载更多非视频契机并保留有界延期；firststart 合并成一个五步流程。仍非全渠道永久执行队列，真实平台与长时生活未验收。

## 历史版本 2.7.1-dev.11：多源自主生活与统一评论容量（未发布）

[实际生产架构、合同、风险和验收](./2.7.1-dev11-multi-origin-life-comments.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev11-multi-origin-life-comments.mmd)。Life 现在即使没有视频机会，也可基于**本账号有作用域的真实双向好友互动**自主考虑私信；外发需要独立启用且保留白名单、事实核验和原跨进程发送事务。所有公开评论尝试默认共用每日 1000 条上限，老用户不自动改已保存值。跨平台高频、持久统一候选池、Windows/B站实机及长程人格因果**未验收**。下方 dev.10 为历史阶段增量，任何 1/2/4 轮/天叙述均为已撤销设计。

## 历史版本 2.7.1-dev.10：生活节奏真实调度（未发布）

[档位、视频执行门禁、续行及测试](./2.7.1-dev10-life-pace-behavior.md) · [Mermaid 架构图](./diagrams/2.7.1-dev10-life-pace-behavior.mmd)。修正版安静/自然/活跃只区分生活考虑节奏；视频 Agent 的额外每日个位数轮次限制已撤销，保留 20 分钟最低启动间隔及原平台门禁。Life 仍可选择休息，不能凭“活跃”绕开平台授权。跨渠道持久候选池、Windows/B站/72小时真实验收尚未完成。

## 历史版本 2.7.1-dev.9：跨进程 Life 决策准入与设置回读（开发阶段，未发布）

[dev.9 设计与实现边界](./2.7.1-dev9-durable-life-admission.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev9-durable-life-admission.mmd)。同账号跨进程只允许一个尚未结算的 Life 意愿批准；异常中断需离线审查，不自动重试平台外发。设置本地保存新增回读验证，原生 DSH 写入失败仍可单独诊断。**持久候选池和重启后的自动续行尚未完成**，不得宣称 Life 1.0 正式验收通过。

## UI V4：快速设置页直接配置核心方案（2.7.1-dev.8，未发布）

[当前快速设置的配置与安全流](./2.7.1-dev8-inline-quick-setup.md) · [Mermaid 源图](./diagrams/2.7.1-dev8-inline-quick-setup.mmd)。快速设置不再只有跳转卡片：生活节奏、记忆/反思、私信与自主视频分享可在页内预览、确认后写入原配置。旧用户配置不自动迁移；新外发权限受账号验证与原授权门禁。V3 文档为历史增量。

## UI V3：快速设置、记忆方案与 Life 上下文容错（2.7.1-dev.8，未发布）

[当前接线、诊断、兼容与发布限制](./2.7.1-dev8-quick-setup-life-context.md)。快速设置采用导航卡，不建立配置副本；已完成的老用户只要求看一遍，不重置运行授权。`life-context-unavailable` 是技术阻断而非自主休息，可选读取失败安全降级；真实时间线不能把视频轮次统计当作已评论/关注。

## 历史版本 2.7.1-dev.8：Life 同进程意愿排他（尚未发布）

[实际接线、风险与验收](./2.7.1-dev8-life-local-admission.md) · [可编辑 Mermaid 图](./diagrams/2.7.1-dev8-life-local-admission.mmd)。对 RC10 的 140 毫秒机会窗口加同账号未结算保护，并禁止 8 候选溢出拆成多次批准；跨进程、跨重启候选续行**仍缺失**，`releaseReady=false`。以下 RC10 / RC9 为历史开发增量，非当前完整事实清单。

## RC10 · Life 同进程机会竞争与视频自主逐动作意愿（未发布）

[实际接线、边界与实机验收](./2.7.1-rc10-life-opportunity-video-action.md) · [可编辑 Mermaid](./diagrams/2.7.1-rc10-life-opportunity-video-action.mmd)。并发机会在同一 Life 意愿轮次中竞争；视频自主点赞/收藏/关注等每次必须得到 Life 的新批准，仍经过原安全门禁。**不是跨进程永久队列，也不意味着真实成长因果已经验收。**

## 2.7.1 RC9 · 统一 Life 意愿生产接线（未发布）

[实际源码接线、回执和发布阻断清单](./2.7.1-rc9-unified-life-willingness.md) · [可编辑 Mermaid 总图](./diagrams/2.7.1-rc9-unified-life-willingness.mmd)。DM、评论、回访、动态、视频分享及视频委派已共用生命意愿模型契约；当前**尚缺全局机会池、视频技能内逐动作仲裁、主人主动关怀和跨天因果验收**，保持 `releaseReady:false`。

## RC8 · 方案优先的管理中心（仍为 2.7.1-dev.7）

[架构与权限迁移说明](./2.7.1-rc8-choice-first-management.md) · [Mermaid 方案数据流](./diagrams/2.7.1-rc8-choice-first-management.mmd)。已完成：视频互动 / 私信 / 主动分享使用可选方案卡与自定义、现有配置单写源、站内外发确认；尚待 Windows 实机和真实 B站验收。

> 以下 dev.7 及更早的「当前」「最新」均指其撰写当时的阶段性成果；不代表 dev.25 的生产真值。现行入口与统一层契约请以上方 dev.25 结构化时间回忆及 dev.24 本地语义回忆说明为准。

## 历史开发预览：2.7.1-dev.7 RC7 · 鱼鱼此刻与图片理解（未发布）

- [真实进程内活动、图文生活方案、记忆页面划分、入站私信与评论图片的安全验证链路及实机验收](./2.7.1-rc7-life-now-vision.md) · [Mermaid 可编辑架构图](./diagrams/2.7.1-rc7-life-now-vision.mmd)。本轮不改变 Life 社交唯一归属，不复制旧记忆，`releaseReady:false`。

## 历史节点（当时权威）：2.7.1-dev.7 RC6 双渠道统一 Life 决策归属（未发布）

- [老用户与新用户统一迁移 DM / 评论、主人技能、待办回访、视频兴趣分享及未知发送冻结](./2.7.1-rc-unified-life-social-migration.md) · [生产 Mermaid 架构图](./diagrams/2.7.1-rc-unified-life-social-migration.mmd)。旧独立社交决策权**不再用于生产兜底**，原授权、记忆与适配器保留；真实 Windows/B站/72 小时验收未通过，`releaseReady:false`。以下 RC1–RC5 owner 说明是**历史阶段**，不应视为当前行为。

## 2.7.1 RC 第五轮 · 评论渠道受控 Life 归属试点（尚未正式发布）

- [社交生产所有权原子切换、旧稿失效、跨账号隔离和未知回执回滚边界](./2.7.1-rc-social-owner-controlled-cutover.md) · [Mermaid 可编辑架构图](./diagrams/2.7.1-rc-social-owner-controlled-cutover.mmd)。默认仍由旧处理器决定；维护接口仅允许评论试点，不开放 DM 交接。实际 B站、Windows 和长时间验收未完成。

## 2.7.1 RC 主人互动及回访外发门禁收口（未正式接管）

- [主人私信 Agent、指令回执、写入型待办与回访的稳定来源、防重事务及既有所有权门禁](./2.7.1-rc-owner-outbound-gate-closure.md) · [Mermaid 生产路径](./diagrams/2.7.1-rc-owner-outbound-gate-closure.mmd)。Life 仍只读社交，owner 仍为 legacy；Windows/真实 B站待验收。

## 2.7.1 RC 社交兴趣真实提示与发送事务加固（未接管）

- [跨日公开视频自主兴趣进入私信/评论真实生成提示、各入口旧 owner 复核、视频兴趣推荐私信共享事务与未知回执冻结](./2.7.1-rc-social-interest-receipt-hardening.md) · [可编辑生产 Mermaid](./diagrams/2.7.1-rc-social-interest-receipt-hardening.mmd)。旧社交 owner 保持 `legacy`，Windows 和真实 B站未验收。

## 2.7.1 RC 收口：一套生活与记忆配置、人格式证据、统一样式确认

- [有机生活套餐、新安装与老用户权限差异、人格真实回复弱观察、旧诊断隐藏和社交推荐链路状态](./2.7.1-rc-organic-life-controls.md) · [可编辑当前接线 Mermaid](./diagrams/2.7.1-rc-organic-life-controls.mmd)。仍为 `2.7.1-dev.7`，正式社交 owner 未交接，不得以页面整合冒充统一发送权；Windows／B站待验收。

## 2.7.1 RC 准入自检（尚未达到封版条件）

- [十三项自然行为与用户文案自检：实际生产链、已实现与未证实范围、RC 必须补证与验收脚本](./2.7.1-rc-preflight-13-questions.md) · [当前与目标交接示意](./diagrams/2.7.1-rc-preflight-boundaries.mmd)。未改变社交决策权或对外授权；当前 `releaseReady:false`，不应创建 RC 发布标签。

## 历史版本 2.7.1-dev.7：新 Life 总览 UI 与可回忆世界接线（开发预览）

- [dev.7 生产接线、迁移边界、跨系统读写归属、升级策略与验收缺口](./2.7.1-dev7-life-world-ui-integration.md) · [可编辑 Mermaid 生产图](./diagrams/2.7.1-dev7-life-world-live.mmd)。普通 Life 决策可读取现有兴趣和经隐私/遗忘门禁后的公开经历；管理中心新增统一总览，旧重复调度表单已退役。**社交真实发送仍为 legacy 独占**，不新增第二份状态账本，不声称已验证长程人格成长；Windows/真实 B站仍待验收。

## 历史 dev.6 增量：GitHub Issue #9 评论主账本与足迹修复

- [评论完整有界正文、梗图回执、足迹与 UID 核验 @ 的实际调用及兼容边界](./2.7.1-dev6-github-issue9-comment-footprints.md) · [Mermaid](./diagrams/2.7.1-dev6-issue9-comment-footprints.mmd)。保持现有社交旧 owner，未进行正式 Life 发送接管，Windows 与真实 B站 待验收。

## 历史版本 2.7.1-dev.6：Life 社交交接前演练与安全核查（未接管真实社交）

- [dev.6 真实生产接线、原社交路径盘点、跨进程排空、手动无发送演练、残留冻结及风险矩阵](./2.7.1-life-b-social-handoff.md) · [可编辑生产 Mermaid](./diagrams/2.7.1-life-b-social-handoff-live.mmd)。社交正式决策和发送仍由旧处理器独占，影子对照不能作为发送许可；本版未发布、未完成 Windows／B站验收。

## 历史基线 2.7.1-dev.5：Life 双节奏与分类预算

- [当前真实接线、旧生活预设显式保留、社交快速只读关注、跨进程额度、DEBUG 事件关联及风险矩阵](./2.7.1-life-a-dual-lane-budget.md) · [可编辑当前 Mermaid](./diagrams/2.7.1-life-a-dual-lane-live.mmd)。这是基于上传 `2.7.1-dev.4` 实施并标记为 `2.7.1-dev.5` 的开发增量，不表示 Phase 6 / Phase 7 全部验收，也不启用正式社交外发。下方 `dev.4` 文件是原有实现的架构记录，涉及双节奏与额度的现行行为优先参照本页。

## 历史增量：Life Agent 视频轮结束后的自主反馈与冷却恢复

- [可信视频轮结束回执如何进入同一生活决策、冷却期不误消费、忙碌诊断与安全边界](./2.7.1-dev4-life-post-video-continuity.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-life-post-video-continuity-live.mmd)。复用唯一 Life Agent、v1 事件账本及原视频 Agent，不新增发送权限；真实观看/听音、Windows/B站仍待验收。

## 历史增量：Life Agent 视频 Agent 子进程真实轮次回执与时间线

- [原视频轮次启动/退出/失败/未知的账号隔离回执、视频入选数事实来源、真实时间线与安全边界](./2.7.1-dev4-life-video-round-lifecycle.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-life-video-round-lifecycle-live.mmd)。这并不是证明作品观看/听音成功，也不开放社交发送；Windows 与真实平台仍待验收。

## 历史增量：Life Agent 内置 Python MCP 只读预约身份核验

- [跨进程误判与嵌套工具 HMAC 核验、脱敏预约拒绝原因及迁移边界](./2.7.1-dev4-life-nested-mcp-read-identity.md) · [当前 Mermaid](./diagrams/2.7.1-dev4-life-nested-mcp-read-identity-live.mmd)。同账号、同 BV、活跃执行进程仍是硬门禁；不自动清锁，不新增平台调用或外发权；Windows/真实 B站待验收。

## 历史增量：Life Agent 平台元数据真实失败追踪与无模型探测

- [跨 Python MCP 与 JS 的有界平台失败契约、同账号可信公开 BV 手动只读探测、脱敏平台错误来源](./2.7.1-dev4-life-metadata-platform-diagnostics.md) · [当前 Mermaid](./diagrams/2.7.1-dev4-life-metadata-platform-diagnostics-live.mmd)。不调用模型、不修改生活账本或发送社交内容；实际只读探测仍消耗平台请求额度，Windows/真实 B站待验收。

## 历史增量：Life Agent 自主探索只读回执与后续生活选择（未开放社交外发）

- [已结算生活契机与独立探索线索分账本语义、失败有界冷却、成功元数据后的后续自主考虑](./2.7.1-dev4-life-exploration-read-continuity.md) · [当前调用 Mermaid](./diagrams/2.7.1-dev4-life-exploration-read-continuity-live.mmd)。修复 `cues>0`、`opportunities=0` 时只读失败的错误结算；仅验证公开元数据，视频观看和社交接管仍需真实回执与独立授权。

# 当前增量：Life Agent 决策全过程 DEBUG / B站只读拒绝分类 / 旧测试入口清理

- [真实生活决策链脱敏追踪、平台拒绝分类及重复汇总、错误冻结收紧、Debug 入口和兼容说明](./2.7.1-dev4-life-decision-trace-and-read-diagnostics.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-life-decision-trace-live.mmd)。保留原生活事件、已授权只读动作及平台回执为事实源；调试记录不是第二份记忆或授权；Dev3 旧离线按钮退役。Life Agent 社交仍未接管。

## 历史增量：Life Agent 事件公平结算与影子证据门禁（社交未接管）

- [匿名生活事件逐项归属、未选中线索有界重考虑、可信只读证据仅证明“提供过”、旧社交影子短时样本诊断](./2.7.1-dev4-life-event-fairness-and-shadow-evidence.md) · [当前实际 Mermaid](./diagrams/2.7.1-dev4-life-event-fairness-shadow-live.mmd)。复用原 Life Agent／账号 v1 事件账本与原旧社交唯一 owner，未新增外发权限、社交切换开关或模型预算；Windows/真实平台待验收。

## 历史增量：Life Agent 回执边界与生活契机账本原子性（无社交接管）

- [生活契机 v1 原子写入、生活事件在执行前失败时重试/结果未知时冻结、只读失败明确返回及停机离线审查](./2.7.1-dev4-life-receipt-boundary-hardening.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-life-receipt-boundary-live.mmd)。继续复用 `AutonomousPlanner`、`life-agent-events`、`life-opportunities`，不新建状态真值或扩大权限；原 DM/评论回复器仍独占真实社交决策。Windows 与真实平台待验收。

## 历史增量：Life Agent 可靠性集成（不包含社交接管）

- [匿名生活事件的有界重试、跨进程共享模型额度/租约、公开视频元数据失败分类与短期恢复](./2.7.1-dev4-life-reliability-integration.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-life-reliability-live.mmd)。仅收紧既有 Life Agent 和既有只读契机路径，不改变旧私信/评论真实社交发送权；Windows/真实 B站 API 和 DSH Desktop 待验收。

## 历史生活决策：按本轮真实候选约束模型选择

- [Life Agent JSON 解析兼容与逐轮准确动作菜单](./2.7.1-dev4-life-decision-contract.md) · [实际调用图](./diagrams/2.7.1-dev4-life-decision-contract-live.mmd)。复用自主规划器与既有可信候选、模型额度、账号和发送门禁；格式兼容只限单个完整 JSON 代码围栏，不开放任意文本提取或额外模型重试。未执行动作仍有匿名失败诊断。

## 历史增量：dev.4 Phase 6h 社交交接排他基础（未开放真实接管）

- [旧社交路由跨进程排他检查、异常残留冻结和匿名诊断；合成子进程故障演练](./2.7.1-dev4-phase6h-social-handoff-fence.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-phase6h-social-fence-live.mmd)。只在原旧 DM/评论路由**读取**持久预约；新预约 API 尚未由生产发起，也无 Life Agent 决策或真实发送权限。Windows/真实 B站待验收。

## 历史增量：dev.4 Phase 6g 只读社交影子配对审计（待 Windows 实机）

- [同来源不可抢占、分类不可覆盖、私信/评论分渠道缺样本和分歧诊断](./2.7.1-dev4-phase6g-social-shadow-audit.md) · [生产 Mermaid](./diagrams/2.7.1-dev4-phase6g-social-audit-live.mmd)。这只是既有 Phase 5 可撤销内存影子的质量门禁，**没有**将真实社交决策权交给 Life Agent。

## 历史增量：dev.4 Phase 6f 自主调度诊断跨账号隔离（待 Windows 实机）

- [账号核验的最近决策显示、旧文件不迁移、共享模型额度不变](./2.7.1-dev4-phase6f-account-diagnostic-isolation.md) · [生产 Mermaid](./diagrams/2.7.1-dev4-phase6f-account-diagnostics-live.mmd)。未标注来源的旧历史保留在原数据/冷快照中，不误归属当前账号；不改变社交决策与外发权限。

## 历史增量：dev.4 Phase 6e/7e 自主生活可见验收（待 Windows 实机）

- [真实视频委派门禁、单列时间线与无 B站纯模拟工具](./2.7.1-dev4-life-experience-visible-acceptance.md)。明确：shadow 不通过新生活驱动启动现有视频 Agent；active 仅允许原条件下委派。模拟不能冒充真实观看或成长。

## 历史增量：dev.4 Phase 6d/7d 视频驱动归属与只读模型倾向对照（待 Windows／真实模型验收）

- [Phase 6d/7d 实际生产接线、同一设置源、显式两次模型额度与安全限制](./2.7.1-dev4-phase6d-phase7d-driver-contrast.md) · [生产 Mermaid](./diagrams/2.7.1-dev4-phase6d-phase7d-live.mmd)。只做纯模型倾向对照，**不是实际行动或人格成长因果证明**；老回复器与所有外发门禁不变。

## 历史增量：dev.4 Phase 6c 旧设置控制权 + Phase 7c 成功只读经历跨轮参考（待实机验收）

- [统一层归属、旧设置防覆盖、48h 匿名可信只读经历与真实限制](./2.7.1-dev4-phase6c-phase7c-legacy-ownership-continuity.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-phase6c-phase7c-live.mmd)。已完成的是旧入口互斥和短期决策参考，**不是全部旧模块删除或人格成长因果闭环**；上一 Phase 6b/7b 仍作为基线。

## 历史增量：dev.4 Phase 6b 排他视频时钟 + Phase 7b 关系排序对照（待实机验收）

- [影子模式旧定时器运行门禁、旧配置冲突拦截和匿名关系排序反事实标记](./2.7.1-dev4-phase6b-phase7b-schedule-growth-proof.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-phase6b-phase7b-live.mmd)。旧数据不迁移、不授权外发；关系对照不等于模型因果成长。此前 Phase 6/7a 仍作为前置基线。

## 历史开发增量：dev.4 · Phase 6 统一设置、Phase 7a 成长参考可见性（未完整验收）

- [已接线的显式生活设置保存、旧视频定时器互斥、安全边界与匿名成长参考](./2.7.1-dev4-phase6-settings-phase7-evidence.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-phase6-phase7a-live.mmd)。仍写原 `persistCfg`，保留旧配置的高级兼容入口；**没有完成全部旧调度退役、社交决策接管或成长因果闭环**。Windows 与真实模型/B站待验收。

## 历史开发预览：Phase 5 决策诊断收尾 / Phase 6 只读设置预览

- [真实决策结果分类、无候选免模型调用、历史兼容、设置只读映射与迁移安全条件](./2.7.1-dev4-choice-diagnostics-phase6-settings-preview.md) · [当前 Mermaid 接线](./diagrams/2.7.1-dev4-choice-diagnostics-settings-live.mmd)。本轮**没有**替换旧调度或社交回复者；Windows 和真实模型待验收。

## 历史 dev.4 Phase 5 增量 · 手动唤醒与匿名队列诊断

- [六小时自动防重复与手动请求区别、人工唤醒队列优先级、模拟验收、安全边界](./2.7.1-dev4-life-agent-manual-wake-hotfix.md)。本修复没有赋予 Life Agent 新的社交发送权，不改变原 Phase 5 影子上下文授权。

# 当前开发预览：2.7.1-dev.4 Phase 5 · 授权社交上下文与只读影子对照（未接管）

- [实际接线、安全边界、单独授权、匿名模型类别对照与无 B站模拟](./2.7.1-dev4-life-agent-phase5-social-shadow.md) · [Phase 5 Mermaid 生产图](./diagrams/2.7.1-dev4-life-agent-phase5-social-shadow-live.mmd)。默认不读取任何社交原文；需用户单独授权且原核验入站事件有效，才能短暂阅读好友私信或核验公开评论。二次模型调用消耗原每日额度，输出不授权外发；社交仍由原回复器独占。Windows/真实模型/真实 B站尚待验收。

## 历史开发预览：2.7.1-dev.4 Phase 4 · 社交决策所有权明确化（未接管）

- [生产入口、社交旧决策归属、账号切换保护与无 B站离线验收](./2.7.1-dev4-life-agent-phase4-social-owner.md) · [Phase 4 实际生产 Mermaid](./diagrams/2.7.1-dev4-life-agent-phase4-social-owner-live.mmd)。`off/shadow/active` 均未授予 Life Agent 社交发送权；旧 DM/评论代理仍是决策者。社交归属诊断只读、短期、不含 UID/原文。Windows 与真实 B站仍待验收。

## 历史开发预览：2.7.1-dev.4 Life Agent 第三阶段 · 生活时间线与冷备份恢复

- [已实现的同账号匿名决策时间线、旧事件 schema 无损读取、完整本地快照/校验/回滚冻结与老用户验收边界](./2.7.1-dev4-life-agent-phase3.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev4-life-agent-phase3-journal-backup-live.mmd)。旧 UI 可替换，但旧数据备份/恢复是硬约束；现有便携业务备份**不是**完整账号和私密状态快照，新增冷快照需停机且含敏感凭证。Windows/真实平台仍待验收。

## 历史开发预览：2.7.1-dev.4 Life Agent 第二阶段 · 匿名社交唤醒接入

- [第二阶段实际接线：私信/评论已核验入站事件 → 当前账号匿名生活唤醒 → 同一 Life Agent 的自主注意/沉默](./2.7.1-dev4-life-agent-phase2-social-wakes.md) · [第二阶段实际生产图](./diagrams/2.7.1-dev4-life-agent-phase2-social-wakes-live.mmd)。社交事件不再受视频启动额度限制；当前模型只看事件类型/ID/时间，**没有聊天原文，不接管原 DM/评论回复发送权，也不产生关系事实或发送许可**。仍待 Windows 和真实平台验收。

## 历史开发预览：2.7.1-dev.4 Life Agent 第一阶段已接入；完整目标仍在实施

- [统一 Life Agent 的正式架构决策与目标图](./2.7.1-dev4-life-agent-decision-adr.md) · [目标 Mermaid](./diagrams/2.7.1-dev4-life-agent-target.mmd)。选择 C：事件驱动、单主体、连续记忆成长，允许重构旧定时视频生活驱动；**目标图不等于已完成的生产接线**。

- [第一阶段已实现接线与验收](./2.7.1-dev4-life-agent-phase1.md) · [本阶段实际生产图](./diagrams/2.7.1-dev4-life-agent-phase1-live.mmd)：同一自主规划器可选择视频探索或休息；管理中心可以关闭、影子观察或接管旧自动视频轮，默认关闭。社交决策仍由旧入口处理，Windows 和真实 B站待验收。

- [后续重构与迁移细化方案](./2.7.1-dev4-unified-life-agent-refactor-plan.md)：复用原人格、记忆、关系、待办、权限和 dev.3 回执，逐步迁移社交、工具规划与成长反馈。

- [2.7.1-dev.3 · 跨语言预约、待办事务与顺路热评](./2.7.1-dev3-cross-language-execution-and-comment-followup.md)：Node/Python 同一只读预约、待办短事务锁和独立的顺路热门评论回复链。[生产图](./diagrams/2.7.1-dev3-cross-language-execution-live.mmd)。
## 历史开发预览：2.7.1-dev.3 自主待办与生活意愿的共享只读动作协调（增量）

- [2.7.1-dev.3 · 先前：共用 JS 只读执行预约与保守恢复](./2.7.1-dev3-durable-read-execution.md)：已实现跨 Node 进程只读互斥、同账号作用域、人工恢复；Python Headless 与社交写操作尚未接入。 [当前生产执行图](./diagrams/2.7.1-dev3-durable-read-execution-live.mmd)。

- [真实已接受待办、生活契机与跨轮意愿的共用动作身份、去重和执行前核验](./2.7.1-dev3-shared-action-arbitration.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev3-shared-read-actions-live.mmd)。只在原 `AutonomousPlanner` 内对**同一只读动作**协调候选；待办仍是履约账本，生活意愿仍可自然放下，外部发送权限不变。管理中心可查匿名去重而非虚假完成。新增 JS 共享调用入口已实现部分跨进程预约；独立 Python 视频 Agent、其余工具及真实 B站端到端验收仍未覆盖。

# 大肥鱼 · 当前技术架构

> 本页是维护者的**当前架构入口**，不是版本流水账。任何涉及统一层、事实源、权限、事件流、渠道接线和存储的修改，必须同步更新本页、相应说明、Mermaid 图与回归测试。根 README 始终面向用户。

- [新功能可验收性契约：触发、选择、真实回执、隐私、费用与使用者验收步骤](./acceptance-observability-contract.md)。代码测试通过不能代替用户可观察的真实行为。

## 历史界面：统一生活设置与开发诊断分层

- [普通使用只需生活开关和活跃度；旧模式、影子对照与运行诊断折叠；模型 JSON/动作无效有安全分类](./2.7.1-dev4-unified-life-agent-lifestyle-migration.md)。该界面优化不等于已完成旧社交接管或真实模型验收。

## 历史开发增量：dev.4 · Phase 6/7/8 迁移验收状态与暂停门禁（非封版）

- [基于原设置、Life Agent、跨进程交接与发送事务的只读迁移核验](./2.7.1-dev4-life-transition-readiness.md) · [生产 Mermaid](./diagrams/2.7.1-dev4-life-transition-readiness-live.mmd)。普通手动生活唤醒尊重暂停，旧社交决策者和 Phase 7/8 缺口会明确列为未完成；不会自动发送、迁移、发布或解除残留锁。

## 历史开发预览：2.7.1-dev.4 统一生活驱动与简单设置（尚非全域社交接管）

- [旧视频定时器物理退出、Life Agent 单一自主视频驱动、活跃程度预设/高级配置、老用户手动迁移和权限边界](./2.7.1-dev4-unified-life-agent-lifestyle-migration.md) · [实际接线 Mermaid](./diagrams/2.7.1-dev4-unified-life-agent-lifestyle-live.mmd)。普通社交、回访仍维持现有独立控制和发送许可；Windows/真实 B站未验收。

## 历史开发预览：2.7.1-dev.4 Phase 6 Final 集成候选（在途排空，未封版）

- [跨进程旧决策/发送在途排空、可信评论共享事务、失败保守冻结与缺口矩阵](./2.7.1-dev4-phase6-final-social-drain.md) · [实际接线 Mermaid](./diagrams/2.7.1-dev4-phase6-final-social-drain-live.mmd)。仅完成交接前的可核验条件；**未开放 Life Agent 社交接管、未完成全域写入适配、未完成 Windows 和 B站验收**。旧 6h/6ijk 文档仍用于查单项来源和历史。

## 历史开发预览：2.7.1-dev.4 Phase 6i/6j/6k 社交外发逐消息安全基础

- [旧 DM/评论发送适配器上的逐事件原子占位、可信回执、异常冻结与匿名管理诊断](./2.7.1-dev4-phase6ijk-social-send-transactions.md) · [当前生产 Mermaid](./diagrams/2.7.1-dev4-phase6ijk-send-transactions-live.mmd)。只在旧 DM/评论外发路径接入；此时 **Life Agent 社交决策和外发仍未启用**，并非生产可用的双 owner 原子交接，也不覆盖自主分享/回访等其他发送入口。Windows/真实平台仍待验收。

## 历史开发预览：2.7.1-dev.3 私密关系对自主生活的最小可信影响（增量）

- [账号绑定的好友明确兴趣与鱼鱼自己的公开兴趣交集、关系熟悉度门禁、原模型调用、只读行为与匿名验收](./2.7.1-dev3-private-affinity-life-bridge.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev3-private-affinity-life-live.mmd)。只提供最多三条**匿名共同兴趣参考**，不从私信创造搜索词、候选工单或主动联系。旧无来源账号标签的好友兴趣**不会**参与；尚未形成完整私人共同经历与主动社交机制，真实环境仍需验收。

## 历史开发预览：2.7.1-dev.3 自主生活意愿与跨场景只读探索（增量）

- [真实来源、统一决策、模型自选探索目的、公开搜索、跨轮 BV 核实、短期意愿与管理中心验收](./2.7.1-dev3-unified-life-intentions.md) · [实际生产 Mermaid](./diagrams/2.7.1-dev3-unified-life-intentions-live.mmd)。复用原 `LifeOpportunities` 状态文件、`AutonomousPlanner`、Life Voice 和只读 B站适配器。现可从**账号归属明确的跨日兴趣或真实评论疑问**形成模型自主意愿；支持继续核实 BV、按真实作者身份读取公开投稿并选另一部 BV 核实，不依赖回到刷视频轮。没有开放自主关注／私信、私人聊天意愿外传或任意工具组合。

## 历史开发预览：2.7.1-dev.3 评论感受实际工具调用链补充

- 视频 Agent 的 `bili_report_append` 可顺带提交经过同一 BV 评论阅读证据验证的**可选**临时感受；单独 `bili_discussion_note` 保留。管理中心新增“日报后未附感受”匿名计数，区别于成功/拒绝，不冒充鱼鱼的内心判断；无额外模型调用、无外发或待办权限变化。见 [dev.3 当前生活契机说明](./2.7.1-dev3-life-opportunities.md) 和 [评论只读 Mermaid](./diagrams/2.7.1-dev1-video-discussion-live.mmd)。

## 历史开发预览：2.7.1-dev.3 多来源生活契机（评论、兴趣、公开交流）

- [生产链路、数据来源、选择回执、手动验收、账号隔离、剩余风险](./2.7.1-dev3-life-opportunities.md) · [现行 Mermaid 生产图](./diagrams/2.7.1-dev3-life-opportunities-live.mmd)。现支持本账号真实非空评论阅读后临时反应、有明确账号归属的跨日自主选片趋势、当前账号公开评论中跨日有证据的交流偏好；复用现有 `AutonomousPlanner`，不另设定时器或任务账本。仅可核实原有 BV 公开元数据或在本地复核公开交流，不增加社交发送权限。无账号归属的历史兴趣不迁移为行动契机；完整长期人物语义记忆和真实 Windows/B站仍待验收。

## 历史开发预览：2.7.1-dev.2 补充：好友兴趣的时序纠错

- [白名单好友明确兴趣的历史/当前区别、弱化态度、同 UID 后续修订及原推荐安全边界](./2.7.1-dev2-friend-interest-correction.md) · [现行数据流 Mermaid](./diagrams/2.7.1-dev2-friend-interest-correction-live.mmd)。复用既有 `friend-learning.mjs` 证据账本和管理中心「好友兴趣变化」入口，不建立第二套长期人物记忆；通用跨源记忆纠错仍待后续阶段。

## 历史开发预览：2.7.1-dev.2 补充：真实按需读取与匿名逐轮诊断

- [生产接线、模型自主检索、UID 权限、失败保护及可观察性](./2.7.1-dev2-true-on-demand-retrieval.md) · [Mermaid 实际数据流](./diagrams/2.7.1-dev2-true-on-demand-live.mmd)。精简首轮不检索长期记忆、人物画像、梗；模型有需要才请求并由本 UID 的只读源返回。待办与推荐进度仍保留已有事实一致性守卫，不能将其写成全面动态检索。

## 历史开发预览：2.7.1-dev.2 增量：后台对话上下文可选模式

- [精简按需与原始完整双模式：覆盖范围、模型主动扩展证据、原契约安全约束、真实调用计数](./2.7.1-dev2-dialogue-context-modes.md) · [实际生产接线 Mermaid](./diagrams/2.7.1-dev2-dialogue-context-modes-live.mmd)。新安装默认精简；普通私信和使用共用批处理器的评论/@ 生效，**不作用于独立主人私信 Agent 或 DSH 主 Session**。需要额外证据时模型可多续推一次，未使用真实 AI 的质量/成本尚未验证。

## 历史开发预览：2.7.1-dev.2 私信短期上下文治理

- [短期原文来源、自动与人工清理、账号/UID/权限边界及当前生产接线](./2.7.1-dev2-dm-memory-governance.md) · [可编辑 Mermaid](./diagrams/2.7.1-dev2-dm-memory-governance-live.mmd)。只处理后台普通私信和主人专属 Agent 的短期原文生命周期；主 Session 语义整理、Life Memory、好友画像仍是各自现有来源，**尚未实现跨来源的完整语义纠错或统一遗忘审计**。

## 历史开发预览：2.7.1-dev.1 视频评论区只读生活体验

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
| 主人公开评论回忆（dev.22） | `recent-comments.mjs` 仅只读 `seen.md` + `seen/YYYY-MM.md` 成功回执，宿主账号切换截断；非私有记忆、非实时平台可见性 | [现行双入口接线与证据边界](./2.7.1-dev22-public-recall-unified.md) · [Mermaid](./diagrams/2.7.1-dev22-public-recall.mmd) |
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

## 历史系统基线图（2.6.2，非 dev.25 的最新接线）

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

- [2.7.1-dev.8 顶部导航 Life UI 试行](./2.7.1-dev8-topnav-life-ui-trial.md)：保留四组横向页签，使用用户原设立绘、动画；修复时间线和心情 CSS；不涉及决策与外发。

- [2.8.0-dev.2 老用户备份兼容与完整冷快照安全说明](2.8.0-dev2-old-user-backup-safety.md)
