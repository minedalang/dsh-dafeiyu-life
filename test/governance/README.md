# 测试生命周期治理（维护者）

这份目录是 **测试维护规则**，不是发布历史。`full` 仍运行 `test/*.test.mjs` 以及 `test/test*.py` 的全部现行测试；已归档文件留在 `test/legacy/`，供单独审计旧发行快照。不能把失败改成跳过、删除安全断言或缩减 `full` 的测试范围来制造通过率。

## 每次修改代码时

1. 修改前/后运行 `npm run review:impacted-tests`（检查当前未提交的修改）；CI 会按 PR 基线自动列出受影响测试；改动生产源码却没有同步修改测试时必须在 `test/governance/reviews/` 记录判断与补测依据，否则 PR 检查失败，或 `node scripts/test-governance.mjs impact lib/changed-file.mjs`（指定源文件）。核对受影响的测试，包括 UI、外发权限、账号数据、跨进程、平台回执和隐私，记录需要更新/归档的旧假设。
2. 新增 Node/Python 测试先登记：`node scripts/test-governance.mjs register my-feature.test.mjs --owner=life --kind=behavior --intent="Verify the current behavior for this scenario"`（Python 文件以 `test` 开头、`.py` 结尾）。`owner`、测试目的和分类不能为空。
3. 改版时优先把过时的文案、函数调用方式断言**替换成真实接口/行为验证**，并在 `catalog.json` 的 `retiredAssertions` 留下旧检查、替代检查、原因、日期。不要因一个旧断言失败就迁移整份含有安全测试的文件。
4. 如果一个文件全部只验证**已终止且无继续意义的历史发行快照**，才允许归档：`node scripts/test-governance.mjs archive old.test.mjs --reason="..." --replacement="..."`。必须说明旧需求何时/为何失效、替代测试或当前契约在哪里。保护清单、核心快速测试、疑似安全测试会阻止直接归档。
5. 每次执行 `npm run check:test-governance`；本检查也已接入 Windows 测试入口、PR CI 和 GitHub Release workflow。未登记新增用例、无说明归档或安全锚点缺失都必须失败。**治理检查通过不代表功能测试通过。**

## 三类处理

- **保留**：仍有效的用户体验、授权、记忆遗忘、账号隔离、外发回执、读取限流、并发/跨进程一致性、出错恢复等行为；即使测试很老、目前失败，也要修好生产或重写测试。
- **改写**：职责/入口仍存在，但调用方式、页面措辞、状态来源、初始化顺序发生变化；用可验证的当前行为代替旧代码字符串匹配。
- **归档**：纯粹历史版本号、历史打包白名单、已替换的静态 UI/文档快照，没有当前仍有效的业务断言；保留历史文件和完整退役理由。

`catalog.json` 的 `baselineActive` / `baselinePython` 是旧测试初始清单，**并不表示已经逐文件验收或确认全部仍适用**。后续新增测试必须走 `registeredActive` / `registeredPython`；历史测试在碰到对应功能重构时逐个复核。`protected` / `pythonProtected` 是最小安全锚点，不是安全用例的全部清单，不能用“没有列进受保护清单”为理由归档权限、账户或回执测试。

## Windows 注意事项

普通 PowerShell 与管理员 PowerShell 分开顺序运行 `run-tests.ps1 -Mode full`；完整 TAP 和 Python traceback 保留在各次运行的 `step-XX.tap.log`。Windows 路径、CRLF、Python 子进程、符号链接权限应优先复现，不要用归档解决平台依赖问题。安全测试出现 SKIP 不得批准发布。

## 自动执行（无需日常手动运行）

- 在仓库首次执行 `npm install`/`npm ci`（不使用 `--ignore-scripts`）或现有 `run-tests.ps1` 时，会尝试一次性配置仓库级 `.githooks/pre-commit`；以后 `git commit` 自动执行快速的 **暂存区** 测试清单与安全覆盖校验，并提示相关测试。不会运行全量测试，也不会改动暂存文件。
- 如本机已有其他 Git Hook 或自定义 `core.hooksPath`，安装程序保留现有设置并提示；GitHub CI 仍会强制执行治理检查，不静默覆盖别人的 hook。
- PR 和推送 `main` 的 CI 继续运行完整校验；若生产代码变更没有配套测试或复核记录，PR 会失败。
- 旧测试不会由 Hook 自动删除。过时判断需要当前行为证据、替代覆盖与审计记录；这些由开发 Agent 在改动代码时同步维护。
- `npm run check:test-governance` 与 `npm run review:impacted-tests` 仍可选作排错命令，**不是用户每天要手动执行的步骤**。
