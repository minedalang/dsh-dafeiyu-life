# dev.3b.26 → dev.3b.27 补丁应用与 Windows 验收

基线：以前一轮交付的 **`dafeiyu-2.8.1-dev.3b.26-source.zip`** 为准（无需叠加旧补丁）。请先备份本地插件/用户数据，保持工作区干净。

```powershell
git status --short
git -c core.whitespace=cr-at-eol apply --check .\dafeiyu-2.8.1-dev.3b.26-to-dev.3b.27.patch
git -c core.whitespace=cr-at-eol apply .\dafeiyu-2.8.1-dev.3b.26-to-dev.3b.27.patch
git diff --check
```

确认无冲突后再提交（交付包内有 `COMMIT-dev3b27.txt`）：

```powershell
git add -A
git commit -F .\COMMIT-dev3b27.txt
```

本地 Windows 重点验收：

1. 重新打包/安装本地插件并重启 DSH；先运行既有的 FFmpeg 实际合成帧解码自检，核对成功。
2. `tools\capture-intermittent-window.bat 900`，然后在视频感知 Debug 中复现；弹窗时按 Q 提前导出。请保留 FFmpeg、conhost 与可见窗口事件 ZIP。
3. 重新进行一次 Headless 图片验收。记录是否从 `headless_exit_unknown` 转成明确的 `mcp_startup` 等阶段代码，以及导出的 `cliExitCode/cliStdout/cliStderr`，不要上传原始 stderr/API Key。
4. 导出运行日志 ZIP，与窗口事件 ZIP 一并检查。平台登录与模型图片识别均必须现场确认，云端模拟不能代替真实验收。

回滚：使用 Git 还原该提交（已发布到本地的插件还需安装上一版 tgz），不清理用户业务数据或 Life 记忆。
