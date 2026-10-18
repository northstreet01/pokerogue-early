# VS-01 原类联机接缝交付记录

日期：2026-10-18。代码基线：`80ae45f6ca1b5d1c53e7a789c52cefe653624ecb`；分支 `feature/vs-01-original-coop-bridge`。本文是内部接缝验证记录，不是原 UI、正式选队、服务器重启或跨设备可玩声明。

## 1. 结论与范围

本批真实跑通：

```text
两个真实 WebSocket 客户端
→ server/formal-coop-service.mjs（正式串行/去重/ACK 协调）
→ server/original-coop-adapter.mjs（八方法）
→ 房间独立原类 Worker（server/original-rule-host.mjs）
→ shared／personal 投影（Worker 内用原 codec 恢复后读取）
→ 客户端真实 PlayerPokemon 恢复（src/coop/original-client-model.mjs + 原 bundle codec）
→ captureAppliedState 从已应用模型重新提取
→ 正式 createSnapshotConsumer 哈希核验与 ACK
→ 首战真实行动→战后整备→战前换人/拒绝→第二战真实 FIGHT 提交
```

- 第二战双方 FIGHT 均被服务器接受；固定夹具 seed 的实测运行继续到下一 revision（revision 10），双方再次收到真实快照。更换 seed 的连续运行可能在第二战后命中未支持原始阶段并以 `RUNNER_FAILED` 安全失败，未提交候选、未广播假结果；该限制见第 6 节。
- 未接真实 lobby／原选队／双方独立身份／原 UI／落盘重启／跨设备；固定 trainer identity 与固定队伍仅是 VS-01 内部夹具。
- 默认生产入口未改：未注入 adapter 时仍 `ADAPTER_UNAVAILABLE`；测试进程显式注入真实 adapter。

## 2. 变更文件

```text
server/original-coop-adapter.mjs       八方法桥、房间 Worker 生命周期、intent outbox
server/formal-coop-service.mjs         事件 scope 过滤与 eventId/revision 标注
server/original-rule-host.mjs          新增薄 RPC 白名单
src/server/native-entry.ts             纯校验、checkpoint 校验、shared/personal 投影
src/server/original-runtime.ts         RPC 分发
src/coop/original-client-model.mjs     客户端真实原模型应用／重提取
tests/coop-original-bridge-vs01.test.mjs  双 WS 接缝验收
docs/mvp-vs-01-native-bridge-2026-10-18.md
```

未修改伤害、经验、成长、随机或道具公式；未新增依赖；未改冻结 fixture、旧测试或实验入口。

## 3. 八方法实现

| 方法 | 实现 |
| --- | --- |
| createInitialContext | 为 runId 创建 Worker，调用 `native-open-to-input`，固定夹具 parties/eggState；返回 envelope context |
| describeDecision | 由原 checkpoint decision 导出；wait-actions/switch 为 all，preparation 为 incremental（只列未 ready 席），continuing 为 auto |
| validateAction | FIGHT 用 `native-validate`；整备用新增 `native-validate-preparation`；换人用 `native-validate-switch`；均只恢复并校验，不建候选、不扣款、不前进 RNG |
| advanceToDecision | FIGHT：`native-submit`→`native-run-to-boundary`；整备：`native-prepare-action`；换人：`native-switch`；再沿原队列推进到下一真实停点（含 SelectModifierPhase 的 `native-preparation`、next-battle 的 `native-next`），预算 24 |
| captureCheckpoint | adapter envelope：formatVersion、runId、stage、initialSelections、nativeCheckpoint、intents；可 JSON 往返 |
| validateCheckpoint | envelope 结构 + `native-validate-checkpoint`（原 codec `restore`） |
| restoreCheckpoint | 复用房间 Worker，返回可执行 context；Worker 缓存不是唯一真相 |
| projectSnapshot | Worker 恢复原 checkpoint 后构造 shared/personal；shared 只含公开战斗事实，personal 含本人真实 Pokemon 状态、资源、本人决策 |

适配差异：初始固定夹具、单一 trainer identity、createRoom 早于第二席加入、内存 store；这些均标为 VS-01 内部接缝，不是正式个人初始化。

## 4. 投影、隐私与事件

shared：format、波次/回合、battle type/spec、稳定 field 索引、在场公开精灵（id/owner/index/species/form/level/hp/maxHp/gender/shiny）、decision id/kind/requiredSeats。

personal：本人 party（`capturePokemonState` 全量原状态）、money/pokeballs（modifiers 必须为空，否则 `UNSUPPORTED_PERSONAL_MODIFIERS`）、本人 decision options/players/switch outgoing。

- 不广播完整 checkpoint、sceneRandom、恢复凭据、队友个人队伍或私有菜单。
- 客户端恢复本人真实 `PlayerPokemon`；公开对手只作只读观测，不参加规则计算。
- 同一本人精灵在 shared/personal 用稳定 ID 绑定，客户端校验 shared 公开 HP 与 personal 实例一致。
- `captureAppliedState` 从已应用原模型重新 `capturePokemonState`，不返回收到的消息缓存。
- 事件在 adapter 中标注 `scope: 'shared' | 0 | 1`；formal 服务落盘时补 `eventId/revision/eventIndex`，snapshot 按席位过滤。测试确认整备事件只出现在所属席，shared 不含私有字段。

