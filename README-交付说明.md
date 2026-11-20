# 大肥鱼 Plus · 2.8.2-dev.34 交付说明

基线：`2.8.2-dev.33`，目标：`2.8.2-dev.34`。请**任选一种**：在已安装 dev.33 的源码上应用顶层 Git Patch；或者使用 ZIP 内 `source/` 全量源码。不要重复叠加。

- 增量 Git Patch：`PATCH_FROM_2.8.2-dev.33_TO_2.8.2-dev.34.patch`；使用 `git -c core.whitespace=cr-at-eol apply --check` 预检。
- 中文 Commit 文案：`COMMIT_MESSAGE.txt`；未执行 Git 提交、推送或 npm 发布。
- Windows/DSH 真实验收说明：`TESTING_2.8.2-dev.34.md`。
- 离线测试报告：顶层 `TEST-RESULTS.md`；源码变更记录在 `CHANGELOG.md` 和 `docs/release/2.8.2-dev.34-model-and-video-closure.md`。

Headless 取消同步**仅删除一个后台模型路由**，不会从 Desktop 删除模型，也不会删除 Ollama 权重。MiniCPM 1B 停止新下载但保留历史使用和删除入口。分镜固定12格，总帧额度仍按三档。Windows 全量测试和真实配置写入仍未验收，不能发布正式版。
