# 2.8.2-dev.29 · 收口修复与测试记录

**基线：dev.28 → 目标：dev.29；环境：容器内离线 Node/Python。** 未在用户 Windows/DSH 上安装/删除模型，也未连接真实 B站或进行外发。

## 本轮已完成

- Windows 上传测试报告：原 dev.28 全量 50 个 Node 主批次中 **5 批 FAIL**，共 **9 条断言**（3+3+1+1+1），并非全量通过。
- 9 个失败点所涉及的现行测试文件 + Whisper 缓存打包检查：**43/43 Node 测试通过**。
- Issue #11、ASR 诊断、视频预算、上下文交付等相关额外测试：**19/19 Node 通过**。
- 版本/README 当前架构契约额外复测：**8/8 通过**（属于上述 43 中的测试文件重新执行，不另算独立用例）。
- Python Whisper 下载进度专项（mock，不是真网下载）：**2/2 通过**。
- `node --check index.js`、`node --check lib/management-console.js`、`python -m py_compile scripts/download_whisper_model.py`：PASS。
- `node selfcheck.mjs`、`npm run check:life-architecture`、`npm run check:video-tool-contract`、`npm run check:context-budget`、`npm run check:test-governance`：PASS。
- `npm pack --dry-run --json`：PASS，发布文件表有 `scripts/download_whisper_model.py`。
- `npm pack --ignore-scripts`：PASS，实际 `.tgz` 中包含 `package/scripts/download_whisper_model.py`，版本是 `2.8.2-dev.29`。

## 仍然阻止正式发布

- **尚未重新执行 dev.29 Windows 普通与管理员 PowerShell 的全量测试。** Linux 定向通过不等于 Windows 50 批均通过。
- **Whisper 真实下载、实时 UI 进度、型号切换后缓存清理与真实 ASR 完成回执**仍需在 DSH 安装包中验收。
- **视频二次多窗口存在潜在保守预留过量**：每窗按本档可能输出的最大帧数预校验，前窗实际只消耗少量帧也可能使后窗提前预算拒绝；需针对多窗口真实链路修复和验收。
- B站接口 DNS/连接超时、旧轮转日志 `-509` 限流、Life 模型超时与额度不足，尚不能宣称真实网络测试通过。不要放宽安全重试与外发门禁。
- M2 音画语义互证、M3 11 类上下文实际交付没有独立实机完整性证据，不应宣称完全收口。

**结论：这批修复解决了已知 npm 打包 P0 和 9 条失败断言的生产契约/测试数据问题，但项目尚不符合正式版发布条件。**
