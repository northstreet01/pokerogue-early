# M2 原版安全停点检查点验收

日期：2026-10-14。基于 `8758a080`，只修改 `E:\pokeregue\pokerogue-early`。本批完成 M2 的状态适配层：声明字段、稳定引用、安全交互停点、独立候选恢复及真实 WebSocket 双客户端差分。完整权威战斗执行属于 M3，原游戏合作 UI 属于 M4；不能据此声称合作游戏已可玩。

## 字段与引用

| 范围 | 捕获与恢复 | 证据/边界 |
|---|---|---|
| Pokemon / 队伍 | 原显式字段、原 prototype、party/reserve/enemy 所有权、场上 ID、retiredIds、七个能力阶段和接棒产生的第八个 undefined 槽位、学招产生的 null 槽位 | 不执行构造器、随机数或恢复钩子；不限制精灵种类/世代 |
| 可变引用 | roster v3 的 tagGroups/ruleGroups 保留跨精灵的标签、moveset、IV、stats 和临时记录身份；旧敌方实例与捕获后的同 ID 玩家实例分别保存 | 路径白名单、等值与身份检查；错误引用拒绝，不猜测绑定 |
| Battle / Arena / Scene | 命令、参与者、敌方队伍、历史 ID、Trainer、loot、天气/场地/标签、Pokemon/Trainer 池、gameMode、lastEnemyTrainer、seed/waveSeed 等 | 当前游戏模式来自可信目录；选队完成允许 Battle 为 null；恢复保留 remembered Trainer 与 Battle Trainer 的共享实例 |
| 个人资源与 Modifier | 继承此前 57 个具体 Modifier、生成型类型及共享 ModifierType；两席本局金钱、球和道具独立 | 私有视图由适配器提供；恢复模型不等于广播整个权威检查点 |
| 随机流和奖励池 | Battle RNG、房间 Scene RNG、已生成奖励池表；选择项和费用原样保存 | 恢复不重抽地图/奖励；全局 Phaser RNG 不交换 |
| 原 Phase | 三个原源文件的 68 个声明、63 个具体类；显式继承字段清单、可信 prototype、seat scope、Pokemon/Move/Weather/ModifierType 引用、进化和形态目录 `{id,index}` | AST 覆盖检查防字段漂移；全部进化/形态条目引用恢复，不执行条件函数 |
| 待续队列 | phaseQueue、phaseQueuePrepend、spliceIndex、nextCommandPhaseQueue、currentPhase、standbyPhase、phaseId，以及非空 pendingEffects | 前插/延后/standby 顺序按原代码；已开始的 Phase 必须有显式剩余阶段，不能重新 start |

生产注册位于 `src/original-phase-checkpoints.ts`，绑定原完整目录与原模型导出；测试中的小型精灵模型只用于受控规则差分，不是产品精灵范围。Phase 中引用的招式对象可以指向 roster 槽位，也可以是学招后仍被队列引用的独立旧招式。行动目标数组可稳定绑定到 Battle 命令的 targets/move.targets/args.targets，避免恢复后断开共享引用。

展示文本可保存在 Phase presentation 中，`checkpointRuleProjection` 将其从规则摘要移除。Phaser 对象、动画栈和 UI 回调不保存。登录、个人性别、孵蛋及调试 Phase 不属于本局战斗检查点，相关个人收藏/蛋流程仍由 M6 处理，未知类型明确拒绝。

## 安全停点与协调

- 选队完成：双方各三个本局实例、个人 ready；没有战斗时 field 全空，双方确认后由可信运行器创建第一战。
- 待行动/目标/强制替补/学招：保留已有合法候选、原命令与待学习招式，新增原 Phase 剩余阶段登记。
- 进化：可信目录引用、pokemonId、lastLevel、进化/取消或暂停确认；整备内可保存个人进化/学招子决策。
- 地图：原始 biome、已生成分支、双方当前选择；不一致时可修改，达成一致后继续。
- 独立整备：各席奖励、商店、费用、重抽次数、选择/子决策、rewardResolved、ready；一人处理子决策时另一人仍可整备，双方准备后才继续。
- 待续处理和结束：无玩家输入的 continuing 使用 auto 收集模式；仍须当前两端模型确认后，执行一个候选步骤、落盘，再发布下一 revision。结束状态不接受玩家行动。

正式协调器支持 all/incremental/auto。每个可修改选择或自动阶段都取得新的 decisionId，保留 M1 的旧决策拒绝和回执去重规则。缺少原效果/推进提供者明确失败；不会用测试钩子或实验结算回落。外部收藏授予仍走持久化授予账本，不能在恢复时重做。

恢复只创建独立候选，通过结构、目录、范围、所有权、引用、身份和阶段校验后才返回。非法 payload、缺处理器、原执行抛错、末尾校验失败或提交写盘失败均保留原模型、检查点、随机状态及已收输入。

## 可复现证据

本批最终回归 **177/177**，类型检查和生产构建通过：

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

- 原队列和换人收尾对照 `8758a080` 冻结源码；原单人已回接同一函数。原 preSummon/switchAndSummon/onEnd、resetSummonData/resetTurnData/transferSummon 在实际原类实例上逐阶段差分。
- 普通换人/接棒 × 双方席位共四组真实 WS 用例：每个阶段重启服务、两端分别恢复实际原类并提取摘要，比较未中断执行的状态、事件和随机流。只有表现层计时/动画钩子同步化；保留真实 PostSummonPhase 待续，未用空能力/场地结算替换它。
- 原 Pokemon.evolve、兼容 TM 和能力值计算继续差分；原 Potion Modifier 应用、原重抽费用、地图改选、单方 ready、整备内进化取消/暂停通过双端重启验证。
- 自动原生阶段写盘失败保留旧队列，重启后仅提交一次；损坏已应用 Phase 会产生 MODEL_MISMATCH 并阻止推进。既有 A/B 先输入、重发、旧连接 ACK、损坏模型/持久引用、单方输入重启、两房间 RNG 和本地存档故障矩阵继续通过。

测试使用合成房间、隔离持久层/临时目录、本机随机端口，没有读取个人存档，没有占用 8020，没有访问另一份 pokerogue。构建保留既有大 chunk 与静态/动态混用警告，`index.html` 和 `coop.html` 都生成。

并发回归有一次测试进程未提供断言详情便退出；同一文件单跑 6/6 通过，最终采用串行完整回归验收。类型检查还发现新增注册使用的 Object.hasOwn 超出项目 TS lib 目标，已改为 hasOwnProperty.call 并重新通过；未扩大编译目标。

## 版本、交付与下一步

M1 envelope 不变；decision **v5**、Pokemon **v2**、roster **v3**、original Phase **v1**。不兼容旧检查点明确拒绝，未静默迁移或重写保存。

本批按用户“完成 M2 后提交”在 main 提交；未推送。提交号以 `git log -1` 为准，不在文档内自引用提交哈希。

M3 下一步接原 Move/MoveEffect、完整回合与可信安全边界推进器：把本批生产 codec 和队列 binder 接入权威原运行器，提供目标/效果/进场/形态/下一战处理，再扩大全机制差分。测试内容目录、无特性/无接棒持有物的换人夹具不代表这些机制的全量执行验收。原 seen/caught 钩子事件不代表 M6 永久图鉴事务已完成。正式 `/coop/v1/ws` 默认仍返回 ADAPTER_UNAVAILABLE；`/` 与 `/coop.html` 行为保持。浏览器操作回归、真实双机和长局留给 M4/M8，不能用本机 WS 结果代替。
