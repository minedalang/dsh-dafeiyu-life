# 2.8.2-dev.9 · 定向验证记录（Linux 容器，非发布放行）

## 基线与变更

- **精确输入基线**：用户上传 `dsh-bili-scroll-plus2(3).zip`，`package.json` 为 `2.8.2-dev.8`。
- **输出源码版本**：`2.8.2-dev.9`，同步 `package-lock.json` 与 README。
- **目的**：新增可切换的静态「桌宠开放平台（开发中）」预告页、README 生态展望及 SVG，不启用 Pet Bridge 网络接口。
- **架构接线未变**：没有新增 HTTP 路由、设备配对、授权、模型调用、记忆读写、B站读取与外发。

## 运行的检查

| 检查 | 结果 | 说明 |
|---|---|---|
| `node --check lib/management-console.js` | PASS | 管理页 JS 语法 |
| 定向 Node 测试（开放预告页 + README + 管理中心导航） | PASS：20/20 | 仅相关测试，不是全量 |
| `node scripts/test-governance.mjs check` | PASS | 新增用例已登记，旧 README 断言替换有审计 |
| `node selfcheck.mjs` | PASS | 假宿主与客户端启动自检，不触碰真实 DSH 家目录 |
| `npm run check:life-architecture` | PASS | 四张现有 Mermaid 图内容保持一致 |
| `npm pack --dry-run --json` | PASS | SVG、管理页和 `docs/open-platform/README.md` 包含于 npm 预览清单 |
| 3 张新增 SVG XML 解析 | PASS | XML 结构可解析 |
| Git Patch `git apply --check` | PASS | 在原始 ZIP 提取目录进行检查 |
| Git Patch 实际应用并比较目标源码 | PASS | 已以原始 ZIP 独立回放并做逐文件 SHA-256 一致性校验 |

## 已处理的历史用例

上传的原始 `2.8.2-dev.8` 源码里，`test/v281-readme-user-facing-contract.test.mjs` 仍要求 README 标注 `2.8.1` 和旧版“未上架”固定句式；该测试在**未修改的原始 ZIP**上实际执行即失败（1/2）。本批未删除此测试或安全断言，而是保留 README 的长期功能、章节顺序、规划与致谢约束，将版本提示断言改为以 `package.json` 为权威版本，同时仍检查未发布警告。替换证据已登记 `test/governance/catalog.json` 的 `retiredAssertions`。

## 未运行和必须由维护者验收

- **未执行全量 Node/Python 测试**：遵守 AGENTS 禁止云端全量 Node 测试的约束。
- **Windows 普通权限全量**：未运行。
- **Windows 管理员全量**：未运行。
- **真实 DSH Desktop 管理中心实机检查**：未运行；需核对导航、URL 保持/刷新、初次快速设置后可访问、响应式布局、暗色主题及静态 SVG 显示。
- **B站真实账号与外发行为**：未执行，且本次纯预告页不应触发。
- **正式发布门禁**：仍未完成；不应把该包标记为正式 `2.8.2` 或将 API 预览写成已经开放。

所有结果只证明当前独立源码的离线定向检查，不证明用户 Windows 真实运行环境已经验收。
