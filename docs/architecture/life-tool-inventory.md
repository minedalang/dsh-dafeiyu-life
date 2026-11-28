# Life 工具、场景与权限清单 · 2.8.3-dev.70

本清单依据实际生产接线与注册源码，而非模型提示中声称具备的能力。注册不等于开放、授权、执行或成功。配置为用户当前生效值；下列默认仅为源码默认，旧配置、预设与安装选择可覆盖。DSH 宿主自身提供的非插件工具不在本清单内。未连接真实宿主，无法穷举该用户机器当前 list_tools。

## dev.70 · 统一 Agent 主线：私密披露共享执行（阶段性）

`bili_read_dm` 进入共享只读目录（社交15、Episode 9、主 Session 32，另4个 Episode 写）。原 `executeMainSessionPrivateRead`、`session_private_read`、`executeRegisteredLifeRead` 和 LifeWillingness 共用精确参数、真实绑定主人轮次、账号代际、一次性票据及前后复核。拒绝、延期或有效申请后的技术阻断关闭本轮已接线私密读取；并行申请阻断，同一精确目标不重复申请，每轮最多8个申请且 DM 只允许一次。新轮次重新选择。不把披露许可当成外发授权或已验证生活经历。

当前覆盖账号绑定角色模式下的私信正文、联系人、真实经历、个人推荐、创作者关系、收藏、私信未读和互动通知，以及挂载的记忆、经历、待办清单、观察列表和详情（15个路由）；已批准风格规则仍是原角色内部能力。附件分享保留原独立证据校验并受本轮关闭约束，但尚无自己的披露票据。独立本地记忆/无平台账号模式保留原显式召回，尚未接入账号无关的意愿域。主人直接管理权不变。其他渠道的内部回忆、自动注入、写入与跨轮拒绝一致性仍需审计，不声称完成全工具或全渠道统一认知循环。work: 不启用。

dev.58（历史）：无效续行模型输出记录技术 blocked，保留合法原契机；注册仍55读+4写，未扩大授权。

dev.57：生产社交批处理、后台主选择、Episode 追加决策及已接受待办子循环共用 executeLifeDecision：模型调用前后复核原账号/代际、模式和当前场景合法性，活体视觉证据失效时拒绝陈旧决定；社交批次严格核对编号，未解决读取不得作为最终回复，联想确认须完整批次及当前证据；待办子项在意愿等待后核对原来源和状态。原模型、菜单、记忆、权限、额度和调度不变；这不是全局单一循环或任意工作流恢复。 注册仍为 55 读 + 4 写。

dev.56 注册数量不变：原 Episode 在社交模型需要资源时可在安全边界让行，三种未核验读取可反馈失败并屏蔽本轮失败的精确目标；不扩大权限或重试。dev.55 新增共享公开主题搜索路由，其他场景授权不变。公开构思占原模型预算，不传私密上下文。

dev.66：另有独立主人私密读取 `bili_read_dm`（不进入共享注册）：当前绑定且已领取的真实主人轮次、主人原消息含准确 UID、confirm=true、账号与会话复核、原 DM 请求预算；最多20条，不写记忆或发送。无 DSH GO 实机验证。

## dev.68 主 Session 全工具自主意愿审计（增量，尚未全收口）

源码注册入口：`index.js` 的 `tool` / `readTool`（全局 B站工具）与 `lib/long-term-memory.mjs` 的 `chosenTool`（已绑定主 Session 工具）。以下为静态注册分类，不等于当前宿主实际可用清单；有些能力按模式和配置挂载。原则为主人请求不等于 Life 同意。普通角色选择可由统一主体在宿主原轮中表达，但不能把 `confirm` 当作批准；需要明确票据的敏感披露和写入需绑定原实际动作。已有复合 Life 执行不得再次持锁投票。

