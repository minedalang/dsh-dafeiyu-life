# .23 → .24 升级及发布门禁

1. 备份当前源代码、插件及 `%USERPROFILE%\.dsh\bili-duty` 运行数据。此补丁不应清空登录状态、记忆、队列或任何未知发送锁。
2. 若工作区是 `2.8.1-dev.3b.33.23-indexed-dash-long-video` 的未修改源码，在根目录运行：

```powershell
git apply --check ".\2.8.1-dev.3b.33.23-to-24-release-preflight-utf8.patch"
git apply ".\2.8.1-dev.3b.33.23-to-24-release-preflight-utf8.patch"
```

3. 完全退出并重启 DSH，验证当前版本。**在 Windows 原生仓库运行** `./run-tests.bat full`，确认跑到最后且所有必须通过专项为 PASS。
4. 该版本仍带 `-dev`；未完成真实 DSH 视频、DASH、旧版升级和 `-509` 等实机门禁前，禁止改正式 `2.8.1`、Git Tag 或发布市场。
5. 回滚：使用原 `.23` 备份恢复源码；用户状态文件原样保留。

本次所有代码更改仅是回归测试与文档/版本标识，不包含运行时新特性。
