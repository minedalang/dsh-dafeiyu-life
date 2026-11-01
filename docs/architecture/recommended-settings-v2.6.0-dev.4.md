# v2.6.0-dev.4 推荐体验参数与老安装兼容

## 统一数据源

`lib/recommended-experience-settings.mjs` 定义版本号和以下只读推荐值。`GET /api/bili-duty/config` 返回 `recommendedSettings`，管理页不硬编码推荐值，也不能借此更改 Host 配置；旧用户只有点击恢复按钮并执行原页面的保存操作才会真正修改对应配置。

| 参数组 | 字段 | 推荐值 |
|---|---|---|
| 反思调度 | `mainSessionReflectionMinCandidates` | 6 |
| 反思调度 | `mainSessionReflectionBatchSize` | 24 |
| 反思调度 | `mainSessionReflectionIntervalHours` | 1 |
| 反思调度 | `mainSessionReflectionDailyBatches` | 16 |
| 遗忘与召回质量 | `mainSessionMemoryHalfLifeDays` | 30 |
| 遗忘与召回质量 | `mainSessionMemoryThreshold` | 0.35 |
| 遗忘与召回质量 | `mainSessionMemoryMaxItems` | 8 |
| 遗忘与召回质量 | `mainSessionMemoryMaxChars` | 1200 |
| 遗忘与召回质量 | `mainSessionMemoryDailyQuota` | 30；用户可设置 1–100 |
| 遗忘与召回质量 | `mainSessionMemoryFactsMax` | 2 |
| AI 检索预算 | `mainSessionMemoryCandidates` | 48 |
| AI 检索预算 | `mainSessionMemorySearchDailyLimit` | 80 |
| 评论上下文 | `commentReplyHotCount` | 12 |
| 私信上下文 | `dmContextMessages` | 40 |

## 交互与兼容

- 管理页每个分组提供「使用推荐值」，只填写其负责的数字输入框，显示“尚未保存”的反馈；用户必须点击「保存记忆与反思设置」或「保存次数与额度」。
- `/config` API 提供服务器版本的推荐值，缺失时不以浏览器硬编码值猜测或写入，提示先更新后端。
- 管理页读取当前真实设置，显示与 dev.4 推荐值不一致的参数组；允许有意保留自定义值。
- 新安装 runtime 默认引用同一推荐常量；旧安装的 `legacyExperienceDefaults`（例如召回 6 条 / 800 字）保持不变，不迁移、不覆盖保存配置。
- 推荐分组不允许包含 `Enabled`、`Whitelist`、主人 UID、Provider、模型 ID、密钥、私信/评论发送额度或公开发布权限。
- `mainSessionMemoryHalfLifeDays` 控制经历遗忘阶段，不只是相关性排序。调大并不能复原已遗忘的经历。
- AI 检索的推荐调用额度仅是预算数值，不会自动开启模型检索功能。

## 验收

- `test/dev4-recommended-experience-settings.test.mjs` 校验推荐组数值、权限字段排除、后端导出、控件存在、显示恢复后仍要求保存、更新说明。
- `test/dev13-release-readiness.test.mjs` 对 schema 与 runtime 默认值进行逐字段一致性校验，支持引用后端推荐常量，保留老版本兼容默认的检查。
- `test/v253-video-memory-continuity.test.mjs` 按实际生命记忆协调器调用形式检查入口，不允许绕过原协调器。
