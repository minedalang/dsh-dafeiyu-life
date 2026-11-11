# 2.7.1-dev.69 · 验证记录（未发布）

## 本地已通过

- `node selfcheck.mjs`：假宿主 `apply`、41 个工具注册与假客户端组件挂载通过；无 B站真实发送。
- `npm run write:life-architecture-view`、`npm run check:life-architecture`：四张 Mermaid 源图与 102 个代码锚点通过。
- `node scripts/check-video-tool-contract.mjs`：选片工具状态和非每日入选硬上限契约通过。
- 纯本地 Node 定向测试共 37 项通过：`v271-dev69-social-expression-and-quotas`、`v271-discussion-contract`、`home-recommendations`、`comment-reply-thread-v2437`、`v271-dev60-social-retry-recovery`、`v271-dev4-life-exploration-continuity`、`v271-dev4-life-agent-metadata-recovery`。涵盖普通评论字符串 → Life 精确文本授权、P6、多次授权消费、防 @、额度延期、旧 paused 迁移、可调后台预算、视频审阅状态。
- `python -m unittest discover -s test -p test_v271_discussion_life.py -v`：14 项通过，使用内存替身，未访问 B站；验证取消视频讨论隐藏次数后仍按已核验 root 读取。
- `npm --offline pack --dry-run --json`：本地包清单验证通过，包版本 `2.7.1-dev.69`，未发布。
- `git -c core.whitespace=cr-at-eol diff --check`：通过。原仓库保留 CRLF 行尾，裸 `git diff --check` 会将 CRLF 误报为尾随空白。

## 未跑或需实机验证

- `npm test` 全部测试：执行环境阻止其中可能访问真实 B站的测试，已停止，不以绕过形式重试；仅改为执行明确无联网行为的定向测试。**不能声明全量通过。**
- `npm run test:python` 全套：没有审定所有用例均无联网，因此只跑离线可审计的专项 Python 用例。**不能声明全量通过。**
- 真实 Windows DSH 插件重启和管理页可视化、账号更换、B站动态回复发送与读回、真正平台风控、72 小时自然生活和 RC 验收：**未执行**。有真实会话、授权和平台回执才能确认；任何实验均不自动补发旧 `sent`/`uncertain` 事件。

## 2026-11-11 报告问题与状态边界

1. 毅武的动态回复曾显示 `life-social-expression-invalid`：非 P6 模型返回字符串，旧代码把它当作无消息数组，导致原本可用的评论正文无法封存 Life 授权。修复后只调用原模型一次、精确绑定最终正文。
2. 旧版不可见的陌生人模型考虑额度已在 dev.68 退役；本版补查并退休其余只读/探索的固定限制，把确实需要保留的后台资源节奏接到管理页。成功发送额度仍可调，额度耗尽的未发送通知不应永久标记已处理。
3. 主评论的“未发生”不必然是鱼鱼不想说话。新增审阅尝试、自主延期、技术失败三类记录；真实发送仍由 Life 提议、专业 Agent 同轮核验和一次性平台事务负责。
4. 老版本曾因三次读取错误写入永久 `paused` 的意愿，只在可确认为元数据读取故障时于内存恢复为 `ready`，仍遵守原下一次允许时间；原始账本不在只读加载时悄悄覆盖。

## 交付验证

dev.68→dev.69 Patch 在独立源码副本通过 `git apply --check` 和实际应用；应用后的全部源码与完整交付版逐文件一致。ZIP 内容完整性另见交付包根目录说明。
