# dev.63 · 同一现役角色的本机停机维护

本入口是显式人工维护，不是 Life 工具、日常业务备份或 HTTP 恢复接口。复用 dev.26 的分盘引擎和原启动、账号复核保护；旧宽泛 CLI 仍不随包分发。日常恢复继续使用现有便携业务/记忆增量修复。

**完整停机快照包含私信、凭据、账号及事务账本、记忆、情绪、模型文件及其他现役数据，未加密。只存受本机 ACL/BitLocker 保护的独立位置，不上传、不分享、不提交 Git。** 包含实际生效核心与外置 V1/V2 分区，不包含整个 DSH 宿主、Ollama 独立模型目录、操作系统或外部平台状态。哈希证明文件一致，不证明数据库无逻辑损坏、不提供签名。原 ACL/所有者、文件时间、硬链接关系和物理断电持久性不在保证范围。

## 使用前

在管理中心核对实际生效核心运行区路径。完全退出 DSH Desktop、Headless 和相关 Node/Python/ffmpeg/模型进程。进程检查保守，其他同名程序也可能阻断；不要绕过。以下在安装插件的目录（含 tools/cold-maintenance.mjs）或对应源码根使用 Node 22+ 和 PowerShell；路径仅示例。备份目标必须尚不存在，与任何现役分区或原核心引导不重叠，并有足够空间。角色已建立且身份 UUID、创建时间有效才允许使用新入口。

```powershell
$root = 'D:\DSH\bili-duty'
$snapshot = 'E:\fish-backups\offline-2026-11-28'
node tools/cold-maintenance.mjs plan-full --root "$root"
node tools/cold-maintenance.mjs backup-full --root "$root" --to "$snapshot" --stopped --confirm CREATE_LOCAL_DSH_SNAPSHOT
node tools/cold-maintenance.mjs verify-full --snapshot "$snapshot"
```

`plan-full` 不写入；`backup-full` 停机核验、按真实布局读取全部分区、逐文件 SHA256、暂存及来源复核成功才发布。`verify-full` 独立验证快照。输出 `activationAllowed:false`：快照本身不能启动，包含禁止启动标记，根和子目录均被启动门禁拒绝。不要删除标记、拷贝/重命名原始分区来绕过；保护不能对抗人为剥离标记、改源码或其他设备独立运行。普通快照完成后可以恢复正常启动，不证明后续历史没有变化。

## 计划维护：在完全停机期间建立一次性封存

仅当打算在保持停机的维护窗口内更换或修理磁盘，且原路径可重建时使用。封存期间 DSH 启动被拒绝，不是日常备份或睡眠。选择 **尚不存在** 的快照路径，或对已创建、与现役逐文件一致的新版快照单独封存。

```powershell
# 二选一；不要对同一目标重复创建
node tools/cold-maintenance.mjs backup-sealed --root "$root" --to "$snapshot" --stopped --confirm CREATE_AND_SEAL_DSH_STATE
node tools/cold-maintenance.mjs seal-full --root "$root" --snapshot "$snapshot" --stopped --confirm SEAL_DSH_COLD_CHECKPOINT
node tools/cold-maintenance.mjs plan-sealed-recovery --root "$root" --snapshot "$snapshot"
```

封存必须与现役完整数据及拓扑一致，原宿主引导旁持久检查点不随核心目录丢失。普通旧快照不能事后追认。若封存失败，先用预检确认是未封存或 preparing，禁止手工删检查点。若所有原分区仍完整且没有开始恢复，解除封存后再启动：

```powershell
node tools/cold-maintenance.mjs release-seal --root "$root" --snapshot "$snapshot" --stopped --confirm RELEASE_DSH_COLD_CHECKPOINT
```

若封存期间原核心/外置记忆/模型分区丢失，保持原宿主引导和检查点及快照，原路径父目录可访问。先预检；仅 `recoverAllowed:true` 时可以恢复缺失分区，所有幸存数据必须逐文件一致：

