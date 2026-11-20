# 2.8.2-dev.34 · Windows / DSH 验收说明

## 1. 补丁应用（从 dev.33 升级）

在 PowerShell 进入项目根目录。先保存个人修改，不要 `git reset --hard` 或清理用户数据。

```powershell
node -p "require('./package.json').version"
git status --short
```

**必须确认是 `2.8.2-dev.33` 且未修改本补丁将触及的相同代码**，否则先协调差异。下载补丁到项目根目录：

```powershell
git -c core.whitespace=cr-at-eol apply --check ".\PATCH_FROM_2.8.2-dev.33_TO_2.8.2-dev.34.patch"
```

仅在检查成功后执行：

```powershell
git -c core.whitespace=cr-at-eol apply ".\PATCH_FROM_2.8.2-dev.33_TO_2.8.2-dev.34.patch"
node -p "require('./package.json').version"
```

预期版本 `2.8.2-dev.34`；如果校验失败**不要加 `--reject` 或强制覆盖**，提交失败的路径再定位。完整 ZIP 中的 `source/` 是替代交付方式，不要解压覆盖后又重复打补丁。

## 2. 开发机只读/定向验证

```powershell
node --check index.js
node --check lib/management-console.js
node --test test/dev4-headless-model-sync.test.mjs test/v281-dev3b22-vision-headless-integration.test.mjs test/v282-dev32-local-vision-controls.test.mjs test/v282-dev33-closure.test.mjs test/v282-dev34-closure.test.mjs
node selfcheck.mjs
npm run check:video-tool-contract
npm run check:context-budget
npm run check:life-architecture
npm run check:test-governance
npm pack --dry-run
```

Python 按 Windows 实际环境解释器运行：

```powershell
$env:PYTHONPATH = (Join-Path (Get-Location) 'lib')
python -m unittest discover -s test -p 'test_preview_vision.py' -v
python -m unittest discover -s test -p 'test_v281_dev3b16_preview_storyboard.py' -v
Remove-Item Env:PYTHONPATH
```

## 3. DSH Windows 真实操作验收（请务必保留截图和日志）

1. **确认插件版本与页面**：DSH Desktop 重启并读取插件，设置首页导览显示 `2.8.2`；不再出现“可回溯的真实观察经历”的模糊标题。设置中可以直接找到 Ollama 模型下载/删除按钮。
2. **视频档位**：「视频探索」只存在轻量/均衡/详查的全局帧数（12/24/48）；无 4/6 格切换。保存后真实刷新，不能再报 `dmFollowAutonomyEnabled`，日志显示固定12格。若仍报错，记录完整 API 回执和 DSH 插件实际安装版本，勿忽略失败继续。
3. **运行诊断 BV**：仅输入 BV，不触发“此处修改尚未保存”。点击只读诊断后能按时间取得 12/24/48 个采样时刻，对应 1/2/4 张12格分镜。模型有回复≠模型完全准确；查看 Life 是否收到有效分镜。
4. **Desktop 来源模型能力**：选一个自定义非全局 Provider 的来源模型，点击「补充图片与思考能力」，预览→明确确认；重新载入来源模型应出现补充声明。**Headless 尚未改变**。选择真实支持图片的模型再执行独立图片测试；文字测试成功不能代替图片测试。
5. **Headless 取消同步**：准备同一 Provider 中两个已配置型号，选择其中一个点击「取消同步」，检查确认对话框，执行后仅该型号从 Headless YAML 消失，另一个仍存在并可重新验证；Desktop 两个型号均保持。请先备份目标 YAML，且不要选唯一用于生产任务的模型。必要时可从生成的 `.bak` 恢复。
6. **MiniCPM 旧用户**：如果已装 MiniCPM 1B，可继续选中与运行，并能选择删除；点击下载应明确拒绝，不会开始拉取。Qwen3.5 2B/4B 可以正常下载、启用、删除。**Ollama 删除会移除共享权重，影响其他程序**，必须二次确认；请先使用测试机器，不要删除实际需要的模型。
7. **旧用户兼容**：历史保存过 `visionBoardTiles=4/6` 时，实际分镜仍固定12格；旧私信、关注授权、记忆和数据保持不变。
8. **网络/语音/成本**：同视频二次转写 `cacheHit=true` 时 ASR 延时显著下降，但这是读取缓存不是重新识别；更换模型与语言应按现有规则失效。视频网络预算、账号安全和真实平台回执门禁仍需检验。

## 4. 发布门禁与失败处理

- 开发环境仅完成**定向测试**，不代表 Windows 全量通过。请在正常/管理员 PowerShell 两种环境分别运行 `./run-tests.ps1 -Mode full` 并保存完整日志。
- 若 Headless YAML 发生部分同步状态异常，停止再次保存，先备份并比较来源、目标、`.bak`，不要无条件“同步所有 Provider”覆盖用户配置。
- 若补丁需要回滚且补丁之后没有继续编辑相同文件，可在项目根目录先做 `git apply -R --check`，检查成功后 `git apply -R`。切勿执行破坏性 reset。
- 用户的 Windows DSH/Ollama 真实模型删除、Headless 配置写入、B站网络流量与全量测试未完成之前，**禁止宣布2.8.2正式版通过**。
