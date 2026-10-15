# M3 原胜利待续、BattleEnd 与胜后恢复

日期：2026-10-15。HEAD `5c9f3e34`，保留此前全部未提交修改；本批未提交／未推送。只在 early 开发，未操作另一份 pokerogue；远端实时状态未核对。

## 实际完成

适配测试链路可从同一原 Victory 的 `victory-aftermath` 显式继续，执行原击败计数 hook 和原战后排队段，随后沿原队列完成剩余行动／TurnEnd，再执行一次原 `BattleEndPhase.start()`。完整受控致死 FIGHT 也已接通原 Move／MoveEffect、Faint、经验、胜利待续、回合尾和 BattleEnd；升级／满招式选择可沿前批原流程接回。

原 BattleEnd 执行原 Battle.addBattleScore、场上实例的 resetBattleSummonData、战后特性分派、敌方持有物清理、双方个人临时道具 lapse／移除及原 updateModifiers／updatePartyForModifiers。共享场景只运行一次；每个玩家精灵计算能力值或执行个人规则时，仍绑定自己的 party／modifiers。实际总分保存到本次冒险 scene.score；永久场次／击败统计只输出 hook，未写永久收藏事务。

按已批准 PLAY-07，战斗清理完成后，若某个人 party 全部倒下，只给该 party 第一只执行原 `REVIVE` 的 50% 效果。复用原 PokemonHpRestoreModifier.shouldApply／apply：原最大 HP 的一半向下取整、至少 1 HP、清除倒下状态，复活不套额外治疗倍率；不消耗物品／金钱，不恢复其他队员，也不移动伙伴。若个人仍有存活队员，不触发此恢复；双方全灭仍以未确认的同时倒下边界拒绝推进。

当前终点是原队列中的**未启动 EggLapsePhase**，其后的原 SelectModifier／NewBattle 保持待执行。本批没有跳过孵蛋、发放蛋券、提供战后奖励或创建下一场战斗，下一次 ACK 会明确拒绝未支持的阶段。用户在本批收尾时确认 PLAY-14：每次共同过关，双方各自的蛋都推进 1 波，结果各归原持有人，不排除个人全灭者；已写入 SPEC。原蛋进度／孵化／永久事务尚未接入，券规则仍未确认，不能把规则批准当作功能完成。

## 复用来源与必要适配

| 来源 | 本批复用 | 适配与验证 |
| --- | --- | --- |
| early src/phases.ts 原 VictoryPhase.start（`5c9f3e34`） | 原击败计数提取为同类 recordDefeat，原 XP 后的 if／排队／end 原体提取为 queueAftermath | 单人仍按计数 → 经验 → 原战后排队 → end；合作已执行 XP 后只调用明确剩余段，不重跑 start。无新 Phase 字段，无新 remaining，decision 仍 v6／Phase v1 |
| 原 Victory 的 BattleEnd／EggLapse／奖励／NewBattle 排队 | 原条件、原构造、原 pushPhase 顺序 | 队列仍排在剩余回合行动之后；没有把 BattleEnd 提前插入，也不删除／跳过后续阶段。另有活敌时原条件不排战后队列 |
| 原 BattleEndPhase.start | 整个原方法直接运行，无规则重写 | 测试房间场景合并参与战后特性检查的个人 party；全局计分／清理一次，各席 modifiers 的 lapse 一次。各 Pokemon 绑定个人场景，调用原个人道具方法并保留所属席排队 |
| early Battle.addBattleScore | 原方法直接调用；原敌人数、Boss／回合系数与 ceil | 测试 VM 仅绑定原 Phaser Sine In easing 模块；总分写回候选 scene.score，分数文字／日志为展示 hook。参考侧独立执行冻结原方法 |
| 原 BattleScene clearEnemyHeldItemModifiers／updateModifiers／updatePartyForModifiers／removeModifier | 原方法体运行，含虚拟层数清零、空层移除与能力值重算 | 世界场景协调个人数组，个人 scene 的 getParty／modifiers 分离；原异步更新交既有任务观察器，所有任务清零才发布候选。战利品暂存池仍保留原物品对象，不授予个人所有权 |
| 原 REVIVE 目录工厂与 PokemonHpRestoreModifier | 原 shouldApply、原复活百分比／取整／状态恢复 | PLAY-07 只补“哪一席全灭、选其第一只”的合作选择条件；不会创建背包道具或消耗数量。恢复与 BattleEnd 同一候选提交，写盘／任务失败可整体回滚 |
| 既有 v6 codec、原队列、规则任务观察器与正式双端 harness | 独立候选、phaseId／scope、RNG、模型确认、写盘后发布、服务重启 | 新 victory-aftermath-runner 只接已保存的明确剩余阶段。先验证未同时全灭、阶段类型及驱动能力，完成／任务清零／最终 codec 校验后清 current；不扩张通用 runner 为任意 resume |
| 前批 XP／LevelUp／个人道具绑定 | 原连续执行与恢复链路 | 仅将已有经验场景的原道具方法绑定提为可复用测试 helper；不复制原公式或另建调度器 |

