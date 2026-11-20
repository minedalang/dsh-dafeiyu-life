# 2.8.2-dev.36 · 离线定向测试与发布门禁

## 本次实际完成

- **Node 相关专项：85 / 85 PASS，0 FAIL**。在不包含缺失依赖的旧 Headless 测试文件的13个相关测试文件中执行，包括新 `test/v282-dev36-owner-focus-acceptance.test.mjs` 6项、原有 Life 两阶段、时间锚点、证据、调试入口和网络预算回归。新测试直接提取生产路由执行，验证真正的单窗口 FFmpeg 工具调用参数、账号隔离、防重复与失败不冒充成功。
- **Python 局部视频专项：8 / 8 PASS**。`test_dev3a2_life_selected_focus.py`（2）、`test_v282_dev30_video_focus.py`（2）、`test_v282_dev15_video_diagnostics.py`（4），以 `PYTHONPATH=lib` 运行。
- **真实用户回执离线重放**：使用用户 Qwen3.5 2B、BV1Smsb6FEb6 的真实只读 JSON；现有四个候选（65、70、120、186秒）全部提取出匹配采样时间的视觉描述，而旧实现只有纯时间/差异线索。新主人专项从同一份回执读出24个确证采样时间；选65秒、15秒，会规划57.5～72.5秒的受控窗口。该检查未连接用户 Ollama/FFmpeg。
- **工程门禁 PASS**：`node selfcheck.mjs`、`npm run check:life-architecture`（4张 Mermaid 图、128节点）、`npm run check:video-tool-contract`、`npm run check:context-budget`、`npm run check:test-governance`；受影响 JS 文件静态语法检查通过。
- **npm pack --dry-run --json PASS**：打包预检版本 `2.8.2-dev.36`，762个文件，包含 `scripts/download_whisper_model.py`。

## 未通过／受环境影响

- 一次扩展定向 Node 运行共 **91项：87 PASS，4 FAIL**。四个 FAIL 全部来自旧 `test/v282-dev34-closure.test.mjs` 中真实 Headless YAML 专项：当前离线源码工作区没有安装 npm `yaml` 依赖，动态导入 `lib/headless-model-sync.mjs` 报 `ERR_MODULE_NOT_FOUND`。**没有把这4项记为已通过，也不能据此断言 Headless 逻辑正确。** 之后排除该缺失依赖的旧专项、重跑相关13个文件得到85/85 PASS。维护者应在依赖已安装的 Windows 项目里单独重跑该旧专项。
- 本机未连接用户的 Windows/DSH、B站真实账号、FFmpeg/Ollama 运行环境；**未证明真实原视频局部解码、视觉模型响应及 Life 自主深入完整链路成功**。新路由仅完成离线生产代码模拟与真实历史 JSON 时间锚点核验。
- 未运行 Windows 普通/管理员 `run-tests.ps1 -Mode full`，因此 **2.8.2 正式版仍不放行**。

## 安全范围

只读工程与模拟测试，无真实 B站外发；不假冒 Life 选择，不新增真实观看记忆，不修改私信30分钟兜底和原网络预算；未执行 Git 提交、推送、npm 发布。补丁 replay 与 ZIP 核验结果见最终交付回放记录。