| 分类 | 工具 | 当前门禁 / 尚需完善 |
|---|---|---|
| 私信正文披露 | `bili_read_dm` | dev.68 已接原统一意愿引擎；真实轮次、精确 UID/limit、一次批准，拒绝/延期/错误不取正文。 |
| 私人账户及社交信息 | `bili_whoami`, `bili_dm_contact_lookup`, `bili_creator_relation_status`, `bili_favorite_lists`, `bili_favorite_content`, `bili_unread_messages`, `bili_received_replies`, `bili_received_at_and_likes`, `bili_home_recommendations`, `bili_status` | 原读取范围/账号保护与宿主模型选择；尚无同等披露硬门禁，按私有/公开目标细分。 |
| 私人回忆与观察/意愿清单 | `bili_growth_recall`, `bili_experience_recall`, `dafeiyu_memory_recall`, `dafeiyu_life_recall`, `dafeiyu_todo_list`, `dafeiyu_recent_observations`, `dafeiyu_observation_detail`, `dafeiyu_share_observation` | 原读域、活体证据、已绑定会话、附件前置检查保留；需统一明确披露意愿（含仅记忆/无B站账号场景），不把工具结果可见当成内部回忆；拒绝不允许旁路。 |
| 公开普通读取 | `bili_video_info`, `bili_comment_thread`, `bili_danmaku`, `bili_video_zones`, `bili_hot_videos`, `bili_hot_buzzwords`, `bili_weekly_hot`, `bili_rank`, `bili_user_info`, `bili_user_videos`, `bili_dynamic_comment_context`, `bili_search`, `bili_subtitle`, `bili_comments` | 当前宿主工具选择与原读取网关；需确认真实 Life 主体归属，不按工具可用强制执行。 |
| 外部写入 | `bili_video_like`, `bili_video_collect_manual`, `bili_follow_creator_manual`, `bili_unfollow_creator_manual`, `bili_comment_manual`, `bili_dynamic_comment_manual`, `bili_send_message_manual`, `bili_reply_existing_dm_manual`, `bili_reply` | 原明确确认、额度、授权与执行保护；逐项补齐真实主人来源和精确 Life 意愿绑定，不能用 confirm=true 替代。 |
| 复合行动 | `bili_watch_video`, `bili_life_consider_video`, `bili_video_revisit_moment`, `bili_run`, `dafeiyu_todo_execute` | 部分已有 Life 意愿（consider/revisit），逐路径核对原意愿和执行，不在持锁期间重新请求同一引擎。 |
| 角色内部选择 | `dafeiyu_chat_burst`, `dafeiyu_remember`, `dafeiyu_todo_add`, `dafeiyu_todo_update`, `dafeiyu_feel` | 原主 Session 当前模型选择与原事务校验；需核对真实主体、原请求、意愿/事实区别及历史固定规则，不强迫记忆或待办。 |
| 主人管理委托 | `bili_login_start`, `bili_login_poll`, `bili_setup`, `bili_config` | 区分角色代办与主人直接管理权，禁止把凭据/密钥当作可披露的角色隐私；不让 Life 否决主人停机、撤权或管理自己数据。保持原宿主设置与恢复边界。 |

以上为 dev.68 历史审计；当前进度见顶部 dev.70 增量。全工具统一收口仍为正式版验收要求。

## 0. dev.53 共享注册新增的四个既有写入路由

dev.53 历史共享目录共 59 个场景路由：55 读取、4 写入；当前 dev.70 为60路由（56读、4写）。下表不代表开放给其他场景。`registeredLifeTool` 提供 risk 与 capability；相同 capability 仅为语义族，不授权互换适配器或私密目标。仍以当前合法菜单为准。

| 注册路由 | 场景 / 能力 | 硬门槛 |
|---|---|---|
| `like_video` | Episode / `video_like` | `autoVideoLike`、每日点赞额度大于零；原 Python 选片、额度、防重和读回 |
| `collect_video` | Episode / `video_collect` | `autoVideoCollect`、原主题名与私有收藏路径规则、平台额度、防重、读回 |
| `follow_creator` | Episode / `video_follow` | `agentFollowEnabled`、已核验 BV 的真实作者、原关系核验与额度、防重 |
| `comment_video` | Episode / `video_comment` | `autoComment`、单轮/每日额度大于零、真实画面和公开证据、准确正文、原隐私和发送事务 |

四种写入都要求当前活跃 Life、合法原 Episode、当前账号及运行代际、独立视觉证明、精确目标、原意愿一次性凭据和原桥。组合按原账本子动作游标执行；撤销或换号后未使用票据拒绝。已交给平台的写操作不因撤销而自动重发；旧代际结果不计为新的已验证经历。主 Session、主人/好友/陌生人私信及公开评论没有因此获得这四个写入入口；原手动 `confirm:true` 风险仍待收口。`write_bundle` 是原组合提案而非第五个可独立外发的注册工具。

## 1. 统一只读注册（56 个场景路由，不是56个互不相同的能力）

`lib/life-agent-read-runtime.mjs`：社交15、后台 Episode 9、主 Session 32（含 dev.70 新注册的 bili_read_dm）。统一执行网关在 I/O 前后复核作用域；各生产适配器仍掌管原权限、真实目标及回执。主 Session 保留宿主原生循环；后台顶层 Planner 和 Video Agent 仍有专用入口。以下 `read_` 为模型菜单 action，社交 `contextRequests` 使用不带前缀的 kind。

