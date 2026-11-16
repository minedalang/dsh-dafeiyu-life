# 2.8.1-dev.3b.28 → 2.8.1-dev.3b.29

本 Patch 精确对应此前交付的 `dev.3b.28` 完整源码。不要把完整包与 Patch 叠加。

在 Windows PowerShell 的项目根目录执行：

```powershell
git -c core.whitespace=cr-at-eol apply --check .\dafeiyu-2.8.1-dev.3b.28-to-dev.3b.29.patch
git -c core.whitespace=cr-at-eol apply .\dafeiyu-2.8.1-dev.3b.28-to-dev.3b.29.patch
node --test test/v281-dev3b29-video-debug-life-tree.test.mjs
python -m pytest -q test/test_dev3b29_node_error_codes.py
node selfcheck.mjs
npm pack
```

真实生效需让 DSH 加载新版本并重启，光 Git commit 不会自动更新已安装插件。首次运行先测试本地 Ollama；如果六个黑窗仍出现，应按最新采集核实 Ollama 进程，不要重复替换 FFmpeg。然后测试 DSH 识图，导出新的常规 B站日志以取得 CLI Node 错误代码。

不运行云端全量 Node 测试；不调用真实 B站 写操作或 npm 发布。
