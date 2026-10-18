# MVP 优先级调整与原运行时首批

后续批次：本文件为 **A 引导批** 的记录；接续的原阶段闭环、验收停点与当前缺口见 [B 承载验证批](native-loop-runtime-2026-10-17.md)。A／B 代码在本次同一进度提交中保存，不把 A 验证结果套用于后续 B 修改。

日期：2026-10-17。用户明确要求调整优先级，尽快拿到可跨端联机的 MVP。开工只读核对 main／HEAD／缓存 origin/main 为 `56147767`、工作区干净、ahead／behind 0／0；实时远端也为 `5614776777eb820972c60a73d8986abb4f57836e`。仅在 early 开发，没有操作另一份 pokerogue。本批尚未提交／推送。

## MVP 的执行顺序

验收目标为两台设备在原游戏界面中建房／加入、各自选 3 只并各上场 1 只、服务器权威双打、连续回合、倒下与个人替补、胜利成长与个人整备、双方准备后进入下一波，以及刷新／断线／服务器重启后回到原席位继续。最后必须记录 LAN 与同域远程 HTTP／WS 的真实双机验证。已有协议／安全停点／规则切片继续复用，不按测试数量换算产品完成度。

1. **先打通生产规则加载和普通对局运行器**：完整 early 模块在 Node 工作线程加载；接原 NewBattle／遭遇／入场／TurnInit 至真实输入，再将已有原行动链与检查点候选运行器用于完整原类，不从 tests 目录挂生产。
2. **随后优先原 UI 的跨端纵向接入**：复用 M1 客户端消费器、原选队／行动／目标／替补 UI，再接 M5 个人奖励／商店／准备；尽早在两个独立浏览器与两台设备上跑连续波次。
3. **随上述流程补必要的收藏与故障边界**：捕获／孵化／授予必须按 M6 原子事务接入；不能提前消费蛋或发永久收藏。M7 的真实模型确认、去重、写盘失败、重连／重启验证贯穿每一步，M8 的远程 WS 部署尽早验证。
4. **复杂机制继续保留，排到闭环之后或遇到时补齐**：敌方概率复活、防偷特性、其余树果与复杂道具、特殊遭遇／训练家／Boss 等不再作为下一批默认首要事项。未适配机制明确阻断并记录，不能回落实验规则、静默跳过或删减原精灵内容；不能把有限普通分支写成完整 M3。

原玩法范围没有缩减，不增加精灵种类／世代／数量限制。券归属与发放时机、双方同时全倒下最终顺序仍待用户确认，开发通用路径不代为决定。PLAY-13／14／15、v6 不补空蛋、带蛋 v7、hatch-commit／M6 与当前 RNG 边界不变。

## 本批实际实现

- 新建独立 Node 规则构建入口，直接导入完整 BattleScene／PlayerPokemon／EnemyPokemon、原数据目录与 originalDecisionStateCodec，不抽取源码片段、不使用 tests/helpers 或小目录夹具。构建阶段检查模块图，拒绝测试目录依赖；产物只写被忽略的 build/coop-runtime。
- 使用现有 Vite 编译 TS、原 i18n glob 与依赖，不新增依赖和另一套规则。构建别名仅用于此 Node 入口，浏览器构建的 Phaser／rex 与 `/`、`/coop.html` 不变。
- 服务端显示边界只提供原 Pokemon 构造所需的 Container scene／位置及显式字段成员列表，数学和常量直接导入已安装 Phaser 原模块。未实现的精灵图像、rex UI、WebGL 与全局随机兜底明确抛错，不伪造 Phase 完成。
- 仅在 Node bundle 内替换原 initShinySparkle 的精灵／动画分配。原闪光判定与 shiny 字段仍执行；没有移除随机规则或把闪光改成固定结果。Pokemon.init() 属于显示挂载，本批不调用。
- 原 initSpecies／initMoves／initAbilities 增加已初始化返回，避免多个原 BattleScene 实例反复向全局目录追加重复条目；原条目和工厂内容不改。utils.isLocal 仅增加无 window 时的导入保护，浏览器判断不变。
- 新增独立工作线程 host，完整原模块和 Phaser 全局只在工作线程加载；HTTP／WS 主进程不加载 DOM。主线程只允许目录、构造、原 Pokemon codec 往返及构造随机状态操作；未知操作拒绝，不提供任意脚本执行。带超时、失败与关闭清理。
- 实际原构造器执行 IV／性格／招式／能力值／形态等原方法，原 M2 Pokemon codec 导出、恢复并重新提取。个人 trainerId／secretId 必须显式提供，不能凭空造个人存档；本批只绑定构造所需身份，不读／写永久 GameData。
- 原随机上下文沿用 withOriginalRules、SceneRandom 与 modifierPools。构造或编码失败时撤回本次随机消费；重建工作线程后可从保存的构造随机状态继续。这里不是完整房间检查点或全部生产 RNG 验收。

## 复用来源和适配差异