### 社交（私信、评论）

| 注册路由 | 用途 | 场景及硬门槛 |
|---|---|---|
| `read_todo` | 读取当前联系人相关的既有待办回执 | 私信；当前联系人关联的既有待办状态，非主人全局清单。 |
| `read_recommendation` | 读取已核验推荐入账 | 私信；当前真实推荐回执，不凭标题猜观看。 |
| `read_memory` | 按自主 recallQueries 检索当前允许域的活体记忆，可附时间或细节范围；不同参数可再次检索 | 各社交场景；当前账号活体、合法域；主人私信可用 owner-private，其他 public-social / 同联系人边界；主人私信独立文字披露；遗忘失效。 |
| `read_portrait` | 读取当前联系人获准画像线索 | 好友/陌生人获准的当前联系人画像；公开不得披露私密信息。 |
| `read_meme` | 核对当前话题的本地梗知识 | 本地梗知识；当前话题、合法域；无命中不得猜。 |
| `read_video` | 展开本评论来源的真实视频上下文 | 评论；当前真实来源作品上下文，非任意 BV 或新视觉观察。 |
| `read_history` | 展开当前会话历史 | 各互动；当前会话历史，不跨人。 |
| `read_public_person` | 查看当前真实评论者的获准公开投稿 | 评论；真实入站评论、合法 BV/RPID/评论者 UID、非本人、active、当前账号、无隐私阻断；平台 UID 回执匹配。 |
| `read_hot_comments` | 查看当前真实 BV 的公开热评 | 评论；真实入站评论 BV/RPID、active、当前账号、无隐私阻断；平台预算。 |
| `read_shared_link` | 核验当前已提供的分享候选，多个候选须选择准确 ID | 私信；官方 B站受信链接，当前或同联系人近期候选，准确不透明 ID；原发件人仍获准、逐跳核验。每轮一个外层分享。 |
| `read_shared_original` | 读取已核验分享的唯一原动态 | 私信；已核验转发动态唯一原帖；原分享仍获准。 |
| `read_shared_video` | 观察获准分享视频的代表性画面或语音 | 主人/获准好友私信；白名单、同账号、可信真实分享、已核验视频、独立资源和视觉/语音证据；不开放陌生人。 |
| `read_recent_observations` | 主人专属：查看当前账号现有观察清单 | 仅主人真实入站 DM、主人 Agent 与只读开关、当前账号，缓存12小时，最多3条。 |
| `read_observation_detail` | 主人专属：从已核验清单选择精确分镜，核验字节和旧描述 | 仅同主人、先本轮获取清单，再精确 id/file；只核验真实字节和已有描述，不发送。 |
| `read_owner_todos` | 主人专属：查看当前账号开放待办状态 | 仅主人真实入站 DM、主人 Agent 与只读开关、当前账号开放待办，最多12条。 |

社交本轮：6轮、8次累计工具调用、一次最多4种；memory 最多3次不同规范参数，其他类型只读一次。隐私保护分支不读取上下文；非法请求、无真实来源、账号代际变化、记忆失效不继续。dev.52 评论读取不重复启动意愿模型，当前模型选中后仍由 `authorizeRegisteredCommentReads` 和原平台适配器按来源、账号、active、隐私及预算校验；两种公开读取分别核验，可共同选中，不继承外发权。

### 后台 Episode

| 注册路由 | 用途 | 硬门槛 |
|---|---|---|
| `search_public_topic` | 无旧契机自主构思公开主题、真实搜索；同一自生 Episode 可换一次主题 | 正常 active、原主/Planner 开关、可信账号代际、原平台读取预算、可读原待办和契机、两次模型额度；公开隔离构思，匹配回执；同操作已接受待办/活动主题防重。换主题另需原契机有效及剩余步骤/决策额度。 |
| `recall_public_experience` | 检索当前账号活体公开旧观察，不是新观看 | 清晰公开视觉活体证据、记忆能力可用、剩余决策预算；最多2次不同检索，每次最多3词。 |
| `inspect_exploration` | 核验当前 Episode 提供的准确 BV 元数据 | 原合法菜单中的未访问 BV。 |
| `inspect_creator_space` | 查看当前已核验作品作者的公开投稿 | 原已选 BV 的作者；该 BV 未读取过作者。 |
| `browse_home_more` | 读取当前 Episode 获准的真实首页推荐 | 原 home-browse Episode、首页开关，最多额外1次；受步骤和候选数限制。 |
| `inspect_commenter_works` | 查看当前菜单内具备独立证据的评论者公开投稿 | 当前菜单真实 eligible 评论者 personId；无任意 UID。 |
| `inspect_video_discussion` | 查看当前已核验 BV 的真实公开讨论 | 原已核验 BV、尚未读对应讨论。 |
| `observe_video` | 自主观察当前 Episode 已核验 BV 的全局代表画面，原视觉预算和证据门禁仍有效 | 原已核验 BV/标题/资料时间，视觉可用、原租约、防重及深度；真实采样才算观察。 |
| `focus_video` | 仅依据本次可信全局观察候选选择片段，原窗口、帧与网络预算仍有效 | 同次全局观察真实锚点、同 BV、原窗口/帧/流量预算；不可凭空指定目标。 |

