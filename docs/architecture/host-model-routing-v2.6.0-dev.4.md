# 纯文本后台任务：宿主模型路由（dev.4）

## 为什么改变

过去一个模型任务启动一个 `dsh --profile headless --patch <overlay>`。`agent-default-model` 只选择 Provider 和模型，但不保证另一个 Profile 注册了该 Provider。普通用户不应配置第二套模型。

## 新调用路径

1. 一次性、纯文本、**没有工具**的任务优先取得当前宿主 `llm` 服务。
2. 取管理中心明确选择的 Provider 和模型；都留空则使用当前 DSH 模型选择。禁止静默改用另一个付费 Provider。
3. 如当前宿主注册了这个 Provider，直接用 `llm.stream({provider,model,messages:[user],tools:[],signal})` 调用，限时并检查完成原因。
4. 未注册 Provider 时明确提示 `NO_ADAPTER`。这是宿主问题，不修改插件私信权限，也不复制用户 API Key。
5. 宿主不提供 `llm.stream`（兼容旧版）时维持原受控 headless 进程；不能借此跳过宿主已经明确报告的 Provider 不可用状态。

本路径覆盖：人生反思、后台评论/DM、主人 DM Agent 的模型文本规划、生活动态草稿、低成本人生记忆检索、表情包规则优化、模型连接测试。所有实际 B站写入仍由原有独立权限层处理，模型无法直接调用工具。

**暂不改变**：视频主 Agent、独立只读视觉 Agent。它们需要 MCP 工具，仍走隔离 headless 进程；本次不将已有桌面工具权限暴露给它们。

## 隐私与兼容边界

- 不将 Desktop 配置或密钥复制到临时 overlay；请求复用当前宿主认证体系。
- `tools: []`、无 `toolHistory`，没有 B站、Shell、浏览器、文件或 Session 操作授权。
- 只有模型可见的提示词与文本响应参与此调用；不得把私信原文写入公开日志。鉴于 DSH 的 Session 记账与普通 Agent turn 不同，正式发布前须在真实 DSH 0.2.1 上验证辅助请求审计和计费。
- 若 Desktop 自己报 `NO_ADAPTER`，这种症状不能由大肥鱼的路由修复。要先检查 DSH 的实际注册状态。
- 实机验收：校验默认模型和自定义 Provider、凭据有效/失效、故障快速返回、思考档位、模型超时、失败不重试泛滥、B站权限不扩张。
