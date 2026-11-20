# 2.8.2-dev.26 · Issue #11 修复交付说明

**基线：** 本轮上传的 `dsh-bili-scroll-plus2.zip`，`package.json` 版本为 `2.8.2-dev.25`。
**交付：** `2.8.2-dev.26`。
**范围：** 仅修复 GitHub Issue #11 的 faster-whisper 安装体验、快速分享保存异常、Life 决策状态读取被 Episode 作用域错误连带阻断。
**未实施：** 多候选自主视频探索新方案；没有更改视频感知流程。

## 文件

- `source/`：完整 dev.26 源码。
- `PATCH_FROM_2.8.2-dev.25_TO_2.8.2-dev.26.patch`：从本轮 dev.25 基线应用的增量补丁。
- `COMMIT_MESSAGE.txt`：中文项目可直接采用的 Conventional Commit 文案。
- `TESTING_2.8.2-dev.26.md`：Windows / DSH 人工验收步骤。
- `TEST-RESULTS.md`：本轮真实执行的离线测试与未完成项目。
- `APPLY.md`：补丁安全应用说明。

## 三项修复

1. 快速分享保存不再引用未定义 `limit`，不重新引入已取消的每日分享硬上限。
2. Life planner 核心决策计数/心跳独立返回；只有当前账号作用域合法且未阻断时才读取 Episode。Episode 文件损坏或附加诊断失败不再让整个 planner 状态接口返回500。
3. faster-whisper 官方 GitHub、PyPI 包和模型权重入口在管理中心可见；PyPI 安装增加无进展检测、网络超时和 HTTPS 镜像回退，模型权重下载也有无进展与总时限。

## 安全边界

没有修改 Episode `scope()`，没有在账号未就绪时读取 Episode，没有跨账号迁移或恢复数据；没有新增外发授权或每日分享硬上限。ASR 仍需使用者明确点击安装，安装不会自动启用转写或触发视频观看。

## 发布状态

**dev.26 尚未正式发布。** 离线定向回归通过，但 Windows 普通/管理员 PowerShell full、真实 PyPI 镜像回退、真实 Hugging Face 模型下载与 DSH 管理中心端到端仍需维护者验收。
