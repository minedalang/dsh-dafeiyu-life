# 大肥鱼 2.8.1-dev.3b.33.18 交付说明

## 本次交付内容

1. **2.9.x 未来计划**：新增《Life Universal Attention & Cross-Platform Activity System》详细规划，定义通用注意力核心、跨平台活动管理、Platform Adapter 契约、通知打断、活动暂停/恢复、兴趣记忆分层、链接安全和分阶段接入 B站/抖音/游戏平台。README 和路线图已增加入口。
2. **当前决策自由审计**：检查私信安全链接、转发原动态、Life Planner、私信回复、评论/@、关注/取关、公开互动、TODO 和视频探索的意愿、权限与回执链。
3. **安全链接修复**：短链每一跳纳入共享预算；多链接由 Life 精确选择；执行时重验发件人权限；校验资源类型与 AID；明确元数据和观看证据；预算/资源延期不再记成内容失败。
4. **权限保持**：没有扩大私信发送、公开点赞/评论、关注/取关、陌生人准入或任意 URL 访问权限。

## 交付结构

- `source/`：完整源码（不含 node_modules、VCS 元数据、本机配置、个人数据和本轮诊断日志压缩包）。
- `patches/`：从 `.17` 到 `.18` 的独立 Git Patch。
- `dsh-dafeiyu-life-2.8.1-dev.3b.33.18-life-choice-audit.tgz`：本地安装包。
- `APPLY.md`：升级、验收和回滚说明。
- `TEST-RESULTS.md`：定向测试和未验证边界。
- `COMMIT_MESSAGE.txt`：中文 Commit 文案。
- `SHA256SUMS.txt`：安装包与补丁校验和。
- `docs/architecture/2.9.x-life-universal-attention-cross-platform-plan.md`：2.9.x 详细未来计划。
- `docs/architecture/2.8.1-dev3b18-life-decision-freedom-audit.md`：本轮审计报告。

## 状态

134/134 项相关定向测试通过；Life 架构契约、Video/MCP 契约、Host/Client 自检和 npm 打包预检通过（713 个文件，TGZ 约 4.5 MB）。尚未在用户 Windows DSH 和真实 B站账号上完成端到端验收；未执行 Git Commit/Push 或 npm publish。请先阅读 `APPLY.md`。
