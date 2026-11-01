# 2.6.0-dev.4 后台模型同步与使用边界

此文档记录开发版实现，不宣称 DSH Desktop 0.2.1 真机已验证。

## 路由分工

- 有 `ctx.llm.stream` 的纯文本任务（反思、互动文本、动态文案、语义检索、表情包规则）：优先使用宿主已有模型配置。不得复制 API Key、偷换 Provider，模型请求 `tools: []`。
- 需要独立 Agent / 视频 MCP / 独立视觉的任务：只能走受限 Headless CLI。旧 DSH 缺少宿主 LLM 服务时，纯文本兼容 fallback 同样需要 Headless 验证。
- Headless 未认证：禁止发起对应任务，不从另一模型回退，也不改变 B站对外发布权限；如视频侧可选择本地低成本检索回退，不得虚构模型结果。

## 管理中心流程

1. 选择本机已保存的 Desktop 或 Web Profile；读取对应 `cordis.patch.yml` 中的 `llm-pi-ai.providers`。DSH 全局 `cordis.patch.yml` 整项覆盖时，应直接验证共享 Provider，不能错误地覆盖 Headless Profile。
2. 只显示安全的 ID、协议、模型名和状态；不向浏览器传原始 YAML、API Key、凭据或秘密字段。
3. 预览并明确确认：同步选中的 Provider 到 `profiles/headless/cordis.patch.yml` 对应的 `llm-pi-ai` 条目；保留不相关的 Headless 条目，先备份，临时文件原子替换。源配置含明文密钥、鉴权头、带 Query 的 URL 或动态表达式时拒绝自动同步。
4. 同步后仍然**未验证**；用户对每一个实际需要使用的模型主动发起无工具 Headless 请求，只有返回固定标记才为此 Provider/模型记录通过状态。
5. 存储在插件自身数据目录的认证回执与 Desktop/Web 源配置、Headless 目标配置和全局覆盖配置的完整文件哈希绑定；修改这些配置会立即吊销原认证，必须重新测试。

## 安全边界

- 唯一允许的写入目标是可信 `$DSH_HOME/profiles/headless/cordis.patch.yml`。不允许浏览器指定文件路径、脚本或原始配置内容，拒绝符号链接配置文件。
- 同步绝不写入 `credentials`、账户、B站 MCP、Shell、文件/浏览器工具、自动评论/私信权限。
- 配置写入备份不是凭据备份；回执只含 Profile、Provider、模型标识、配置哈希及时间。
- Provider 绑定成功只说明该模型可供独立任务调用，不意味着外部操作已被授权。
- 目前真实 DSH CLI、`yaml` 生产依赖、Desktop 模型适配器和凭据服务还需用户在目标环境进行端到端验收；`NO_ADAPTER` 不可被这套同步逻辑掩盖。

## 发布前验收

- 多模型同步保留未选中的 Headless Provider，重复同步和并发冲突行为正确。
- 修改源/目标/全局配置后，原有认证立即作废；未经认证不能启动视频 Agent、独立识图及纯文本 fallback。
- 单次连接测试不携带 MCP/文件/Shell 工具；失败时不会留下虚假的“已验证”状态。
- 跨域 UI 写接口必须拒绝，Preview Token 在源/目标修改后作废。
- Windows Desktop 0.2.1 真实启动、模型返回、角色权限、计费与恢复流程必须单独验证。
