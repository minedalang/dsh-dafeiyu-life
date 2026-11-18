# 2.8.1 发布前测试治理审计（2026-11-18）

本文件是阶段性分流依据，不是发布通过证明。依据维护者上传的 2026-11-18 13:10:40（普通）及 13:14:42（管理员）Windows full 摘要：Node 572 个测试文件，普通 34 项失败、管理员 32 项失败；Python 350 项中两次均为 5 FAIL + 3 ERROR；普通权限下另有 2 个符号链接安全测试 SKIP。管理员运行消除了该 SKIP，但未消除共性功能失败。

## 本轮已确认过时并改写的单项断言

- 首页推荐旧“兴趣档案主导搜索”措辞 → 当前“允许独立的首页漫游”开关；保留设置字段、控制器保存断言。
- 管理中心旧 `window.location.assign(path)` 精确字面断言 → 实际移动端同源 HTML 探测后安全导航；保留管理路由、CSP 和 API 测试。
- 旧“主人额外指定的关注主题”措辞 → 当前人生记忆核心兴趣编辑入口；保留模型调用时合并成长信息的检查。
- Mermaid 预览必须使用物理 LF 的断言 → 验证 Git Windows CRLF 签出之后仍能检查同一 Mermaid 语义，同时检测真正陈旧图；不容许绕过架构一致性。

对应旧断言与替代检查记录在 `test/governance/catalog.json#retiredAssertions`。已保留现有 5 份纯历史发行快照归档；本轮**没有整文件迁移尚有有效用户/安全测试的失败文件**。

## 尚未关闭的测试

- 旧社交 intake 与批量互动决策、权限与真实发送门禁、管理 UI 与用户实际保存行为、Life Prompt 与人物画像作用域、视频视觉流程与 MCP 子进程共享门禁均仍需检查生产路径，不能只靠改断言修复。
- Python 的 8 项失败/错误涉及语音与视觉子进程、平台状态回执等，须取得 Windows `step-XX.tap.log` 完整 traceback 并按当前依赖/真实行为复测，不能归档。
- 当前改写的几个旧断言仅通过了离线定向测试；**不能推断 34/32 或 5+3 项失败已经全部关闭**。

## 后续发布门禁

`npm run check:test-governance` + 相关定向测试 → Linux CI Node/Python 全量 → Windows 普通/管理员 full 分开运行 → 实机 DSH 只读/授权流程核验。关键 FAIL、ERROR 或未解释的安全 SKIP 一律阻止正式 Tag / npm 发布。

## 13:43 / 13:46 Windows full 最新复测（两次执行相互独立）

- 普通 PowerShell 13:43:39：573 个 Node 测试文件、48 批；30 个 Node 失败用例；Python 350 项中 5 FAIL、3 ERROR、2 个安全相关 SKIP。
- 管理员 PowerShell 13:46:17：573 个 Node 测试文件、48 批；28 个 Node 失败用例；Python 350 项中 5 FAIL、3 ERROR，未出现相应符号链接安全 SKIP。
- 两端均通过测试清单治理检查、跨语言事务等关键专项及插件自检。共有 28 个 Node 失败用例重合，普通 PowerShell 额外 2 项为符号链接/视觉证据相关（权限问题不能等同于功能通过）。
- 本次治理自动化补丁 **没有修复** 上述 28 个 Node 失败、Python 3 ERROR + 5 FAIL；正式版本仍阻断。Python 问题集中在 ASR/Whisper 子进程、视觉回执/失败归因；定位需对应 `step-XX.tap.log` traceback，不能仅据概要猜改。

## 自动治理机制（不要求维护者额外执行命令）

仓库首次执行现有 `run-tests.ps1` 或依赖安装时启用跟踪的 Git `pre-commit` Hook：只验证 Git 暂存区中的测试清单、安全锚点与审计记录，并输出受影响测试建议，**不运行全量测试、不自动删除任何旧测试、不静默修改暂存区**。若已有第三方 Git Hook/自定义 `core.hooksPath`，必须尊重现有配置；PR 的 CI 继续执行完整保障。开发 Agent 负责根据提示判断测试保留、改写或有依据地归档。

## 14:04 Windows full 日志与旧用例核查（本轮新增）

- 最新普通 PowerShell 14:04:16，测试治理 Hook 自动安装成功；574 个 Node 测试文件，48 批，28 个 Node 失败测试；Python 350 项中 5 FAIL、3 ERROR。全量仍阻断发布。
- `v2467-interaction-meme-memory.test.mjs` 原用例要求私信和评论都在首次模型输入中预加载梗库，并固定三次模型调用。当前 `lib/interaction-batch.mjs` 按 UID、渠道隔离模型调用；私信强制 compact，只有 Life 主动请求 `meme` 时才按账号读取。因此旧断言无效，**保留“不能串用梗、没命中不得注入”的安全语义**，改为验证真实按需读取与隔离行为。
- `v270-dev3-portrait-open-curiosity.test.mjs` 原用例要求私信首次调用立即注入画像。当前 compact 首轮不读画像，确认的同 UID/渠道 `portrait` 请求后才可读。改为验证按需续推、私信/公开分域与每次模型调用仅注入一次 Life Voice。
- 两个文件均为**替换单项旧实现断言**而不是删除整个文件、跳过测试或者放宽生产权限；同文件其他相关用例照常执行。Linux 定向结果 13/13 通过。Windows 全量需另行验证；其余 26 个 Node 失败和 8 个 Python 失败/错误不能据此认为已经解决。
