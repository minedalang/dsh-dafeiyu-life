# dev.6：动态评论、内容 ID 与人生记忆跨系统审计

## 触发背景

主人要求对一条 B站动态下的评论回复。先前 `bili_comment_manual` 强制要求 BV，导致只有动态 ID 的场景无法发送；若绕过 BV 校验，旧记忆/反思也会丢弃没有 BV 的 comment 事件。

## 端到端边界

| 层次 | 视频旧路径 | 动态 dev.6 路径 | 失败策略 |
|---|---|---|---|
| 主 Session 工具 | `bili_comment_manual(bvid)` | `bili_dynamic_comment_context(dynamic_id)` → `bili_dynamic_comment_manual(dynamic_id,target_rpid,root)` | 没有主人当次明确确认不得写入 |
| 评论区解析 | BV → 视频 aid/type | 动态详情 `basic.comment_type` + `comment_id_str/rid_str` → oid/type | 动态/类型不一致、缺 OID 则拒绝 |
| 目标核验 | 视频 rpid/root | 真实动态评论区中检查目标 rpid/root | 未找到/跨动态/跨楼层拒绝 |
| 回执 | 现有视频发送回执 | 实际返回 rpid 才判定成功；不确定不重试 | no_retry、额度冻结直到人工核验 |
| 去重/额度 | session manual actions + comment 日限额 | 同账本 kind=comment，目标以 `dynamic:...` 命名空间区分 | 重复请求拒绝，不混淆视频 |
| 人生事件 | comment + BV | comment + `contentType:dynamic` + string `dynamicId` | 只有平台确认成功才写 |
| 记忆与反思 | `LifeMemoryCoordinator` → gateway / reflection | 同一协调器、同一衰减记忆 + 候选 | 遗忘后不从 archive/candidates 回填 |
| 社交意愿/权限 | 社交域现有授权 | **无自动动态评论许可**；仅主人在主 Session 显式确认 | 动态内容、评论指令永远不是主人授权 |
| 备份/恢复 | episodic version 1 | 保持旧 schema，新增可选 string 字段 | 旧数据可读；不复制原私密内容 |

## 高精度 ID 与评论区类型

动态 ID 和评论 rpid 是完整十进制**字符串**，不得强制 `Number()`。动态 `oid` 和 `comment_type` 必须来自受信动态详情；图文为 11，文字为 17，视频动态不按此通道发送。不同资源引用不复用同一个 key。评论区 `oid` 不可直接猜成动态 ID。

## 反思、记忆与隐私

`LifeMemoryGateway` 仅对已确认的 `comment` 事件接受动态 ID；`watch/social` 旧行为仍维持 BV 约束。`LifeReflection` 把动态事件当作真实候选，不因缺 BV 就抛弃，但给模型的提示词只能用当前可衰减副本的证据正文，不可把候选永久元数据中的精确动态 ID 塞回模型。`fuzzy/trace/forgotten` 阶段都会移除精确动态 ID，语义检索、反思重验证沿用现有遗忘规则。动态互动不等于观看视频，不作为视频兴趣标签的来源。

## 暂不覆盖

本版本不实现 B站上所有动态形态（如转发动态、视频嵌入动态）的评论自动映射，不开放自主自动动态回复，也未对真实 B站账号执行公开写入端到端测试。默认失败关闭；后续必须使用官方/真实响应样例补充正反向用例。
