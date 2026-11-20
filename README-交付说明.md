# 2.8.2-dev.25 · 交付说明

**基线**：用户于本次会话上传的 `2.8.2-dev.24` 完整源码 ZIP；交付源码标识为 `2.8.2-dev.25`，并非已经发布的正式版。

本批修复 Windows DSH 合法长视频局部时间窗口被 Host 错拒的问题、videoshot 原始时间索引超过3000格时截掉视频尾部的问题，及新采样协议在 Node 证据验证器中被误拒的连锁问题。未更改社交写权限、Life 独立意愿、原视频 CDN 安全和资源预算。**架构接线未变**。

交付包含完整 `source/`、与本次上传 dev.24 完全一致的基线补丁、中文 Conventional Commit 文案、Windows/DSH 验收教程和实测结果。**源码覆盖与 Git Patch 是两种替代使用方式，不能同时应用。**

应用前应先备份并核对版本、文件修改与 `git status --short`；补丁必须先 `git apply --check`。已经在原始 ZIP 重建的基线上通过实际 Patch 回放与文件逐一比对。由于压缩包不带本机 Git 历史，不能声称已经验证你的工作区与 Git HEAD。

离线 Node 38/38、Python 26/26；`selfcheck`、架构、视频契约、上下文结构、测试治理及 npm 包预览通过。此统计**不是 Windows full**。Windows 普通/管理员完整回归、真实 DSH/视频播放回执及 M2/M3 验收仍然缺失，正式发布被阻断。

详细操作参见交付包 `TESTING_2.8.2-dev.25.md`，结果参见 `TEST-RESULTS.md`，技术原因参见 `source/docs/architecture/2.8.2-dev25-long-focus-index-closure.md`。
