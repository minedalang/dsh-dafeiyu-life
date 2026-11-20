# 大肥鱼 Plus 2.8.2-dev.32 开发交付说明

- 基线：`2.8.2-dev.31`；目标：`2.8.2-dev.32`，仍非 2.8.2 正式版。
- 完整 `source/` 或 `PATCH_FROM_2.8.2-dev.31_TO_2.8.2-dev.32.patch` 二选一，不要重复叠加。
- ZIP 包内附有独立的 `COMMIT_MESSAGE.txt`、`TESTING_2.8.2-dev.32.md`、`TEST-RESULTS.md`。
- 修改：4/6/12格分镜可选，本地 Ollama 思考配置；按单张拼图和思考模式动态扩充生成 Token，上限12,288；受控延长本地 MCP 时限。离线模型结构校验更严格，不保证模型语义准确。
- 仍需 Windows / DSH 实机验收、真实模型对照及全量回归；无 Git 提交、推送或 npm 正式发布。