后台公共门槛：自主生活 active、主开关、Planner 开关、当前账号及运行代际、除新主题入口外，原契机有效 ready/inspected，未过期、到 nextAt、非 review、无未结 writeBundle；至多5个已核验步骤（含入口）、至多4次追加决策及每日预算。回忆不计新观看/业务步骤。实际窗口按生效设置（schema 默认9–23点、4次/日，界面预设可能不同）。原视觉采样按 12/24/48 档；局部追加上限分别为2/4/6窗口、12/24/48帧、30/90/180秒、24/50/100 MiB、2/3/4批；取帧须有真实新覆盖。详见 `video-exploration-budget.mjs`。读不到不冒充完成。

### 主 Session（宿主原生 Agent，不新增 Loop）

| 注册路由 | 用途 | 适用门槛 |
|---|---|---|
| `bili_whoami` | 当前登录身份 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_dm_contact_lookup` | 真实已有私信联系人核验 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 已登录账号真实未回复入站；精确昵称/UID，脱敏元数据。 |
| `bili_growth_recall` | 角色成长规则 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 原活体浅层/已批准成长，不读取永久档案。 |
| `bili_experience_recall` | 当前允许域的真实经历 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 原活体浅层/已批准成长，不读取永久档案。 |
| `bili_search` | 公开视频搜索 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_home_recommendations` | 当前账号首页推荐 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 首页开关；单轮最多12条。 |
| `bili_subtitle` | 真实字幕 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_comments` | 公开评论 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_status` | 插件运行状态 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_video_info` | 真实视频资料 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_comment_thread` | 公开楼中楼 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_danmaku` | 弹幕文本 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_video_zones` | 视频分区 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_hot_videos` | 热门视频 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_hot_buzzwords` | 热门话题 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_weekly_hot` | 每周必看 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_rank` | 排行榜 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_user_info` | 公开用户资料 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_creator_relation_status` | 当前账号创作者关系回执 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_user_videos` | 公开投稿 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_favorite_lists` | 收藏夹列表 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 原收藏夹访问范围；不授予修改权。 |
| `bili_favorite_content` | 收藏夹内容 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 原收藏夹访问范围；不授予修改权。 |
| `bili_unread_messages` | 未读消息数 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_received_replies` | 回复通知 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_dynamic_comment_context` | 动态公开评论上下文 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `bili_received_at_and_likes` | 收到的@和点赞 | 宿主插件工具入口、平台及模式可用；平台读取仍经各原适配器、共享预算。 |
| `dafeiyu_memory_recall` | 长期记忆检索 | 选定且当前有效主 Session、挂载条件、当前轮次与账号/记忆作用域复核。 |
| `dafeiyu_life_recall` | 活体经历回忆（不含联想确认写入） | 选定且当前有效主 Session、挂载条件、当前轮次与账号/记忆作用域复核。 联想确认单独精确证据写入门槛，非读取。 |
| `dafeiyu_todo_list` | 当前账号待办清单 | 选定且当前有效主 Session、挂载条件、当前轮次与账号/记忆作用域复核。 |
| `dafeiyu_recent_observations` | 最近真实观察清单 | 选定且当前有效主 Session、挂载条件、当前轮次与账号/记忆作用域复核。 12小时缓存，最多4条。 |
| `dafeiyu_observation_detail` | 准确分镜原图字节与已有描述核验 | 选定且当前有效主 Session、挂载条件、当前轮次与账号/记忆作用域复核。 当前有效缓存准确 id/file；不外发。 |

`index.js` 的 B站工具为 `ctx.tools.register`；不能据此断言所有工具都具有 `long-term-memory.mjs` 的已选 Session / 真实主人轮次硬绑定。尤其 `confirm:true` 是模型传入的参数，不是独立可信主人授权凭据。主 Session 的指令要求主人明确同意，实际硬检查须分别看适配器（见下）；不能把提示要求当硬门槛。此处为后续安全收口事项。

