# 大肥鱼 Plus 2.8.2-dev.35 · 交付说明

本批从 **2.8.2-dev.34** 升级到 **2.8.2-dev.35**，只收口私信读取失败/账号隔离和 Life 局部视频续行异常。**没有修改30分钟私信列表兜底间隔**，也没有对真实 B站平台发起写操作。

交付内容：`source/` 是完整开发候选源码；根目录同名 `PATCH_FROM_2.8.2-dev.34_TO_2.8.2-dev.35.patch` 是增量补丁；附 `COMMIT_MESSAGE.txt`、`TEST-RESULTS.md`、`TESTING_2.8.2-dev.35.md`、`APPLY.md` 与源码中的 `docs/release/2.8.2-dev.35-dm-focus-closure.md`。完整源码与 Patch **任选一种方式**部署，不要重复应用。

请先做 `git apply --check`，然后按 Windows 验收教程确认：安静期仍30分钟、`ok:false` 不清除待核对、`-509` 仍维持退避、账号切换不会串账；Life 无候选不崩溃、局部视频每窗口成功/失败可从 trace 追踪。Linux 定向回归不代替 DSH 实机及 Windows 双环境全量测试。**不宣布正式版发布。**
