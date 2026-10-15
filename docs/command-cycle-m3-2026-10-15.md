# M3 连续回合的玩家命令／目标／敌方决策接入

日期：2026-10-15。HEAD `5c9f3e34`；保留前两批 Damage／StatChange／续击和无倒下回合队列的全部未提交修改。本批未提交／未推送，没有修改或读取另一份 `E:\pokeregue\pokerogue`。远端最新状态未重新确认，不能从本地 origin/main 推断 GitHub 当前状态。

后续同日已复用 M2 原 remaining stage 接通本页剩余的混合强制次序与原 Command／Target 暂停、恢复和取消，见 [后续记录](mixed-command-m3-2026-10-15.md)。本页 255 项及混合次序拒绝描述保留为当时的批量适配边界。

## 实际进度

适配测试链路已从下一 wait-actions 收齐双方真实 FIGHT 意图，直接执行原 CommandPhase、原 SelectTargetPhase，再执行原 EnemyCommandPhase 与 EnemyPokemon.getNextMove/getNextTargets，回接现有原 TurnStart／出招／效果／伤害／能力阶段／续击／收尾／TurnInit，连续进入后续输入停点。

新增共享边界 `advanceCollectedFightCommands`，只负责独立候选、输入完整性、原合法性校验、异步完成及最终 codec 校验。它不排序席位、不生成行动顺序、不计算招式或伤害，也没有新建协议／房间／回合调度器。

原 CommandPhase.end 的 UI Promise 保留；可信测试 driver 用已验证意图响应原 COMMAND 和 TARGET_SELECT 边界，等待 Phase 完成与已登记任务清零。目标仍由原 SelectTargetPhase 回调写入 command.targets，PP 在后续原 MovePhase 中消费，不在采集时消费。

## 复用记录

| 来源 | 本批直接复用 | 适配与证据 |
| --- | --- | --- |
| `5c9f3e34:src/phases.ts` | CommandPhase.start/handleCommand/checkFightOverride/end、SelectTargetPhase.start、EnemyCommandPhase.start | 当前原类直接执行；完整原方法冻结为 `early-command-cycle-reference.json` 作独立对照。冻结文件包含其他分支不代表那些分支已执行 |
| `5c9f3e34:src/field/pokemon.ts` | EnemyPokemon.getNextMove/getNextTargets | 冻结原方法独立执行对照；覆盖单招式及 RANDOM／SMART／SMART_RANDOM 的受控双招式选择、原评分／目标权重和 RNG |
| `src/battle-core/fight-command.mjs` | resolveFightIntent、selectFightCommand | 网络意图仍拒绝内部 ignorePP、越权精灵、非法 cursor／target；本文件只增加 `advanceCollectedFightCommands` 候选提交包装 |
| `forced-command.mjs` 与原 CommandPhase | prepareQueuedFight、selectEncoreFight 和原自动执行 | 在权威候选上清除不可用队首；可用排队动作和 Encore 在原队列头自动执行，partner 的后续输入仅要求尚无命令的席位 |
| `target-command.mjs`、原 SelectTargetPhase | 原目标选择回调 | 不复制目标选择规则；原插入的目标 Phase 按队列立即处理，再轮到下一个 CommandPhase |
| 前两批未提交的 `round-loop-model.mjs`、`post-damage-model.mjs` | 原回合／伤害／StatChange／续击／收尾 driver、队列、RNG、任务观察器和 v6 codec | round-loop 的停点助手导出供复用，requiredSeats 按未收命令席位生成；旧普通双席场景保持。没有新增持久化字段或升级版本 |
| M1/M2 正式服务与 applied-decision-clients | 先落盘后发布、已收输入、去重、ACK、原席位恢复和两端实际模型提取 | 继续同一 WS harness，新增连续回合输入与故障场景，不改生产默认适配器 |

此前项目大厅、回放及 Host 权威代码不适用于本批服务器权威规则边界；early 已有原命令规则和对应网络基础，无需重复迁移，M4/M5 的复用候选继续保留。

## 候选与失败边界

`advanceCollectedFightCommands` 要求 wait-actions、无已开始的 current／standby、输入席位恰好等于 requiredSeats 且全部为合法 FIGHT。同步验证前后比较完整检查点，任何验证期 RNG／模型变化均拒绝。随后仅在独立候选内执行原 Command／SelectTarget 队列；异步未完成、晚期异常、无效状态或错误队列均不替换旧模型。

