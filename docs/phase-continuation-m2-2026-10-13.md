# M2 待续队列与换人收尾检查点

本文件保存 2026-10-13 的有界切片记录。其后完整 M2 状态层与 177 项验证见 [2026-10-14 验收记录](m2-checkpoints-2026-10-14.md)；下方 v4/145 项及缺口描述属于当时状态。

日期：2026-10-13。起点 `8758a080`，工作区干净，main 相对本地 origin/main ahead 3。本轮已获准继续开发；当前变更未提交、未推送。**M2 整体仍部分完成**，不能将本批当作完整强制替补/接棒、完整 Phase 映射或原游戏合作验收。

## 原流程与本批范围

| 原流程 | 检查点/执行处理 | 限制 |
|---|---|---|
| BattleScene.phaseQueue | 保存有序显式描述符 | 未登记 Phase 拒绝 |
| phaseQueuePrepend / phaseQueuePrependSpliceIndex | 保留前插及固定 splice 索引语义；shift 时归并在普通队列前 | 不把多次 unshift 错当成逆序栈 |
| nextCommandPhaseQueue | 保留延后队列，普通队列耗尽时先移入，再创建 TurnInit | 不提前执行下回合处理 |
| currentPhase / standbyPhase | 保存当前剩余处理和暂挂处理；恢复要求显式 resume 处理器 | standby 不重复 start；不恢复任意 JavaScript 栈或 UI 回调 |
| SwitchSummonPhase.onEnd | 提取 super.onEnd 之后的原逻辑并回接单人：回合补偿 → 接棒转移 → 重置离场精灵 → 形态触发 | 本批边界是已换位、已初始化新精灵且 SummonPhase.onEnd 已执行，完整 preSummon/switchAndSummon 尚未接入 |
| PostSummonPhase / TurnInitPhase | 支持严格的数据描述符作为待处理事项 | 尚无默认权威执行器；缺处理器明确拒绝，不用空实现跳过进场伤害/特性 |

`phase-queue.mjs` 从原 BattleScene 提取入队、前插、选择下一 Phase 和延后队列归并，原单人已回接。`switch-finish.mjs` 提取原换人收尾，原单人 SwitchSummonPhase 已回接。没有改入口、实验引擎、精灵目录或玩法数值。

`phase-continuation.mjs` 定义六个队列字段，当前只登记 `switch-finish`、`post-summon`、`turn-init`。换人收尾使用 `fieldIndex`、`pokemonId`、`outgoingId` 和 `batonPass`；校验精灵所有权、队伍、当前场上实例、离场实例及重复收尾。未知字段/类型、错误引用和非法 splice 索引拒绝。实际 Phase 对象到这些边界描述符的完整生产适配尚未实现，不能直接序列化 Phaser/Phase 对象。

`advanceContinuation` 先恢复独立候选，再执行一步可信 start/resume 处理器，完成后再次校验才返回；错误状态、缺处理器、执行抛错或末尾校验失败不替换原上下文。处理器必须只修改候选，外部持久化/授予应在正式协调器提交后处理。原正式服务继续使用候选提交与双端确认屏障，默认未装正式运行器。

## 接棒发现的原状态边界

原 `Pokemon.transferSummon` 枚举全部 BattleStat，包含索引 7 的 RAND。原能力阶段数组初始只有 7 项，因此实际接棒会生成第 8 项的**显式 undefined**。原检查点只接受 7 项，会拒绝合法接棒结果。本批保留原方法及其数组结构，在 wire 中将末项编码为 `{undefined:true}`，恢复为自有 undefined 槽位；不裁剪、不转成 null，也不把 RAND 当成新的数值阶段。

Pokemon payload 升为 **v2**，decision payload 升为 **v4**（新增必需 continuation），roster 仍 **v2**，M1 envelope 不变。旧格式明确拒绝；未做静默迁移或重写旧保存。`pendingEffects` 仍只接受空数组，待续描述符不是对任意效果/Phase 的兜底支持。

## 验证

- `tests/fixtures/early-continuation-reference.json` 冻结 `8758a080` 的原队列方法及 SwitchSummonPhase.onEnd；4 种 modal/splice 组合和 6 种接棒/命令/离场对象组合对照实际回接方法，核对调用顺序、standby 不重启及回合补偿。
- 原 Pokemon.transferSummon/resetSummonData 方法继续执行，与不中断直接调用逐项比较；覆盖普通换人收尾和接棒的能力阶段、标签、离场重置、场景钩子事件及 JSON 后 RAND 槽位。场景形态/成就钩子只记录调用，没有伪造完整形态或永久收藏实现；目录仍为小型测试夹具。
- 保存 current/standby、前插索引及延后队列；验证 resume、缺处理器、非法/过时引用、重复收尾、旧版本和执行后错误拒绝，旧模型及输入保持不变。
- 6 项新增真实 WS 测试：A/B 各先提交 × 普通/接棒共 4 项，单方输入后重启、双端原模型确认、收齐后原方法执行，与不中断参考的事件、完整状态和随机流一致；再于提交后重启并重发旧输入，revision 保持 1。另测结果写盘失败后的队列/双输入保留与重试，以及未知持久化描述符拒绝且房间不改写。
- **145/145 自动测试通过**（原 135 + 本轮 10）。类型检查通过；生产构建通过，保留原有大包及动态/静态导入混用警告。最终验证命令为 `node --test tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs`、`npm run typecheck`、`npm run build`。

WS 使用本机随机端口、合成房间、内存持久层和重新挂载服务，未读取个人存档、未占用 8020、未访问另一份 pokerogue 目录。WS 适配器的提交门槛是测试用途，起点已完成召唤前半段；不能称为真实玩家强制替补的完整闭环。PostSummon 保留为未执行描述符；没有将原进场效果替换为空处理器。

## 还需继续

先把原 SwitchPhase 的真实选择接到召回、换位、初始化、SummonPhase.onEnd 和 PostSummon 的完整待续序列；补接棒持有物转移、召回/进场特性与形态/场地处理。之后继续进化、选队完成、地图、整备及结束停点。所有新增类型都需要原代码差分和同一 WS 故障矩阵；CHECKPOINT-01 保持未勾选。浏览器单人操作回归、原 UI 合作与真实双机仍未验收。
