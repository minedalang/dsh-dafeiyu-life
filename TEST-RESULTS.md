# 2.8.2-dev.35 · 离线定向测试结果

- **Node：80 / 80 PASS**。14 个与通知哨兵、DM 退避、Life 局部候选/窗口、旧证据链相关的测试文件。命令见 `TESTING_2.8.2-dev.35.md`（教程列出核心子集）；本轮未执行云端 Node full。
- **Python：8 / 8 PASS**。`test_dev3a2_life_selected_focus.py`（2）、`test_v282_dev30_video_focus.py`（2）、`test_v282_dev15_video_diagnostics.py`（4），均采用项目 `PYTHONPATH=lib` 环境。
- **工程门禁 PASS**：`node selfcheck.mjs`、`npm run check:life-architecture`（4张 Mermaid/128 节点）、`npm run check:video-tool-contract`、`npm run check:context-budget`、`npm run check:test-governance`，受影响 JS 文件语法检查通过。
- **npm pack --dry-run --json PASS**：版本 `2.8.2-dev.35`，761 个发布文件，包含 `scripts/download_whisper_model.py`。
- **Git Patch 回放**：相对原版 dev.34 完整源码，在另一个干净工作树执行 `git -c core.whitespace=cr-at-eol apply --check` 与实际 apply；逐文件 SHA-256 全部一致（见交付验算输出）。补丁没有修改/新增 `tools/导出B站日志.bat`。
- **未通过/尚未做的正式验收**：未运行 Windows 普通/管理员 full，未对真实 B站 -509 解除做线上回放，未证明真实 DSH Episode 局部 360p / FFmpeg / Vision / Life 的完整成功链；因此 **2.8.2 正式版不放行**。
- **安全边界**：测试未调用 B站发送、关注、评论等外发动作，未 Git commit/push、未 npm publish；30分钟 DM 一致性核查保持原值。
