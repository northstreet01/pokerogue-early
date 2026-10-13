# M2 第一批：原版 Pokemon 与队伍引用检查点

日期：2026-10-13。开发起点为 M1 提交 `13ac6839`。本批完成 M2 的 Pokemon/队伍切片，**M2 整体仍为部分完成**，不启用正式游戏运行器。变更随独立 M2 提交交付，未推送；提交号以 Git 记录为准。

## 先行审查与 M1 提交

M1 审查修复了重同步时撤回双方 ACK、却只给请求方发快照的问题。现在双方均收到新的完整快照，新增回归通过。M1 共 12 项协议测试，连同既有 63 项共 75 项；提交 `13ac6839`。未推送远程。

## 状态覆盖清单

| 原对象/字段 | 本批处理 | 仍需边界 |
|---|---|---|
| Pokemon 身份、物种/形态、特性槽、性别/闪光、球、性格、等级/经验/levelExp、HP/六项 stats/IV、友好度、相遇、进化暂停、病毒 | 显式字段编码；目录 ID 引用；严格结构及数值检查 | 内容目录来自可信原模块；测试目录使用小型引用夹具，未做全图鉴遍历 |
| fusionSpecies/FormIndex/AbilityIndex/Shiny/Gender | 保留原目录引用与状态 | 不重算融合属性；融合执行本身属于原运行器 |
| summonDataPrimer、summonData | 保留能力阶段、强制招式队列、禁用招式/回合、所有标签、变身 speciesForm/fusionSpeciesForm、能力覆盖、性别、stats、moveset、types | 保留缺属性 / undefined / null 三种区别；共享可变引用用 aliases 恢复；循环对象明确拒绝 |
| battleData、battleSummonData、turnData | 命中/复活、回合/招式历史、畏缩/命中剩余、伤害和攻击来源完整编码 | Phase 与场景队列不混入这些数据类 |
| PokemonMove | moveId、ppUsed、ppUp、virtual 与原 prototype | 保留原 getMovePp/isUsable 方法；不裁剪原 PP Up 数值 |
| PlayerPokemon / EnemyPokemon | compatibleTms、trainerSlot、aiType、Boss 段数和段索引 | 末段耗尽可为 -1，按原方法允许；不是随意修正原规则 |
| 队伍与场上身份 | owner、party/reserve/enemy、组内位置、四个战场位置、稳定 Pokemon ID；历史 sourceId 可指向显式 retiredIds | 重复 ID、跨所有权上场、重复位置、未知攻击/标签来源拒绝；不生成永久个体仓库 |
| name、battleInfo、maskEnabled/maskSprite、shinySparkle、Phaser Container 字段 | 明确排除展示数据，不进规则摘要 | 根对象允许框架自有属性；AST 测试覆盖 Pokemon 各类声明的全部规则/展示字段，嵌套规则记录未知字段拒绝 |
| Battle 其他字段、场地/训练家、modifier、个人金额/背包、地图与全局计数 | 尚未在本批装配 | B2 效果组件与 Battle RNG 已有基础；不能称完整 Battle/Scene 检查点 |
| 全随机流、决策停点、待处理效果 | 尚未完整接入 | 下一批重点，见下节 |

实现文件：`src/battle-core/pokemon-state.mjs`、`roster-state.mjs`。原 `src/field/pokemon.ts` 新增注册及 `capturePokemonState` / `restorePokemonState` 导出；原战斗方法、单人 PokemonData 格式、收藏规则未修改。

恢复返回带原 PlayerPokemon/EnemyPokemon 和嵌套类 prototype 的**独立规则模型**，不运行构造器、不调用 setter/init/calculateStats/onAdd、不读取随机数。先校验整份候选，再由调用者替换模型；不会逐字段污染旧对象，也不向 getter 赋值。它尚不是初始化过的 Phaser 显示对象，不得直接加入 fieldUI；场景绑定和 UI 适配仍需后续实现。

可变引用不能静默拆成两份：原 summonDataPrimer 与 summonData 或招式数组共享时，aliases 记录路径并恢复共享关系。引用路径必须指向更早、非祖先的等价节点，拒绝循环、错类型、冲突内容；物种/形态始终引用可信目录对象。

## 尚未完成的停点与随机源清单

| 原入口 | 需要保存/转换的决策 | 当前状态 |
|---|---|---|
| SelectStarterPhase | 每席 3 只的合法选择与目录/收藏授权 | 待接原模型与选择接口 |
| CommandPhase / SelectTargetPhase / TurnInitPhase | 行动菜单、目标、已收输入、决策参与者 | M1 已保存协议输入；原 Phase 到数据决策映射待做 |
| SwitchPhase / SwitchSummonPhase | 强制替补、个人后备与已选位置 | 待做，不在动画帧保存函数队列 |
| LearnMovePhase / 进化流程 | 精灵稳定 ID、待学招式、替换/跳过、进化分支 | 待做；不得直接跳过 |
| SelectModifierPhase / ModifierRewardPhase | 个人奖励/购买/选择、双方准备 | 待做；经验归属和并行整备约定仍见 SPEC 未决项 |
| SelectBiomePhase / NewBattlePhase / GameOverPhase | 地图选择、下一战、结束 | 待做；共同地图决策未定 |

随机源：Battle 回合流已有 B1/B2；`BattleScene.seed/waveSeed/waveCycleOffset/offsetGym` 及 `Phaser.Math.RND` 全局流仍需完整清点和房间隔离。`Utils.randSeedInt/randSeedItem/randSeedGauss`、场景生成及特性等调用不能仅通过保存 Battle RNG 冒充覆盖。显示用调色随机、局外蛋与战斗随机要按来源分类，保留各自原消费顺序。

## 本批验证

- 新增 6 项单端状态测试：全部声明字段覆盖；玩家/敌人/Boss JSON 往返、原类与目录引用；原 heal/Status.incrementTurn/PokemonMove 方法继续执行差分；畸形状态/getter/目录引用拒绝；原 PP Up 算法及 Boss -1 边界；primer 共享引用与显示字段隔离。
- 新增 3 项队伍/真实 WS 测试：所有权及来源完整校验；两个独立客户端恢复原 Pokemon 类实例，在单方输入后重启服务并继续，与未中断参考一致；故意破坏一端已应用模型，确认屏障阻止下一决策，完整重同步后恢复。
- **84 项自动测试通过**（原有 75 + 本批 9）；`npm run typecheck`、`npm run build` 通过。构建保留原有大包及动态/静态混合导入警告。
- WS 用本机随机端口和测试内存存储，不使用 8020、不读取真实房间或个人存档。服务重启由关闭并重新挂载服务模拟；不称真实进程崩溃或双机验收。

测试助手加载实际 `field/pokemon.ts`、状态和标签原方法，隔离渲染依赖；少量物种/招式目录用测试夹具，明确不代表全目录/完整伤害兼容。WS 适配器只推进测试用的恢复/PP/状态方法，不是 M3 回合运行器，不在生产导入。

## 下一批

将 Pokemon 切片装配到 Battle/场景级检查点：个人本局资源、modifier/训练家与战利品、所有随机源、可恢复决策及待效果。逐切片接同一 WS 原模型恢复入口，保留单端未中断/恢复差分；未覆盖对象或停点必须拒绝。完成这些后才能勾选完整检查点验收，再进入 M3。
