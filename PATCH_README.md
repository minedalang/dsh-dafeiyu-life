# DSH 2.7.1-dev.24 · 从 dev.23 升级说明

> 开发预览，未发布；默认不开启 Embedding，不授权任何新 B站外发。

本轮补丁唯一受支持的起点是已上传的 **`dsh-bili-scroll-plus2.zip`**（`package.json` 为 `2.7.1-dev.23`）。如果本地已经有未提交改动或 dev.24 其他来源的修改，不要直接叠加补丁；先将改动备份并核实差异。

## 用户会得到什么

新增本机 Qwen3 Embedding 语义候选检索、内置 llama.cpp Runtime 管理接口、本地向量索引与管理界面。安装或恢复不会自动下载模型；只有点击「启用并下载模型」后才开始下载、校验和启动。模型不可用时正常走旧版词法检索。

该能力复用原 `memoryRetriever` / `LifeMemoryGateway` 和权限/遗忘机制，不另建事实数据库，也不会因相似度命中而证明视频已看、评论已发或记忆仍有效。主 Session、主人私信与受 SocialContextAssembler 管理的社交路径已经接线；旧 `full` 模式与部分专业 Agent 仍未收口。

## Windows PowerShell 补丁应用

请先**停止 DSH Desktop**，备份 `$DSH_HOME/bili-duty/` 业务数据，再到本地源码仓库执行：

```powershell
git switch dev
git status --short
git apply --check .\DSH-2.7.1-dev24-from-dev23-original-CRLF.patch
git apply .\DSH-2.7.1-dev24-from-dev23-original-CRLF.patch
git diff --check
cmd.exe /c run-tests.bat
```

若仓库文本已全部转换为 LF，请改用 `DSH-2.7.1-dev24-from-dev23-normalized-LF.patch`，**两种补丁只能使用一种**。已有其他代码变更时，优先使用交付的完整源码对比合并，不强行应用补丁。

不使用命令行的用户可以在备份业务数据后，按现有 DSH 插件安装/升级流程使用平台安装包；大模型不是升级依赖。当前交付是源码开发包，不是已签名的 Windows 安装程序。

## 测试与发布边界

离线 Node 1992/1992 通过；Python 222 通过、1 跳过；插件自检和 `npm pack --dry-run` 通过。Windows、真实 llama-server + 639 MB GGUF 推理、真实 B站与持续运行未验收。`releaseReady: false`；不要合并 main、创建 Tag 或对外发布。

详细架构：`docs/architecture/2.7.1-dev24-local-embedding-recall.md`。