## 2. 不属于统一只读注册，但已有生产工具或动作

### 宿主额外24个工具（与上节共55个源码注册名称）

| 工具 | 用途及门槛 |
|---|---|
| `bili_watch_video` | 主 Session 新观察：原 BV、账号、采样能力、资源、独立真实回执；不等于完整播放。 |
| `bili_video_revisit_moment` | 精确时间/证据锚点补看，原视觉授权、预算、账号与合法目标；不补造历史。 |
| `bili_life_consider_video` | 提交真实 BV 供 Life 自主考虑，不强制观看。 |
| `bili_video_like` | 手动点赞，confirm=true、总开关、登录、合法 BV、点赞额度>0、平台回执。 |
| `bili_video_collect_manual` | 精确 BV/收藏夹、confirm=true、新建需显式参数；原每日5条及防重。 |
| `bili_follow_creator_manual` | 精确 BV 的作者、confirm=true、原每日3次。 |
| `bili_unfollow_creator_manual` | UID、confirm=true、仅插件自己关注满7天；原额度。 |
| `bili_comment_manual` / `bili_reply` | 指定 BV，正文、确认、评论模式及额度、平台目标；后者仅顶层评论并有独立 @/同步动态选择。 |
| `bili_dynamic_comment_manual` | 动态 ID 字符串、真实评论目标 RPID/root、正文1–2000、confirm、评论额度。 |
| `bili_send_message_manual` | 精确白名单好友 UID、正文、confirm、原每日5条及防重。 |
| `bili_reply_existing_dm_manual` | 当前账号唯一未回复真实入站、来源消息 ID、正文1–450、confirm；不加入白名单，未知不重发。 |
| `bili_run` / `bili_setup` / `bili_config` / `bili_login_start` / `bili_login_poll` | 原宿主运行、配置与扫码流程工具，不是后台/社交可任意调用的通用能力；各原适配器及模式门槛。 |
| `dafeiyu_remember` | 原记忆开关、当前 Session；主人事实需本轮原文证据、分类自主记录为私密自述；写入额度。 |
| `dafeiyu_feel` | 原绑定主人轮次、模拟情绪枚举与强度1/2，非心理诊断。 |
| `dafeiyu_chat_burst` | 当前绑定 Session，原多气泡开关，2–3条且原控制器门禁；入队不表示展示成功。 |
| `dafeiyu_todo_add` | 当前任务账号、原任务类型、真实参数；写入型必须当前主人消息明确预授权。 |
| `dafeiyu_todo_update` | 原开放任务准确 ID，延期1–8760小时/放弃；运行中、未知或关闭不可改成成功。 |
| `dafeiyu_todo_execute` | 当前账号原已存任务，写型 ownerAuthorized，原平台目标、开关、额度、真实回执。 |
| `dafeiyu_share_observation` | 本主人真实领取轮次先选定原图 id/file，独立选择分享；宿主附件服务及当前模型能力，准备成功≠实际客户端显示。 |

### 社交生产结构化动作（不是自由 MCP）

`reply/skip/defer/close`（自然表达与终止）、`suggestedTodo`/`todoDisposition`/`todoTiming`（自主接受只读推荐，原证据和入账，now 也须先入账）、`deferredExploration`（原分享候选及 read_link / observe_video，只支持该已接线场景）、`videoRevisit`（主人/白名单好友，真实公开旧观察、明确时间或精确历史锚点，原补看授权）、`ownerMemoryProposal`（主人真实本轮原话）、`ownerTodoProposal`（主人原开放待办版本）、`shareObservation`（主人本轮真实清单/分镜、独立图片外发）、`nextAction` 中 `follow_dm_contact/unfollow_dm_contact`（原 DM 自主关注配置、真实来信发件人、意愿证明、平台额度；取关仅插件关注满7天）。普通回复亦必须通过原 SocialPolicyGate、真实平台目标、冷却、拒联和发送事务。没有通用任意参数的点赞/收藏/动态发布等主人私信工具接线。

### 后台 Planner（顶层行动，尚未全部迁入共享工具注册）