可信 driver 的命令循环只用既有 selectNextPhase 选择原队列，最多处理 8 个玩家命令／目标阶段，最后停在原 EnemyCommandPhase。其选择再由既有逐 Phase runner 推进，因而可在命令提交后、敌方 RNG 消费前保存／恢复。正式协调器中，结果失败时已接受的双方输入仍保留，重启后重新建立确认屏障再重试。

测试 VM 中原 EnemyPokemon.getNextMove 返回的普通数据字面量属于另一个 realm。测试 driver 只把这个 QueuedMove 记录的 prototype 归到宿主 Object，保留 targets 数组及排队引用，未 JSON 克隆或改公式；生产同 realm 不需要此桥接，严格 command codec 未放宽。跨 realm 数组仅在单独断言命令值时转为可比较数据；主差分始终比较完整生产 checkpoint。

## 验证

新增 16 项：11 项单端连续执行／恢复／失败边界，5 项真实 WS。定向通过：

- 两个拥有者 × Tackle／Growl／Double Slap，每例继续三个新回合；每个阶段比较原活模型连续执行与逐步 JSON 恢复的完整检查点、事件和随机状态。每轮命令采集不扣 PP，各精灵行动仅消费一次 PP，回合只递增一次，全部保持存活。
- 玩家命令值与现有 resolveFightIntent 一致，原目标 Phase 写入正确 targets；敌方使用真实原方法，不再预填下一轮敌方命令。
- 缺输入、多输入、越权精灵、非法目标和内部标志拒绝；验证消费 RNG、异步验证器、规则任务未结束、晚期非法 HP 或异常均保留旧状态。
- 原 Command.end 的异步完成和延后规则任务完成前，候选不能提交。
- 队首先有不可用排队动作再有可用 Growl，原准备函数只在候选上删除不可用项；有效动作和 Encore 在原队列头自动执行，然后 partner 单独输入，不要求已经自动决定的一席再交行动。
- 原敌方单招式、RANDOM、SMART、SMART_RANDOM 选择及目标权重 RNG 与冻结方法一致；仅受控招式／物种模型，非全量 AI 验收。
- 两种输入到达顺序，双端连续完成两个新回合；第一席输入后重启、重发去重、玩家命令提交后且敌方选择前重启，结果与原连续模型一致。两端从独立实际模型提取投影。
- 玩家命令结果及敌方决策写盘失败，保留上一检查点／已收输入／RNG，重启只处理一次；第二个玩家 CommandPhase 内部失败，第一席已在候选中生成的命令也不能泄漏，双方输入保留用于恢复。

最终完整串行回归 **255/255**、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。构建生成 `dist/index.html`、`dist/coop.html`，仅既有混合导入／大包警告。日志在系统临时目录，dist 为忽略输出，不纳入提交。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 明确未覆盖

这仍是适配测试链路，测试 driver 未安装为生产无渲染场景。正式 `/coop/v1/ws` 默认仍 ADAPTER_UNAVAILABLE，原 `/` 与 `/coop.html` 保持原行为，没有限制产品精灵种类／世代／数量。只使用合成房间、内存持久层和本机随机端口，不读真实存档／房间，不占用 8020；未做浏览器或真实双机验收。

原队列头的排队动作／Encore 已覆盖；“前一席尚需输入、后一席有强制动作”的混合次序尚未适配为完整安全决策，明确 `UNSUPPORTED_MIXED_FORCED_ORDER` 并保留旧状态，不能交换原 Phase 顺序或让客户端代选。其他强制动作／随机目标／Struggle 全流程、Trainer 换人 AI、非 FIGHT、Faint／替补／胜利、复杂特性／物品／天气／场地／Boss 和完整生产运行器仍待后续。经验／蛋券归属及敌我同回合全倒下仍按 SPEC 处理。

下一步继续复用原 Command／安全决策层适配混合强制次序，再处理 Faint 和回合末替补；不重做本批已验证的连续回合和协调基础。M3 未整体验收，原合作 UI、永久收藏事务仍分别属于 M4/M5、M6。