```powershell
node tools/cold-maintenance.mjs plan-recovery --root "$root" --snapshot "$snapshot"
node tools/cold-maintenance.mjs recover-sealed --root "$root" --snapshot "$snapshot" --stopped --confirm RECOVER_SEALED_DSH_STATE
```

外置分区先发布、核心最后发布；中途失败保持冻结，按原快照重试，已恢复且一致的分区不再覆盖。完成全体复核及原账号复核标记后才解除检查点。封存被消费，不可再用其恢复后续历史。没有检查点、路径改变、幸存数据不同、检查点和快照同时丢失时拒绝激活。不得手工删除检查点或恢复标记。`restore-freeze.json` 由原账号确认流程处理，不是重新授权。

## 同状态修复及回滚

普通快照只允许在当前全部非可重建业务文件和目录与快照一致、身份和拓扑一致时进行 `restore-full`。这是缓存修复，不是任意时间回退。先用 `plan-recovery` 验证其 `nextAction`；没有 `restore-full` 不要执行。准备全量暂存及持久冻结，保留恢复前原目录（`*.pre-restore-<id>`）后按分区替换，全部复核才解除冻结。原件、暂存均不得当作另一角色启动。故障时保持停机；若自动回退不成功或停机证明丢失，重确认停机后执行：

```powershell
node tools/cold-maintenance.mjs restore-full --root "$root" --snapshot "$snapshot" --stopped --confirm RESTORE_FULL_DSH_STATE
node tools/cold-maintenance.mjs rollback-full --root "$root" --stopped --confirm ROLLBACK_FULL_DSH_STATE
```

第二条只适用于仍有未结恢复事务且原件可核验时；不是已完成恢复后的历史撤销按钮。恢复前原件不会自动清理。空间估计不是预留，全部暂存和原件可能占较大空间。恢复/回滚过程再次核验停机，失效时保持冻结，不强行重试。

如仅 V2 模型区丢失，当前业务仍完整，可按 `plan-model-recovery --root ... --snapshot ... --to ...` 和 `recover-models ... --stopped --confirm RECOVER_DSH_MODELS_ONLY` 恢复已知模型文件到全新位置，不导入历史业务或执行程序。无封存且核心/记忆损坏时只能使用 `plan-disaster-rescue --snapshot ... --to ...`、`rescue-disaster ... --stopped --confirm RESCUE_DSH_OFFLINE_ONLY`、`verify-rescue --to ...` 进行隔离救援；不激活。便携包仍使用 portable-backup-rescue.mjs。以上只接受新版有隔离标记的冷快照，旧宽泛 CLI 留在源码供历史维护。

## 历史差异与未结事务（dev.63）

`plan-recovery` 在角色与拓扑可核验时返回 `protectedComparisons`：逐分区分别列出受保护文件、目录的 identical/currentOnly/snapshotOnly/changed 数量。已知可重建缓存按原策略排除。数量不等于可恢复记忆条数，不含正文、文件路径或哈希；读不到或拓扑异常时不保证有报告。`protected-business-different` 时不能 restore-full。

已隔离救援目录可继续只读对照：

```powershell
node tools/cold-maintenance.mjs plan-rescue-merge --to "$rescue"
```

输出仅供核对，已知撤销并集统计不证明全部不可回退事实齐全（complete:false）；不修改现役或救援数据，不激活或生成合并授权。未结事务与封存均阻断原引导及迁移路径的离线写操作；隔离救援及其子路径不作迁移目标。模型重绑定在发布和回退前后复核停机与事务/路由，失去证明时不得自动解除冻结。重新停机后使用原 rollback-full 入口核验并回退。现有门禁不是 OS 全局互斥锁，不能替代实际停机与独占维护。

## 尚未完成

普通历史快照的任意业务覆盖、无法核验遗忘/撤权/真实外发/未知事务后的灾难激活、跨设备迁移与跨设备唯一主体锁未开放。现有保护是同一宿主原路径上的维护协议，不是跨设备排他机制，也不是跨文件系统的物理原子事务。Windows/DSH 真实停机、磁盘异常、权限、PowerShell 安装及 full 验收仍待维护者。先用独立测试副本演练，不对唯一真实数据进行故障注入。
