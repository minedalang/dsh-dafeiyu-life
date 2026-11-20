# 2.8.2-dev.34 → 2.8.2-dev.35

1. 在项目根目录用 `node -p "require('./package.json').version"` 确认已安装的是 **2.8.2-dev.34**。
2. 备份个人改动，先执行 `git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.34_TO_2.8.2-dev.35.patch"`。
3. 仅当校验通过时执行 `git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.34_TO_2.8.2-dev.35.patch"`。
4. 按 `TESTING_2.8.2-dev.35.md` 检查私信哨兵/失败回执和 Life 局部窗口。失败时不要强制覆盖/重置账号数据。
5. ZIP 的 `source/` 与 Patch 是互斥的两种使用方式，不能重复应用。本批无真实平台外发、Git 提交或 npm 发布。
