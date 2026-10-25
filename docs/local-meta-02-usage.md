# 本地档案基础接口与验收说明

2026-10-26。源码／测试 `23ef759c`。这是第二批程序接口；**正常游戏尚未使用新档案库，也没有新的用户按钮**。产品入口在第三批接入。实现与证据见[第二批验收](local-meta-02-review.md)，规则见[局外设计](local-meta-architecture.md)。

## 初始化与数据范围

```js
import { createMetaStore } from '../src/local-meta/idb-store.mjs';
import { createMetaCodec } from '../src/local-meta/codec.mjs';
import { createProfileRepository } from '../src/local-meta/repository.mjs';
import { originalSaveCodec } from '../src/local-meta/original-save-codec';

const repository = createProfileRepository({
  store: createMetaStore(),
  codec: createMetaCodec(originalSaveCodec)
});
```

此例是仓库模块导入路径示意，供后续界面使用，不是要求在现有生产网页控制台直接执行。浏览器端需要可用IndexedDB和Web Crypto；工厂本身不读取旧资料，不创建档案。数据库默认 `pokerogue-local-meta` v1，IDB适配器支持注入工厂和独立测试库名。

原GameData保持原trainerId／secretId、解锁位、最高IV、统计、蛋、券和配招字段。新profile只增加包元数据。所有头像暂限定为 `default`，目录／档案各自schemaVersion=1。复杂原session内部结构只保留，不借导入执行原战斗或奖励。

## 可调用操作

| 接口 | 行为 |
|---|---|
| `list()` / `read(profileId)` | 只读目录／完整档案；坏主档报错，不自动建新档或偷偷回退 |
| `create(originalSystem, options)` | 原初始化系统资料必须已通过原校验；新建包，不生成或补发资源 |
| `previewLegacy(source, {sourceId, displayName})` | 验证、生成可展示的方案；不发布档案；同源暂存可跨重开找回 |
| `install(plan)` | 持久暂存→重读校验→同事务发布包／目录／去重记录；重复同源返回已有profileId |
| `acquire(profileId, owner, ttlMs)` | 默认30秒、支持1—60秒的单档写者租约，返回owner/token/expires |
| `renew(profileId, lease)` / `release(profileId, lease)` | 未过期原token才可续租；迟到旧release不能清除新锁 |
| `save(profileId, expectedRevision, lease, mutation)` | 同步回调产生完整包；CAS成功后revision+1，与目录和备份同事务提交 |
| `setActive(profileId)` | 当前／目标档有活跃写者则拒绝；同时验证目标包，不指向缺失或坏档 |
| `exportArchive(profileId)` / `previewArchive(archive)` | 完整个人包与校验和，不含新库活跃租约；可能保留私密旧源凭据，文件不得公开 |
| `importArchive(archive, {expectedRevision, lease})` | 先预览；新ID单独安装，已有ID需显式完整替换，其他档案不被删除 |
| `recoveryPoints(profileId)` | 首次迁移／导入快照、最近5份自动快照，以及上一次恢复前有效包 |
| `restore(profileId, point, expectedRevision, lease)` | point为 `origin`、`recovery` 或0—4自动快照序号；完整回退资源／账本，新revision高于本机与所导入包两者 |

mutation不能是异步函数，不能返回Promise，也不能改profileId、原trainer身份、createdAt或迁移来源。普通保存不能移除旧ledger记录；完整恢复是显式回退，不是按字段合并。repository不执行ledger中的任何奖励。

首次`create`允许active为null；界面应在用户明确选择后调用setActive。lease只用于本机并发，不作为联机身份，也不随导出带到另一设备。

## 旧格式入口

- `captureLegacySource(storage)`：原IDB同事务快照，检查旧实验租约，捕获settings/tutorials/prLang。偏好与IDB跨存储不原子，迁移前须关闭旧页面写者。
- `legacyBackupSource(backup)`：接受现有 `pokerogue-early-backup` v1并明确提取records与偏好；不声称包含正式联机outbox或房主文件。
- `prsvSystemSource(text)`：原AES包装、原短键转换、原解析与额外校验，生成系统资料迁移源。
- `previewPrsvSession(text)`：仅返回原session及未确认归属；缺本人资料时不会建立空收藏。

`sourceId`是应用保存的稳定导入来源标识，不能每次重试随机更换。同一来源已迁移后出现不同内容会拒绝自动新建第二份；应展示冲突，让后续界面明确选择完整导入／恢复，不自动把两份资源相加。

旧三个槽位保留legacySlot，默认ownership=`unconfirmed`。正式coop-play-v1、房主房间、旧localStorage base64与旧hatch-commit没有本批自动迁移器；应保留原文件，通过后续专用兼容流程处理，不能误送进原session解析器。

## 蛋的字段

待孵化条目为 `{sourceRunId, eggId, eggTimestamp, state, terminal}`，对应本人原蛋id与timestamp，原蛋达到孵化条件才可关联。

- `waiting-terminal`时terminal必须为null。
- `released`时只能是victory／defeat，并携带终局receiptId；paused不是终局。
- 本批只做数据校验与持久化，不据此自行授予、移除蛋或播放孵化。终局记录的真实性、库存保留和原生成结果事务由后续成果批实现。

## 当前可复验的内容

```powershell
cd E:\pokeregue\pokerogue-early
node --test --test-concurrency=1 tests/local-meta.test.mjs tests/local-save.test.mjs tests/coop-profile.test.mjs
```

会在 `build/local-meta-02/original` 和 `standalone-codec` 构建独立测试包，使用fake-indexeddb合成资料，不读取真实浏览器存档。不要同时运行第二份同名测试，以免互相清理这两个测试输出目录；不使用／清理build/coop-runtime。

第三批接UI后人工验收：全新浏览器首次建档、重启继续、两个档案切换不串档、三个旧槽显示／归属确认、取消迁移不写资料、重复确认不重复建档、另一页面写入时阻止切档、导入预览和坏文件拒绝、恢复前备份、存储不可用时明确报错。冷启动离线和文件掉电保证仍需发行批实测。
