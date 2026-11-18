# 2.8.1-dev.3b.33.22 · 定向验证记录

- Life 独立时间控制与既有 Life V2／Video 预设单测：**22/22 通过**。
- 其他 8 份 UI/设置定向测试：**39 通过，2 失败**。两条失败为旧 README 文案断言及 `item.save.click()` 静态实现断言；在**未修改 `.21` 基线**逐一复跑，结果相同，因此不是本次引入的回归。没有将其伪称为通过，也未修改无关功能迎合断言。
- `node --check`：`index.js`、`client.js`、`management-console.js`、`life-settings-control.mjs` 均通过。
- `check-life-architecture.mjs`、`check-video-tool-contract.mjs`、`selfcheck.mjs`、`npm pack --dry-run --ignore-scripts --json`：通过。
- `.21 → .22` Git UTF-8 Patch：独立 `git apply --check`／`git apply`／逐文件 SHA-256 比对通过。
- `.19 → .22` Git UTF-8 累计 Patch：真实中文文件名 + 原 BAT CRLF，独立 `git apply --check`／`git apply`／逐文件 SHA-256 比对通过；不包含路径字面量 `#U...`。
- Windows DSH、真实 B站和真实视觉模型：**未执行**，由使用者实机验收。
