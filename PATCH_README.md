# DSH 2.7.1-dev.26 · dev.25 → dev.26 升级说明

本轮仅用于开发测试，尚未正式发布，**不会更改已保存的 B站公开发言授权**；`releaseReady:false` 不变。

准确基线：`DSH-2.7.1-dev25-full-source.zip`。请先停止 DSH Desktop，备份运行数据目录和本地尚未提交的源码修改，并确认 `dev` 分支基线一致。两种 Patch **只应用一种**，不可叠加。

```powershell
git switch dev
git status --short
git apply --check .\DSH-2.7.1-dev26-from-dev25-original-CRLF.patch
git apply .\DSH-2.7.1-dev26-from-dev25-original-CRLF.patch
git diff --check
cmd.exe /c run-tests.bat
```

若仓库统一为 LF 文本换行，改用 `DSH-2.7.1-dev26-from-dev25-normalized-LF.patch`。若 `git apply --check` 失败，不要使用 `--reject` 强行写入；优先根据完整源码确认差异。

## 本轮内容

- 自动 Life 的已核验公开搜索/视频资料读取，可在同轮再选择最多 2 步只读探索；保留原额度、意愿、账号、暂停和失败边界。
- 主评论“配置阻断 / 未观察到提出 / Life 拒绝 / 核验不确定”在管理中心分开显示，记录不含评论原文、UID、BV。
- **默认 `dmMode=only` 阻断 `bili_reply` 工具**：不要仅凭 `autoComment=true` 就认定可自动发主评论。若希望鱼鱼可能公开发表原创主评论，必须在管理中心有意识地确认报告模式、主评论授权、轮次及日额度；开启不代表强制发言。

技术图与唯一层责任见 `docs/architecture/2.7.1-dev26-life-continuation-and-comment-diagnosis.md`。Windows 真机、真实平台及长期运行仍待验收。未合并 main、未创建 Tag，未发布。
