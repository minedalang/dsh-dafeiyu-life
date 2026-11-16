# 2.8.1-dev.3b.28 从 dev.3b.27 升级

1. 请先备份 DSH 业务数据并确保当前 Git 工作区对应 `dev.3b.27`；不要叠加旧零散补丁。
2. PowerShell 项目根目录执行 `git -c core.whitespace=cr-at-eol apply --check .\dafeiyu-2.8.1-dev.3b.27-to-dev.3b.28.patch`。
3. 校验通过后执行 `git -c core.whitespace=cr-at-eol apply .\dafeiyu-2.8.1-dev.3b.27-to-dev.3b.28.patch`，并执行 `git diff --check`。
4. 仅需增量测试，真实 DSH 安装需按你的本地受控流程进行。此版本是**诊断收敛**，不是黑窗或图片识别已根治的版本。
5. 安装更新后重新执行图片自检，再用 `tools\导出B站日志.bat --no-pause`；新 `_diagnostics/dsh-vision-selftest-last-run.json` 应含 `cli` 结构；黑窗用 `tools\capture-intermittent-window.bat 900` 并在出现后按 Q 提前导出。不要分享原始 stdout/stderr 或密钥。
