# 2.8.2-dev.32 · 离线测试与发布门禁

- 变更基线：`2.8.2-dev.31`；目标：`2.8.2-dev.32`。
- 先前相关 Node 定向回归：**68/68 通过**；最后修正图片自检思考档位、完整 Debug 分镜展示后，重新执行的 **11 个相关测试文件、52/52 通过**（两次测试集合有重叠，不能相加）。
- 已执行 Python 旧行为回归：**18/18 通过**（分镜采样、低清回退、长索引与前一版回执校验）。
- 已执行 Python 新专项：**10/10 通过**（4/6/12格、思考选择、Token预算、无正文、长度截断、虚构第四行、6张调试拼图完整留存）。
- `node selfcheck.mjs`、`check:life-architecture`、`check:video-tool-contract`、`check:context-budget`、`check:test-governance`、`npm pack --dry-run`：均通过。
- 此处**不等于 Windows 真实模型/DSH 全量通过**。下一步必须在维护者 Windows 机器上测试 qwen3.5:4b 真实视觉输出，并保留普通/管理员两组全量日志。正式版仍不放行。

- 真实 npm 发布文件清单：`2.8.2-dev.32`、761 个发布文件，包含 `scripts/download_whisper_model.py`；没有在本机安装用户模型。
