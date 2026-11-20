# 2.8.2-dev.26 · Issue #11 修复测试结果

**输入基线：** 本轮上传 `dsh-bili-scroll-plus2.zip`，`package.json` = `2.8.2-dev.25`。
**输出源码：** `2.8.2-dev.26`。
**执行环境：** Linux 容器、Node.js 运行时；没有连接真实 B站账号，没有触发任何平台写操作。

## 定向回归

- **Issue #11 新增测试：9 / 9 通过**
  - quick share 不再引用未定义 `limit`；
  - faster-whisper 官方 GitHub / PyPI / 模型入口可见；
  - 镜像 HTTPS 校验、去重；
  - uv 镜像无进展后跳过并切换；
  - 子进程无输出/总时限终止契约；
  - 无账号作用域或账号阻断时不读取 Episode；
  - 合法账号仅读取当前 scope；
  - Episode 存储损坏时降级附加诊断；
  - planner 计数与 Episode 诊断解耦、管理中心有清晰提示。
- **变更相关组合回归：50 / 50 通过**（9 个测试文件，包含安装器、Life Episode、Action Attribution、调度状态、管理中心及既有安全契约）。

## 工程检查

| 检查 | 结果 |
|---|---|
| `node --check index.js` | PASS |
| `node --check lib/asr-install.mjs` | PASS |
| `node --check lib/life-planner-status.mjs` | PASS |
| `node --check lib/management-console.js` | PASS |
| `npm run check:test-governance` | PASS · 598 Node + 94 Python active |
| `node selfcheck.mjs` | PASS |
| `npm run check:life-architecture` | PASS · 4 Mermaid / 128 unique code nodes |
| `npm run check:video-tool-contract` | PASS |
| `npm run check:context-budget` | PASS · 253 production JS files |
| `npm pack --dry-run --json` | PASS · 758 entries / 4,653,391 bytes |

首次 `npm pack` 使用容器默认 npm cache 时遇到已有 root-owned cache 的 `EACCES`；改用独立临时 cache 重新运行后通过。这是容器缓存权限问题，不是项目打包错误。

## 尚未执行 / 不能宣称通过

- Windows 普通 PowerShell `run-tests.ps1 -Mode full`；
- Windows 管理员 PowerShell `run-tests.ps1 -Mode full`；
- Windows DSH 管理中心实际账号未就绪、账号切换阻断、Episode 损坏场景；
- 真实国内网络中清华镜像无进展后的180秒终止与中科大/阿里云回退；
- 真实 faster-whisper / yt-dlp / PyAV 安装；
- 真实 Hugging Face 模型权重下载和完整 readiness；
- 真实转写运行。

## 发布判断

**源码级修复与离线定向测试通过；Windows / DSH / 真实网络验收未完成，不批准正式发布。**
