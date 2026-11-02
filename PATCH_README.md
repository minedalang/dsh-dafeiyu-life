# 2.6.1 RC2 补充修复 · 适用于已安装 RC2 审查版

本补丁 **不是** 上一轮 RC1 → RC2 的完整补丁；须先有 `dsh-v261-rc2-reviewed.patch` 对应的 RC2 审查版源码。此补丁不适用于纯 RC1 (`4206ba6`)，也不能在原始其他 AI 的 RC2 Patch 上盲目应用。

本次修复待办完成回访的私信许可错误耦合、增加可配置检查间隔与手动检查，并允许对旧版未发送的误拦截逐条复核。**不会自动补发历史 blocked 或结果不确定的私信。**

## Git Bash

先备份 `$DSH_HOME/bili-duty/owner-todos.json`、`owner-todo-followups.json`、`config.json`，并确认工作区没有未提交的相关改动：

```bash
git switch dev
git status --short
git apply --check ../dsh-v261-rc2-followup-permission-hotfix.patch
git apply ../dsh-v261-rc2-followup-permission-hotfix.patch
node --test test/*.test.mjs
node selfcheck.mjs
```

运行 Windows 版完整回归仍使用 `cmd.exe /c run-tests.bat`，验证后可按附带 Commit 文档提交。工作区已应用补丁时不要再次执行 `git apply`。

## 验收

- 回访独立开关已开启，原请求来自同一个经过验证的私信 UID；后台私信监听和视频报告选择关闭，不应再误报“私信功能关闭”。
- 旧 `blocked` 仅能经用户逐条明确点击复核，且所有来源和回执校验通过后恢复为待考虑。原消息来源不一致的另一组继续拦截。
- 调整检查间隔后能看到下一次检查时间；点击“立即检查回访”不是强制发送，模型仍可保持沉默。
- 先在真实 B站测试号验证平台接口回执与实际接收。仍未正式发布 2.6.1，不创建 Release / npm / 市场版本。
