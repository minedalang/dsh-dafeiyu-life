# 2.8.1 发布前定向修订包使用方法

本包中的 `source/` 是可直接使用的完整项目源码；`PATCH_FROM_DEV_3B_33_25.patch` 则仅用于你本地现有的、**与用户本次上传 ZIP 完全一致的 `.25-ci-test-audit` 原始源码**。二者选一，**不要先替换 source/ 又应用同一个 Patch**。

## 方案 A：使用完整源码

先备份当前 Git 工作目录和本地鱼鱼数据（不要公开上传私密数据），再用 `source/` 的完整内容更新你自己的项目工作目录。检查 `git diff`，保留本地独有修改，勿盲目删除自己新增的配置和数据。

## 方案 B：在精准原版上应用 Patch

```powershell
# 在原项目 Git 工作目录执行；先检查无未提交修改
git status --short
git apply --check .\PATCH_FROM_DEV_3B_33_25.patch
git apply .\PATCH_FROM_DEV_3B_33_25.patch
```

**注意：** Patch 的输入必须是你上传 ZIP 对应的原版文件；如果本地已经有新的变动或已应用类似修复，先人工比较，不要强行套用。

## 本机定向复测

```powershell
node --test --test-reporter=tap --test-concurrency=1 test\v271-dev3-crosslang-todo-transaction.test.mjs
node --test --test-reporter=tap test\v281-readme-user-facing-contract.test.mjs
.\run-tests.ps1 -Mode full
```

全量脚本只有跑到末尾且没有失败/错误/安全测试未解释的跳过，才可能进入正式发布审查。不要将管理员运行或开始执行第 1 批当作全部通过。完整证据请保存在本机日志中，公开反馈时先脱敏。