本批没有采用此前 pokerogue 的 Host 判胜／轻量终态同步：它与当前服务器独立候选、完整队列和落盘后发布契约不同；early 原类、M1/M2 与双端 harness 已可直接复用，不需迁移另一套规则。另一目录未读取或修改。

## 验证

新增 21 项：13 项单端、8 项真实双端 WS。最终完整串行回归 **385/385**、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过；新文件另做空白检查。构建只有既有混合导入／大包警告；dist 为忽略输出，日志保留系统临时目录。

- 原版连续执行与逐阶段 JSON 恢复差分：普通胜利、席位 0／1 全灭后恢复、临时道具到期／保留、敌方持有物／暂存别名、升级接续，以及真实致死 FIGHT 完整经过 BattleEnd。
- 冻结参考为 `5c9f3e34` 的完整 Victory.start、BattleEnd.start、Battle.addBattleScore 和相关 BattleScene 方法；参考规则不调用新的 recordDefeat／queueAftermath 当基准。单人完整 Victory 在普通波及 10／20／50 波排队与冻结原版一致。
- 保持剩余回合先于 BattleEnd、只执行一次计分／清理／恢复；原场上 battleSummonData 重置，个人临时道具倒计时各一次，敌方 held item 清理后仍留在原暂存池。
- 胜后恢复只选个人第一位；奇数／最小 HP 使用原复活公式，其他队员保持 0 HP；个人尚有存活队员不复活，不消耗个人资源。
- 另有活敌时不排 BattleEnd；双方全灭不发恢复。错误阶段、未完成任务、替换 continuation 或非法候选模型不能发布。
- 双端从胜利待续、个人全灭／道具清理、完整致死回合、升级选择等起点，每个原阶段重启后继续，核对两席实际模型、事件、个人资源与精确队列。
- 胜利排队与 BattleEnd 两处写盘失败，及复活后的任务失败，均保留旧 XP／HP／总分／道具／队列，修复后重启只推进一次。两个房间的分数、道具与个人恢复隔离。
- 终点重启后对 EggLapse 的下一次 ACK 仍拒绝，状态不变；不把排队存在当作奖励／下一战已执行。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 实际边界与下一步

本批是普通野生战斗的受控规则切片。原战后特性分派已调用，但拾取／实际转移、全部持有物、形态、Boss／训练家、日常／无尽／最终通关等未整体验收；不能把无这些特性的夹具当全机制。永久场次／击败统计和成就依旧只是 hook，M6 持久事务未接。单人检查仅覆盖所述完整 Victory 排队及规则差分，未做浏览器演出或真实双机验收。

下一批按已确认 PLAY-14 接原 EggLapse 的个人推进、孵化及持久化停点，然后复用原个人奖励与既有 M2 独立整备／准备屏障，继续 NewBattle。蛋规则不重复询问；券归属／时机及敌我同回合全灭规则仍不能由测试 driver 决定。

M3 仍部分完成；完整战后下一战、非 FIGHT、复杂机制、房间隔离无渲染场景、全量合法意图／RNG 绑定与正式 WS 驱动仍缺。`/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE，测试 driver 未挂生产。`/` 与 `/coop.html` 保持；小目录仅为夹具，不限制精灵范围。仅用合成房间、内存存储与 loopback 随机端口，不碰真实房间／令牌／存档，dist／临时日志不纳入提交。
