# 2.8.1-dev.3b.25 增量测试报告

## 基线与范围

- 基线：用户此前提供的 `2.8.1-dev.3b.24` 完整源码 ZIP。
- 本补丁直接包含窗口采集器 Q 提前结束热修，不要求预先叠加其他补丁。
- 范围：好友私信中的 B 站安全链接进入 Life 自主机会池；动态/视频/空间只读解析；动态独立点赞/评论权限；设置 dirty 快照；视频观察 live activity/行动树；可见控制台窗口事件采集。
- 按 `AGENTS.md` 约定，只执行相关增量测试，不运行全量 Node 测试。

## 结果

| 检查 | 结果 |
|---|---:|
| 新增及相关既有 Node 测试 | **129/129 通过** |
| Python 动态评论专项 | **4/4 通过** |
| Python 动态评论额度专项 | **2/2 通过** |
| Python dynamic-sync smoke | **11/11 通过** |
| Python `py_compile`（MCP server + Life 动态写入 runner） | 通过 |
| Life 架构契约 | 通过：4 张 Mermaid、120 个唯一代码节点 |
| Video/MCP canonical selection 契约 | 通过 |
| `node selfcheck.mjs` | 通过：host 43 tools、client settings slot 正常 |
| `npm pack --dry-run` | 通过：668 files，tarball 4.3 MB，unpacked 9.2 MB |
| Patch 独立回放 | 通过：直接应用到 dev.3b.24 基线，17 个文件一致 |
| `git diff --check`（按仓库 CRLF 约定） | 通过 |

## 关键安全断言

- 仅获批好友且 `socialPolicyGate.canLearn({kind:'dm'})` 为真的消息登记链接；原始私信正文、原始 URL、消息 ID 不写入链接账本。
- B 站短链仅允许 HTTPS `b23.tv`，最多 5 跳；每跳都必须落在明确 B 站官方域名白名单；不带 Cookie/Authorization；不访问外站。
- 只有 Life 自己选择 `inspect_shared_link` 才解析短链、读取动态/视频/空间。
- 动态写入要求动态作者 UID 与分享好友 UID 完全一致、好友当前仍获批、有真实文字/图片理解证据、主人分别开启独立授权，并通过一次性 sealed Life decision。
- 点赞每日最多 2 次，评论每日最多 1 次；评论仅限可评论的文字/图文动态，禁止 @ 和 URL；平台结果不确定时禁止自动重试。
- 动态写入函数是主机端专用 Python 函数，不注册为 DSH MCP 工具；新增动态/AV 只读工具不进入视频 Agent MCP 白名单。
- 视频行动树的“正在看视频画面”来自 account-scoped `video-observe` live activity，不把进行中状态误报为模型已经理解。
- 设置未保存提示按真实用户编辑前快照比较；改回原值会清除 dirty，程序化 hydration 不会标脏。
- Windows 诊断只记录可见控制台窗口 PID、进程名、父 PID、窗口类与可见状态，不记录窗口标题、命令行、截图或消息内容，并保留 Q 提前结束。

## 未完成的实机验收

- 当前执行环境没有 Windows PowerShell 5.1，因此窗口枚举脚本只完成静态契约检查，尚未在 Windows 实机运行。
- 未连接用户 B 站账号，不执行真实动态读取、点赞或评论；需要本机安装后验证 B 站接口回执与账号授权。
- 未运行全量 Node 测试（按项目约定由用户在本地执行）。
