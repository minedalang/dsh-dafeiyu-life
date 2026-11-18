# 2.8.1-dev.3b.33.18-life-choice-audit 测试报告

## 结果摘要

**134 / 134 项定向回归通过。** 本轮按项目规则未运行完整测试套件，只运行与私信、Life 自主决策、B站安全链接、planner、写权限和未知结果保护直接相关的测试。

- 定向 Node 测试：134/134 通过，17 个测试文件，无失败、无跳过。
- Node 语法检查：`index.js`、`lib/bili-share-link.mjs`、`lib/life-shared-bili-links.mjs`、`lib/life-shared-link-policy.mjs`、`lib/interaction-batch.mjs`、`lib/autonomous-planner.mjs` 通过。
- Life 架构契约：通过，4 张 Mermaid、126 个唯一代码节点。
- Video/MCP canonical selection 与 no-daily-cap 契约：通过。
- `selfcheck.mjs`：Host / Client 两端通过，43 个工具注入检查通过。
- `npm pack --dry-run`：通过，713 个文件；TGZ 包体 4,486,764 bytes，解包 9,638,039 bytes；实际 `npm pack` 成功生成本地安装包，未发布 npm。
- Git Patch：从 `.17-notification-sentinel` 基线 `git apply --check` 通过；独立回放后与 `.18` 工作源码逐文件校验一致（不含 VCS 元数据和 node_modules）。
- `git diff --check`：按项目 CRLF 约定使用 `core.whitespace=cr-at-eol` 检查通过。

## 本轮新增覆盖

1. B站短链重定向逐 hop 经过共享读取预算。
2. HTTP 429、共享预算冷却、Life 资源队列未准入被区分为可恢复延期，不记成内容读取失败。
3. 多条私信安全链接由 Life 选择宿主提供的精确 opaque ID；多候选缺少精确选择时 fail closed。
4. 联系人从好友降为陌生人、陌生人许可关闭、DM 开关关闭、账号变化时，旧分享链接不能绕过当前权限。
5. 直接 dynamic/video/profile 链接的 proof 类型必须匹配；视频 AID 必须与平台回执精确一致。
6. `video-metadata-only`、`dynamic-text`、`dynamic-text-image` 和 `profile-metadata-only` 分开记录；不把视频元数据说成观看，不把纯文字动态说成图片已观察。
7. 每条安全分享链接拥有独立幂等 Life 唤醒；联系人分享链接的有限摘要可供 planner 自主选择。
8. 外部内容仍是不可信数据；任意外站 URL 不获得读取能力。

## 其他自主决策场景回归

- 私信回复、沉默、延期、联系人权限撤销和发送幂等。
- 评论回复与 @ 的 Life 意愿、目标核验和发送回执。
- 关注/取关的一次性意愿凭据与独立权限门禁。
- 公开点赞/评论仍要求全局授权、目标核验和未知结果冻结。
- TODO 接受/继续不能授予外部写权限；只读自主探索仍受每日调度和证据门槛约束。
- Life 反思不能自动修改记忆；外部推荐原话不进入自主计划员上下文。

## 交付文档

- `docs/architecture/2.8.1-dev3b18-life-decision-freedom-audit.md`：当前实现审计、问题与修复。
- `docs/architecture/2.9.x-life-universal-attention-cross-platform-plan.md`：未来跨平台统一注意力与活动系统详细方案。
- `README.md`、`docs/ROADMAP.md`、`docs/README.md`、`docs/architecture/README.md` 已同步。

## 不代表已验证的事项

- 未向真实 B站账号发起本轮验收请求；未发送私信、评论、点赞、关注或取关。
- 未在用户 Windows DSH 宿主实机验证短链、真实动态/视频/空间读取、联系人权限撤销后的完整端到端表现。
- 未完成 24 小时 B站 `-509` 观察；离线测试不证明平台风控已解除。
- 未执行 Git Commit/Push 或 npm publish。
- 2.9.x 通用注意力系统、抖音 Adapter 和游戏平台 Adapter 是未来计划，不是本版已实现能力。
- 项目其他正式发布门禁（尤其生产 DSH 视频视觉实机验收）仍独立存在。