`skip`、`review_video_feedback`、`execute_read`、`defer`、`dismiss`、`inspect_shared_link`、`inspect_related_content`、`like_shared_dynamic`、`comment_shared_dynamic`、`inspect_opportunity`、`review_public`、`inspect_public_person`、`begin_exploration`、`inspect_exploration`、`inspect_creator_space`、`abandon_exploration`、`resume_episode`、`consider_social`、`use_capability`、`browse_home`、`review_friend`、`reach_out_friend`、`talk_to_owner`、`reflect`。全部由当前真实候选和原能力开关构造，精确 ID/BV，不能凭字符串自造目标。Episode 另有 `like_video`、`collect_video`、`follow_creator`、`comment_video` 或 `write_bundle` 等既有写入候选，必须同 BV 真实证据、对应独立开关、额度、原 Life 凭据和平台事务；每次续行写入限制及 bundle 状态不变。顶层 `talk_to_owner` 区分主 Session 委派与 dev.51 主人分享视频回聊，后者仅原主人直传、24小时、同源真实采样、当前清晰证据、无更新来信，三项主人联系开关同时开启，原联系额度一次来源，真实消息键；不是每个工具完成后的自动通知。

### 历史主人专用 Agent

`lib/owner-dm-agent.mjs` 的 READ/MEMORY_READ：`search, watch, inspect_my_space, inspect_creator_videos, check_notifications, memory_search, memory_detail, recent_actions, public_comments`，另有 `video_revisit`、`reply`。WRITE_FLAGS：`like, collect, follow, unfollow, comment_draft, comment_publish, comment_publish_draft, dynamic_draft, dynamic_publish, message`。有各自 `ownerDm*Enabled` 开关、主人真实入站及旧固定意图门槛。不是当前生产统一社交菜单的全部可调用工具；未来迁移需保留真实授权并移除语义关键词依赖，不能直接复制旧权限。主人评论专用历史适配器也不等于普通评论可用任意工具。

## 3. Python MCP 专业工具完整源代码索引

`vendor/bilibili-mcp/mcp_server.py` 中 67 个 `@tool()` 定义；不代表67个同时暴露。`BILI_MCP_TOOLS` 非空时按白名单注册，空时旧手工模式为广泛注册（图像发送仍有专门限制）；不能在生产给不可信场景空白名单。Video Agent `BILI_DUTY_VIDEO_PICK_FLOW=1` 时隐藏单独字幕、ASR、视觉预览，组合 watch 内部调用；评论/讨论读取要求本轮已选真实 BV。专用视觉 overlay 只开放 `bili_preview_vision` 或 selftest。视频自主写需 Life 审批 + Python 执行门禁。以下逐类列全，不与55个只读场景路由累加为产品能力数。

| 类别 | MCP 名称 | 场景/硬门槛 |
|---|---|---|
| 登录/认证 | `bili_login`、`bili_login_check`、`bili_check_credential` | 宿主认证、当前凭据与原流程，不向社交暴露凭据。 |
| 发现/公开读取 | `bili_search`、`bili_home_recommendations`、`bili_video_info`、`bili_video_info_by_aid`、`bili_comments`、`bili_comment_thread`、`bili_subtitle`、`bili_danmaku`、`bili_video_zones`、`bili_hot_videos`、`bili_hot_buzzwords`、`bili_weekly_hot`、`bili_rank`、`bili_user_info`、`bili_user_videos`、`bili_crawl`、`bili_dynamic_info`、`bili_dynamic_comment_context` | 平台读预算、合法目标、已选 BV/白名单限制。Video Agent 仅 mcpWhitelist 当前子集。 |
| 收藏及通知读取 | `bili_favorite_lists`、`bili_favorite_content`、`bili_unread_messages`、`bili_received_replies`、`bili_received_at_and_likes` | 当前账号或原获准公开目标；不赋外发权限。 |
| 感知 | `bili_watch_video`、`bili_vision_selftest`、`bili_preview_vision`、`bili_preview_observation`、`bili_transcribe_safe` | 专用白名单、模型与依赖、合法视频、原采样预算；字幕/ASR与画面分别核验。 |
| 本地记忆/记录 | `bili_identity_memory_recall`、`bili_meme_search`、`bili_meme_remember`、`bili_meme_observe`、`bili_creator_encounter`、`bili_creator_relation_status`、`bili_discussion_note`、`bili_session_watch_mark`、`bili_ledger_read`、`bili_ledger_mark`、`bili_report_read`、`bili_report_append`、`bili_digest_append`、`bili_comment_meme_list`、`bili_comment_meme_search`、`bili_comment_consideration` | 原账号和相应回执/写入范围、活体证据；本地记录不等于平台发送或观看。 |
| 自主视频外发 | `bili_video_like`、`bili_video_collect`、`bili_follow_creator`、`bili_unfollow_creator`、`bili_favorite_folder_delete`、`bili_fish_created_folders`、`bili_reply` | 各开关、真实选片、Life 审批（写）、原配额；仅插件创建的收藏夹/关注对象范围。 |
| 当前 DM 联系人关注 | `bili_follow_dm_contact`、`bili_unfollow_dm_contact` | 真实入站 UID、原自主关注许可、执行器证据/额度；取关满7天。 |
| 主人手动操作 | `bili_video_like_manual`、`bili_video_collect_manual`、`bili_follow_creator_manual`、`bili_unfollow_creator_manual`、`bili_dynamic_comment_manual`、`bili_reply_manual`、`bili_send_message_manual`、`bili_reply_existing_dm_manual` | 原手动/确认入口、当前账号、目标、配额、真实回执；白名单或真实未回复入站。 |
| 动态专用 | `bili_dynamic_reply_inbox` | 当前可信动态 ID / 作者或已核验入站目标，原授权/独立平台事务。 |
| 私信及原图外发 | `bili_send_message`、`bili_send_observation_image` | 原收件人/白名单/真实发送事务；原图仅 JS adapter 无通用白名单、真实字节/摘要/账号和主人专属门槛。 |

