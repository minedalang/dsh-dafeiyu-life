# DSH 2.7.1-dev.25 · 从 dev.24 升级说明

> 开发预览，未正式发布；不变更 B站发送权限；`releaseReady: false`。

本轮增量补丁的**准确基线**是上一轮交付的 `DSH-2.7.1-dev24-full-source.zip`（`package.json` 为 `2.7.1-dev.24`）。不同 dev.24 分支或已有未提交变更的源码不能保证可以直接应用。应先核实 `git status`、备份业务数据与本地变更。

## 核心变更

- 在原主动回忆协议中新增 `lib/recall-request.mjs`，允许 Agent 自主提供回忆意图、专用查询词、时间条件、经历类型；**不额外发起一次聊天模型调用**。
- 程序使用运行机器的 IANA 时区，将今天、昨天、前天及指定日期转换为本地自然日范围，支持夏令时边界。
- 有明确时间约束的生活回顾**先检查可信事件发生时间**；无法确认具体日期的模糊或痕迹经历不能作为某天已发生的事实。长期记忆的创建时间不能替代事件发生时间。
- 词法与可选本地 Embedding 只在原有权限、遗忘、UID 过滤后的有效候选上排序；语义服务不可用仍保留时间硬过滤与词法降级。主人、好友、公开评论等仍沿原有记忆与成功回执来源。
- 原有没有结构化时间条件的纯文本回忆路径保持兼容；`full` 旧模式和部分专业 Agent 尚未全部统一。

技术说明见 `docs/architecture/2.7.1-dev25-temporal-intent-recall.md`；变更记录见 `CHANGELOG.md`。

## Windows PowerShell 应用说明

停止 DSH Desktop，备份 DSH 业务数据目录与未提交的源码改动，然后在从**准确 dev.24 基线**恢复的源码仓库中执行：

```powershell
git switch dev
git status --short
git apply --check .\DSH-2.7.1-dev25-from-dev24-original-CRLF.patch
git apply .\DSH-2.7.1-dev25-from-dev24-original-CRLF.patch
git diff --check
cmd.exe /c run-tests.bat
```

如果本地仓库把所有文本换行规范化为 LF，请改用 `DSH-2.7.1-dev25-from-dev24-normalized-LF.patch`。**两个补丁只选择其中一个**，不能叠加。现有业务数据不应被补丁覆盖；如应用检查失败，应对照完整源码检查，不要强行 `--reject` 或覆盖个人配置。

完整源码 ZIP 是开发源码而非已签名的 Windows 安装包。dev.24 可选 Embedding 能力默认关闭，dev.25 不会因安装或启动而强制下载模型。

## 测试与发布边界

离线 Node 全仓共 **2006** 项：**1999 通过，7 跳过，0 失败**；Python **222 通过，1 跳过**；dev.25 新增结构化回忆专项 **14/14 通过**（已计入全仓结果）。插件自检、`npm pack --dry-run`、补丁独立应用与内容哈希校验见交付测试报告。

**尚未验收**：真实 Windows DSH Desktop、llama.cpp GGUF 模型推理、B站账号、跨账号切换、长时间运行、真实生活回忆准确率；**不合并 `main`、不创建 Tag、不对外发布**。