| 来源（基点 56147767） | 实际复用 | 适配与未复用原因 |
| --- | --- | --- |
| src/battle-scene.ts、field/pokemon.ts、field/arena.ts 与完整 data 目录 | 直接导入原类与原构造、原池表／方法／招式／特性目录 | Node 不运行 Phaser 图像／WebGL；只适配显示边界，构造规则不另写 |
| src/original-phase-checkpoints.ts、battle-core/pokemon-state.mjs | 全原类 codec 装配、原 Pokemon 捕获／恢复 | 本批运行 Pokemon 往返；完整 Battle／Arena／Phase 候选的真实推进下一批接，不冒充已验收 |
| server/original-random-context.mjs、battle-core/random／decision-state／modifier-pool-state | 原异步作用域及房间随机／池表基础 | 工作线程隔离模块全局；只验证构造序列，未验收个人独立流或全生产 RNG |
| Vite、Phaser 的 RandomDataGenerator／Linear／BlendModes | 现有编译器、原数学与常量 | 仅 Node bundle 别名，单人构建不改别名；没有引入新依赖 |
| M1 formal-coop-service／coop-client、既有 rule-phase-runner | 接下来继续用同一协议／运行器 | 本批不新建房间／ACK 系统，阶段端口尚未完整时不挂此模型工具为正式游戏 adapter |
| 此前项目大厅／回放／UI | 本批未迁移 | 这是服务端完整原类加载批，early 原类与既有基础足够；大厅与回放将在原 UI 接入时按 SPEC 4.5 只读参考并适配，旧 Host 结算不迁入 |

## 验证

新增 12 项定向测试通过，包含：

- 完整原目录 1082 个精灵条目、920 个招式、311 个特性；反复创建场景不追加重复目录，包含第一至第九世代条目。数量是当前固定 early 数据证据，不是产品白名单。
- 在本批种子、5 级和默认参数下，对目录中每个原可获得精灵构造 PlayerPokemon、对每个条目构造普通野生 EnemyPokemon，并执行原 JSON codec 往返；本次分别 1082 次，共 2164 次。不能据此宣称全部形态／所有等级／Boss／全战斗机制验收。
- 原构造连续执行与保存随机状态后新工作线程恢复执行一致，双房间交错操作互不影响。
- 原构造后编码失败、非法输入、损坏 Pokemon、不可克隆输入、不支持操作、缺失身份、损坏 RNG、工作线程超时／关闭等，不发布有效结果或污染另一线程。

A 检查时点类型检查、生产浏览器构建和完整串行回归 **710/710** 通过（约 793 秒）。后续 B 修改原阶段与绑定后，该结果仅作 A 证据；B 的当前定向与未完成回归见独立记录。上一批 698/698 只作历史证据。

复现命令：

```powershell
npm run build:coop-runtime
node --test --test-concurrency=1 tests/battle-core-runtime-bootstrap.test.mjs
npm run typecheck
npm run build
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
git diff --check
```

## A 结束时的缺口与后续方向（B 已接续，勿重复开发）

当前 worker 的 readiness 明确返回 model-bootstrap／gameplayReady=false；没有装配成正式游戏 adapter，`/coop/v1/ws` 默认仍 ADAPTER_UNAVAILABLE。没有真实跨端建房选队、原 UI 联机或双机游玩验收。完整原类可在 Node 构造，和完整对局生产运行器是不同门槛。

**下一批明确先做：以本批完整模块加载为基础，接原 NewBattle → 原遭遇／入场 → TurnInit 到真实行动输入，并绑定双方个人／共享场景、任务观察与 M2 完整候选 codec；随后把已有 FIGHT 连续回合接到正式 adapter，补双端 WS，再接原 UI。** 不回到以敌方概率复活／防偷特性为默认第一优先级。展示端口、原任务／Phase 剩余阶段、完整构造选项、身份与个人资源加载、完整场景 RNG 均须继续验证，不用伪造 Phase 跳到行动输入。

本批已只读核对下一步的关键原调用点：

- BattleScene.newBattle 会重置波次种子并创建原 Battle／敌方等级；敌方队伍要到 Encounter.start 才生成。继续复用 advanceNextBattle 的创建＋遭遇同候选边界，不能保存空敌方半成品或手填敌方跳过原遭遇。
- Encounter.start 还包含原同步性格、敌方道具池／生成、seen 记录、saveSystem／saveSession，再转入 doEncounter／end。生产端须区分房间持久化与 M6 永久意图，不把原保存调用改成无条件成功来掩盖缺口；异步链复用规则任务观察器排空后再提交。
- Summon.summon 的动画回调中混有 field 成员加入、道具更新、resetSummonData 和后续 end；不能把整段回调当纯展示省略。继续用已有入场剩余阶段及必要的原方法命名提取，不凭空造已完成 Phase。
- 原 TurnInit.start 自行登记实际参战者、resetTurnData，并排入原 Command／EnemyCommand／TurnStart。接真实等待输入应保留这个原队列，而不是手建一份“看起来已到行动”的状态。

以上为 A 结束时的审查结果；后续实际原阶段执行与当前剩余项以 B 记录为准。
