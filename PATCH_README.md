# 2.6.1 RC2 · 全社交 AI 待办接入补丁

本补丁基于 **`dsh-bili-scroll-plus2-v2.6.1-RC2-natural-todo-source.zip`**（上一轮主人私信自然待办修复版）。不是 RC1 → RC2 完整补丁，也不能直接应用到 dev.6、原始 RC1 或其他 AI 的未核验 RC2 Patch。

## 本次范围

- 主人私信继续使用 Owner DM Agent；主人/好友可信评论使用现有 trusted-social AI；普通好友/陌生人私信、普通评论使用现有 InteractionBatcher。
- 各入口在原有模型调用中同时生成自然回复和结构化只读待办提议，不增加第二次意图识别调用。
- 普通用户不再依赖关键词或固定句式判断待办；支持自然表达、错别字、分段消息和同 UID 近期上下文。
- 已启用陌生人私信时，首条也走现有 AI 回复调用；陌生人开关、回复次数、额度、审批不变。旧固定欢迎语设置保留兼容但停用。
- BV 分享链接只作 48 小时候选上下文，不自动接受任务；只允许公开视频搜索/观看，不增加任何 B站写操作权限。
- 聊天意愿和探索意愿分开；不想聊天不会阻断同轮 AI 理解独立只读探索提议，但仍会抑制聊天回复。

## 应用方法（Git Bash）

先备份 `$DSH_HOME/bili-duty/` 中的待办、回访、私信状态与配置文件，并确认工作区干净：

```bash
git switch dev
git status --short

git apply --check ../dsh-v261-rc2-all-social-ai-todo.patch
git apply ../dsh-v261-rc2-all-social-ai-todo.patch

git diff --check
node --test test/*.test.mjs
node selfcheck.mjs
```

Python 全量测试：

```bash
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python -m unittest discover -s test -p 'test*.py'
```

Windows 可继续运行 `cmd.exe /c run-tests.bat`。补丁已应用后不要再次执行 `git apply`。

## 验收重点

1. 开启陌生人私信入口后，普通用户首条私信也由 AI 自然回复；同一输出可提出 `todoDisposition/suggestedTodo`。
2. 普通好友/陌生人评论、私信提出“有空了解/看看/听听……”时，由 AI 语义理解；不是每条闲聊都创建待办。
3. 好友本轮不想聊天时，聊天回复不发送，但同轮 AI 仍可接受独立只读探索建议。
4. `defer/refuse/none`、证据不匹配、不同 UID 历史、超过 24 小时的旧上下文、无效 BV、写操作类型均不入队。
5. 同一消息重复轮询或模型重试最多建立一条待办；候选链接不自动变成待办。

仍为 `2.6.1 RC2` 发布候选。真实 B站私信/评论送达和运行时行为待本机验收；不创建 Release、npm 或市场版本。