`bili_dynamic_like_life`、`bili_dynamic_comment_life` 是未使用 `@tool()` 的宿主专用内部执行器，不属于 MCP 注册工具，要求已核验动态、作者、公开互动及动态动作独立开关、原额度与回执。

Video Agent `index.js:mcpWhitelist`：基础 search（非首页模式）、watch、comments、comment_thread、discussion_note、video_info、ledger_read/mark、report_append/read、digest_append；首页模式按开关加 home_recommendations。原 whitelist 还列 `bili_growth_recall`，它是 JS 宿主工具，非上述 Python @tool 定义，实际 Headless 是否另行提供需宿主 list_tools 核验，不算 Python 工具。按开关追加 identity_memory_recall、meme_search/observe、video_like/collect、fish_created_folders/favorite_folder_delete、user_info/creator_encounter/creator_relation_status/follow_creator/unfollow_creator、comment_meme_list/search、reply/comment_consideration；单独字幕/ASR/视觉在 staged 模式隐藏。不得把诊断或直接 JS adapter 的全量函数当 Video Agent 当前菜单。

## 4. 权限场景与硬门槛汇总

| 场景 | 身份/能力硬门槛 | 不获得的权限 |
|---|---|---|
| 主 Session | 原工具注册入口、平台/模式、真实账号；记忆工具另有绑定 Session/轮次，具体写工具逐项确认及平台门槛 | 不是所有宿主工具都绑定可信主人消息；不能凭 confirm 代替独立身份凭据。 |
| 主人 DM | 真实平台来信 UID=配置主人，DM 开关及总开关，原白名单；主人专属读取需 ownerDmAgentEnabled + ownerDmReadCommandsEnabled，私密记忆独立披露 | 无任意本地文件/URL工具，不自动给他人发信。 |
| 好友 DM | 原好友目录 dm 授权（旧兼容仅未迁移目录），当前 UID，拒联/冷却；分享视觉与补看另需白名单和当前证据 | 不开放主人待办管理、私密图册、主人回聊授权。 |
| 陌生人 DM | dmStrangerAutonomyEnabled 或旧 one-shot，原严格审批可限制回复；拒联和当前账号。允许受限公开链接探索 | 无主人私密、观察/补看、待办管理；此次不扩主动回访权。 |
| 公开评论/动态/@ | 真实 BV 或动态、RPID/root/作者，评论/@监听及真实来源；公开上下文，不转述私信，阅读额外公开热评/投稿须 active | 不因识别主人而允许公开私密信息，不新增主动追评。 |
| 后台 Life | 生效 active、时间、原 Planner 额度、候选及 Episode、工具专属开关 | 自由选择不等于跳过授权；不任意跨轮执行新工具。 |
| 主人探索回聊 | 主人主动联系 + DM 沉默续聊 + 完成回访三项，原24小时视频来源、真实观察/活体证据、新来信复核 | 不自动发送，其他人不继承。 |
| 其他主动私信（既有） | 已建立私人双向关系 + 原独立 lifeProactiveFriendDmEnabled/好友 dm 或 lifeNaturalDmOutreachEnabled，原联系资格、额度 | 普通入站回复授权不等于主动联系，公开熟悉不等于私人关系；不新增新回访机制。 |

全局：B站共享读预算 schema 默认30/分钟、450/小时；平台 -509 退避；DM 原 maxPerPoll=3、maxPerHour=40、dmReplyPerDay 默认200、白名单15秒冷却，仍受跨渠道节奏及原接收者边界。评论 schema 默认每轮5/每日500，实际预设/模式/授权可收紧；点赞默认每日10。主人联系自然预设9–22点、240分钟冷却、每日2次；安静10–20点/480分钟/1次，活跃8–23点/120分钟/4次，或自定义。默认完成回访=false。不把默认数值误认成用户实际值。