## 5. 实际测试

定向：

```powershell
node --test --test-concurrency=1 tests/coop-original-bridge-vs01.test.mjs
```

- 5 项全部通过，约 39.3s（本机 Node v24.15.0）。
- 覆盖：双 WS 首战→整备→换人/拒绝→第二战双方 FIGHT 并继续到下一 revision；真实模型提取与 ACK；篡改模型拒绝；同 actionId 重发复用 receipt 且异指纹拒绝；adapter 候选重试确定性与失败不变；两房间 Worker 失败隔离。
- 测试中实测（固定夹具 seed，随机器略有波动）：checkpoint 约 17.65 KB；shared 约 0.71 KB；personal 约 4.80 KB；events 约 0.24 KB；预热 projection RPC 约 7–9 ms；进程 RSS 约 0.94–0.98 GB（进程级，不是单 Worker 实际内存）。
- `npm run typecheck` 退出 0；`npm run build` 退出 0（约 1 分钟，既有 chunk 警告）。
- 完整串行回归见第 8 节（按实际 TAP 填写，不沿用旧 912）。

## 6. 已知失败与限制

- **第二战连续执行受 seed 影响**：固定夹具 seed 的实测已接受双方 FIGHT 并推进到下一 revision；更换 seed 时可能在第二战后命中 `UNSUPPORTED_NATIVE_ENTRY_PHASE` 或 `ORIGINAL_RUNTIME_FAILED` 并安全失败，候选未提交、未发布假结果。需定位具体未支持原 Phase（很可能是升级学招／形态等普通节点），再决定接入或明确暂停。不能据此宣称任意 seed 的第二战回合均已完整执行。
- VS-01 为可复现接缝使用固定 seed／固定队伍／单一 trainer identity；两房间共享同一 seed 但各自独立 Worker，房间隔离证据只针对 Worker 失败，不等同生产独立个人随机流。
- 真实 lobby／首发选队、双方独立 trainer identity、原 UI、浏览器模型应用、IndexedDB 席位凭据、服务器落盘重启、跨设备均未接。
- 初始仍是固定队伍／单一 identity 夹具；不能冒充正式个人初始化。
- 事件只做最小 scope 过滤与 ID 标注，未接动画控制器；`stateAck` 只代表模型应用与必要事务成功，不代表动画完成。
- pending intents（seen／encounter-persistence-pending 等）已保存在 envelope 并可 JSON 往返，但仍是内存 store；未验证真实服务器写盘／重启恢复，未消费蛋或写永久收藏。
- 未新增捕获／Boss／全道具；未知阶段明确失败，不回落实验引擎。

## 7. 复用来源

- `server/formal-coop-service.mjs` 的版本、串行、候选提交、投影哈希、输入 actionId 去重、ACK／重连屏障；
- `server/original-rule-host.mjs`／worker 的每房隔离 Worker、超时与错误码；
- `src/server/native-entry.ts` 的 `native-submit`／`native-run-to-boundary`／`native-preparation`／`native-prepare-action`／`native-next`／`native-switch`；
- `src/original-phase-checkpoints.ts` 与原 codec（checkpoint 校验／恢复）；
- `src/battle-core/coop-client.mjs` 的正式 consumer；
- `src/coop/original-client-model.mjs` 为新增最小客户端模型，不执行规则。

## 8. 完整串行回归

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
```

- 执行时 HEAD：`80ae45f6ca1b5d1c53e7a789c52cefe653624ecb`；新增测试 blob：`8a58287089e92d68605429644b6ac28f3d4cb586`。
- 退出码：**0**；实际 TAP：tests **917**，pass **917**，fail 0，cancelled 0，skipped 0，todo 0，`1..917`，934466.0661ms（约 15m34s）。
- 日志：`build/vs-01/full-clean.tap`（UTF-16LE，`FF FE` BOM）；退出码 `build/vs-01/full-clean-exit.txt`；元数据 `build/vs-01/execution-meta.txt`。
- 夜间一次运行因机器休眠导致单测等待 7.7 小时后超时，已丢弃，不作为证据；该测试文件单独重跑 10/10 通过，本表来自干净重跑。
- 不沿用旧 912，也不以新增编号推算。

## 9. 维护者后续审查与修订

原 917/917 与五项测试事实保留，但原第二战允许错误分支、隔离读取旧快照／自比较的守门不足已修订。维护者修复取消准备、非空永久 grants 假 ACK 和 terminal auto 边界，新严格 VS 八项＋正式协议十二项定向 20/20；类型／构建通过，完整串行 920/920、退出 0。固定夹具内部接缝验收通过，下一步为原 UI 与基础续局；真实身份／落盘／浏览器／双机仍未验收。详见 [维护者记录](mvp-vs-01-review-2026-10-18.md)。
