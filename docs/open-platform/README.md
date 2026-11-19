# 🧩 桌宠开放平台（开发中）

> 当前仅为生态预告与协议方向说明，**尚未开放真实接入**。

大肥鱼 Life 未来希望成为一个统一的生命运行时：

- **Life 负责大脑**：人格、记忆、情绪、自主生活、授权边界；
- **客户端负责身体**：桌宠、Live2D、3D 游戏、虚拟房间、网页挂件等；
- **统一开放协议**：让官方桌宠与社区桌宠都能接入同一个鱼鱼。

## 第一版页面现在会展示什么

- 官方桌宠与社区桌宠的生态愿景；
- 统一开放运行时协议的草案；
- 未来 2D / 3D / 多终端形态的路线图；
- 2.9.0 之后逐步开放的说明。

## 当前不会做什么

- 不发放真实开发者令牌；
- 不开放设备授权；
- 不保证页面展示的 API 路径和字段已经冻结；
- 不承诺当前版本已经支持第三方客户端接入。

## 长期目标

- **官方桌面陪伴**：让鱼鱼能够作为独立桌宠陪伴主人；
- **3D 生命世界**：支持面向 Godot / Unity / Unreal 的角色与世界扩展；
- **社区自由创作**：让开发者能够自由制作自己的鱼鱼客户端，而不是绑定固定外观或固定动画系统。

## 预览接口（草案）

```text
GET    /api/bili-duty/pet-bridge/v1/snapshot
GET    /api/bili-duty/pet-bridge/v1/events
POST   /api/bili-duty/pet-bridge/v1/interactions
POST   /api/bili-duty/pet-bridge/v1/chat/turns
POST   /api/bili-duty/pet-bridge/v1/expression-acks
POST   /api/bili-duty/pet-bridge/v1/world/observations
```

这些仅为预览草案。正式开放以未来发布说明为准。
