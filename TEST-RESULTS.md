# 2.7.1-dev.73 · 离线测试与验收边界

## 本轮源码范围

以用户上传的完整 `2.7.1-dev.72` 源码为基线；仅调整 Life 预设与普通规划间隔、管理台只读来源可视化、Life 意愿诊断状态和对应文档/测试。未修改 B站接口凭据、发送权限、Comment/DM 执行器、去重与未知结果冻结规则。

## 已运行测试

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| Node 核心定向（4 个文件） | 22 通过 / 0 失败 | `v271-dev73-life-pace-trace-clarity`, `v271-dev10-life-pace-behavior`, `v271-dev41-video-agent-configurable-interval`, `v271-life-a-social-fast-preset-budget` |
| Node 跨模块回归（12 个文件） | 65 通过 / 1 失败（共 66） | 含自主规划、待办、生活契机、决策追踪、架构、节奏和快速社交处理 |
| 唯一未通过项 | 既有问题（原 dev.72 同样失败） | `v271-dev46-life-decision-explain.test.mjs` 的「social attention action says local consideration only, never actual DM reply」：用例预期 `no-verified-preview` 诊断码，实际回执不符合预期；未因 dev.73 引入 |
| Python 隔离测试 | 15 通过 / 0 失败 | `test_dev33_video_comment_consideration`、`test_dev37_episode_comment_review` |
| Life Mermaid 代码锚点检查 | 通过 | 4 张现行源图、105 个唯一代码节点；GitHub 预览已重建 |
| `node selfcheck.mjs` | 通过 | 使用隔离的本地自检环境，不触碰真实账号 |
| `npm pack --dry-run --json` | 通过 | `2.7.1-dev.73` 包装预检；无发布 |
| Git diff whitespace | 通过 | Git CRLF 规则核对 |

## 未运行／未验收

- 未运行可能访问真实 B站的 Node 全量测试套件；不能据此宣称全量 0 失败。
- 尚未在 Windows DSH 实机对 `生活来源卡片` 做浏览器视觉截图与长期运行检查。
- 未登录用户 B站账号进行评论或私信发送，不主动重放历史 `video_comment` 意愿或结果未知的消息。
- 用户提供的 20:53/20:58 意愿日志晚于随附 ZIP 截止约 19:59 的记录；单凭片段只能确认上一轮 `platform-confirmed` 和后一轮 `approval-only`，无法确认后一轮实际送达。
- 原 dev.72 之后关于自然熟悉度、渠道亲密度与 DM Openness 的三维关系系统仍是经讨论的设计方向，此版没有实现迁移，也没有放宽主动私信资格。
- 历史主评论入选后跨轮恢复仍未在这一补丁实现，不要认为所有不发主评论问题已解决。

## 现场验收建议

1. 升级后确认已保存的旧 `10分/100次` 未被静默改写；管理页明确选「活跃」并预览确认后才变 `10分/200次`。
2. 进入「鱼鱼想做的事」，三类并列来源的数量通过当前账号只读接口加载；失败时显示原因，不强制建立待办。
3. 两分钟后再次到期的经验或 Episode 候选不会提前触发**普通**自动规划；已核验入站评论仍由原社交快速机制独立考虑。
4. Life 意愿 `model-accepted` 但 `approval-only` 未结算时，显示等待回执；超过五分钟标为「待核查」而非「已发送」；只有独立平台成功回执才标为平台已核验。
5. 检查当前账号下 B站发送额度、重试事务、评论和私信的原有防重复与权限仍正常。