任何输出：模型表达、结构化意愿、入队、缓存、平台提交与真实回执严格区分；未知写事务冻结，不重播；账号/权限/遗忘/会话代际变化拒绝陈旧结果。对外写使用原独立授权、目标核验、额度、防重及回执。注册表不授权、不会自动执行所有候选。尚缺全局物理认知循环、通用跨轮任意任务恢复、全场景写工具注册及真实宿主验收。本轮未扩权或运行实际平台。

### 核对入口

`lib/life-agent-read-runtime.mjs`、`lib/interaction-batch.mjs`、`index.js`（tool/readTool、mcpWhitelist、真实加载与执行）、`lib/long-term-memory.mjs`（chosenTool）、`lib/social-policy-gate.mjs`、`lib/social-context-assembler.mjs`、`lib/life-public-capabilities.mjs`、`lib/life-continuation.mjs`、`lib/autonomous-planner.mjs`、`lib/owner-dm-agent.mjs`、`lib/owner-contact-policy.mjs`、`lib/video-exploration-budget.mjs`、`vendor/bilibili-mcp/mcp_server.py`。此清单不是额外执行权来源；遇到说明与代码不一致以实际门禁及回执为准。


### dev.78 主 Session 身份解析与呈现前置契约

`bili_read_dm` 现接 `contact=owner`（原主人配置）或当前请求中的已有 UID 锚点名称（配置备注、当前账号入站昵称），原显式 UID 参数仍保留，二选一。准确匹配只定位目标，不授予披露；模糊近似仅澄清，重名、冲突及未锚定人物不读取。原 Life 私密读登记、一次性精确票据、账号代际、共享预算及外发门禁不变。真实原始主人轮次的 `work:` 只切换已接线私密读结果呈现；不启用通用工作授权或意愿跳过。正常角色投影保留真实选择与事实，技术阻断不冒充拒绝；旧详细回忆分页、联想及原内部回执保留。注册数量不变，其余工具和场景尚待接入。


### dev.80 精确工作委托（原读取入口）

主 Session 原 `bili_read_dm` 的 `contact=owner` 可接受真实已领取主人原始精确工作命令及一致的1–20条范围。原单轮 claim、目标和账号前后复核、共享读取预算与注册执行契约保留；不构造 Life 意愿票据，不增加工具注册，不把第三方或外部写入纳入工作委托。其他 work: 请求继续原意愿及技术呈现。

### dev.81 主人诊断知情基础契约

**dev.81 主人知情与外部隔离：** 认证私下主人正常模式默认自然表达，但明确要求时可解释当前真实诊断；主 Session 角色投影携带白名单 `ownerDiagnostic`（不含任意错误字符串、正文或凭据），B站主人本人入站私信可追问当前及最近一份同账号、同 UID、同角色有效失败回执（进程内最多30分钟，换号/失效/重启不可复原）。B站不启用 work:；追问不增加读取、写入或披露授权。好友、陌生人、公开评论及非认证渠道不取得主人诊断；已接线路径投影共享视频、补看失败和私密上下文，并在外发前拦截明显技术标记。原始回执留本地管理诊断，旧任意文本及全部历史工具仍待审计。白名单外原因不猜测。

dev.82（现行增量）：`bili_read_dm` 普通模式的身份定位仅候选；原 Life 模型同次核验真实请求、目标、范围与意愿。主人绑定自动定位，真实澄清下一有效轮次供理解，不继承授权。主人私信诊断追问改由原社交模型理解；原精确工作命令及注册数量不变。


## dev.103 共享驱动增量（注册数量不变）

原 `life-agent-read-runtime` 新增 `runLifeToolCycle`，由可信 JS 场景适配器交付模型与注册读取 effect，依序驱动并将结果或异常交回原场景；不接受模型自由构造 effect，不提供写入 effect。社交 DM/Comment 的首轮、按需读取、补看后的模型继续、主人待办/记忆回执、私密披露及一致性修订均复用同一驱动；后台 Episode 的连续选择、已注册读取及公开主题构思/搜索也使用该驱动。主 Session 保留宿主原生 Agent，反思、专业视觉与真实写事务仍保留独立适配器，不嵌套第二 Agent。原菜单、准确参数、模型与平台预算、隐私/写授权、原 Episode 和回执结算不变。Episode 读取及换主题在实际 I/O 前后复核本次已经交付的活体视觉联想，遗忘后不提交旧决定派生的读取结果。无新增固定自然语言规则、阈值、权限或调度器。
