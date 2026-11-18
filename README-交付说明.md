# 大肥鱼 2.8.1-dev.3b.33.20 · 交付说明

## 本版解决什么

`.19` AI 模型页固定图片测试可识别并手动认可，但“运行诊断→全流程视频感知”仍然因插件内部 Python MCP 缺少 `BILI_VISION_DSH_ARGV` 报 `vision_config_error`。此版本新增单次、只读、可释放的 DSH 视频视觉 MCP/Node 宿主链路，为内部全链路 Debug 提供生产同级安全执行能力；同时在保存 DSH 模型后明确引导识图验收，认可后提示仍需真实视频测试。

## 文件

- `source/` 完整升级源码。
- `delivery/dsh-dafeiyu-life-2.8.1-dev.3b.33.20-vision-debug-route-fix.tgz` npm 安装包。
- `delivery/patches/2.8.1-dev.3b.33.19-to-20-vision-debug-route.patch` `.19→.20` Git Patch。
- `delivery/APPLY.md` 安装/回滚、`delivery/TEST-RESULTS.md` 离线验证、`delivery/COMMIT_MESSAGE.txt` 中文提交文案、`delivery/SHA256SUMS.txt` 校验和。

升级不应修改 `%USERPROFILE%\.dsh\bili-duty` 内的旧配置、发送结果未知账本、私信队列、凭据或 Life 记忆。当前仍为开发候选；Windows 真实图片/模型最终答复验证不由离线模拟替代。
