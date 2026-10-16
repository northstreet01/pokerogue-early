# M3 普通遭遇的原敌方道具生成与个人道具绑定

日期：2026-10-16。开工只读核对 main、HEAD、缓存及实时 origin/main 均为 `3ce98d72`，相对 origin/main 为 0／0；远端仍为 northstreet01/pokerogue-early。保留前两批 22 个未提交文件，未重置或清理。本批未提交／未推送，只在 early 开发；另一份 pokerogue 未操作。

## 实际覆盖

在此前普通同区域经典野生双打 1→2／2→3／3→4 测试分支中，取消组合测试 driver 的“个人无道具／敌方抽取为零”限制，执行原 `generateEnemyModifiers → getEnemyModifierTypesForWave → newModifier().add → updateModifiers → updatePartyForModifiers → Pokemon.calculateStats / updateInfo`。原阈值表、稀有度升级、生成器、堆叠／上限和能力值公式均直接复用；没有为下一战另写物品抽取或能力值算法。

自然种子 encounter-items-0／3／36 分别覆盖零道具、原强化道具和树果结果；逐遭遇／敌方 PostSummon／位置／个人 CheckSwitch／拒绝回调／TurnInit 检查点 JSON 恢复，直到真实 wait-actions，与冻结原方法连续执行的检查点、事件、资源、队列与 RNG 一致。原创建和遭遇仍是同一候选，不保存半初始化 Battle。已发布遭遇恢复不重抽道具、不重复执行能力值更新。

敌方持有物属于共享敌方列表，新旧敌方实例不混用。每只玩家精灵的 scene 绑定自己的 party／modifiers，原 find／applyModifier(s) 查询与能力值探针按个人归属工作。个人列表没有合并为一个效果池。原普通 Encounter 不重新计算玩家能力值，因此本批也不插入额外个人更新；测试初始个人能力值来自原方法，与此前战后／奖励更新保持一致。

组合测试 driver 当前接收个人 EXP_CHARM、HEALING_CHARM、EXP_SHARE、LUCKY_EGG、GOLDEN_EGG、BASE_STAT_BOOSTER、SOUL_DEW、ATTACK_TYPE_BOOSTER、BERRY、TEMP_STAT_BOOSTER。实际差分夹具含双方不同堆叠、维生素、经验道具及魂露，另用原临时战斗能力值方法验证个人效果隔离。普通野生敌方池的 BERRY、BASE_STAT_BOOSTER、ATTACK_TYPE_BOOSTER、LUCKY_EGG、GOLDEN_EGG 工厂由原目录处理；自然遭遇差分实际抽中前两类，不能据此声称所有稀有抽取和战斗效果均已验收。IV_SCANNER 等会增加额外交互／规则阶段的道具明确拒绝。上述目录和波次仅限定测试覆盖，不限制产品精灵种类、世代、数量或最终道具范围。

## 复用与必要适配

| 来源 | 复用内容 | 差异与边界 |
| --- | --- | --- |
| early `src/battle-scene.ts`，基点 3ce98d72 | 原 generateEnemyModifiers、newBattle、阈值和种子方法 | 原方法体未改，沿上一批冻结源码核对；新增组合选项启用真实工厂，旧零道具 driver 默认范围保留 |
| early modifier-type／modifier、Pokemon.calculateStats | 原抽取／工厂、add／堆叠上限、原维生素与魂露等应用 | 使用现有 M2 类型／组件 codec 和测试目录依赖；不另写公式，不在恢复时调用生成器 |
| `bindExperienceModifiers`、`bindOriginalModifierUpdates` | 冻结及当前原 find／apply／remove／update 方法、既有个人场景方式 | 新 encounter 绑定器共享敌方场景、分离双方个人场景；条形图和动画等展示 hook 隔离，规则更新 Promise 均进入既有任务观察器 |
| 原 updatePartyForModifiers 的 Promise 链 | 原同步 calculateStats、原 Promise.allSettled 的 updateInfo | 观察器新增跟踪其返回 Promise；原同步能力值异常也必须拒绝候选，避免外层只有 resolve 的原链永远挂起。不修改单人原方法 |
| `next-battle-runner.mjs`、M2 decision／roster codec | 原创建＋遭遇候选、资源／蛋／场地／实例保护 | 敌方组件排在个人组件之前，会移动个人引用编号；通过同一 codec 去除敌方／loot 后投影比较个人资源实际内容与类型共享关系，不能比较过时编号。增加可信同步敌方后置校验；未提供时仍要求敌方列表不变。新增敌方与个人可变对象别名拒绝 |
| 既有 preBattle、rule-phase、M1 WS 和实际客户端模型投影 | 原敌方 PostSummon、确认拒绝／回调、真实 TurnInit 输入、ACK／去重／先保存后发布 | 新组合测试 driver；未挂生产，正式 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE，`/` 与 `/coop.html` 独立入口不变 |

未复用另一份 pokerogue，因为 early 原方法与当前 M1/M2/M3 已能承担本批规则和故障验证。完整 EnemyPokemon 构造仍使用上一批受控提供者，不把构造夹具写成生产无渲染运行器完成。个人道具不能因本批遭遇绑定就被视为已贯穿后续 Move／Damage／TurnEnd／全部换人效果。

## 验证

新增 **22 项**（15 单端、7 真实双端 WS）定向通过，`npm run typecheck`、`npm run build` 通过；本批完整串行回归 **596/596** 通过，约 671 秒。构建只有既有混合导入／大包警告，上一批 574 项为历史证据。

- 三种自然种子：冻结原规则连续执行与逐停点恢复差分一致；双端逐阶段重启重新提取各自实际原模型摘要，个人列表、敌方道具和 RNG 一致，到真实行动输入。
- 原强化道具低等级可能被最终取整吸收，测试不虚构固定能力值增量；分别验证原能力值结果、原 baseStats 应用，以及原 add 堆叠／满栈拒绝，再 JSON 恢复。
- 原个人临时能力值效果与本人的原道具列表隔离；伙伴不会查询到本人的道具。个人堆叠／规则类型／持有人注入、敌方持有人越权，以及同值敌我可变数组别名均拒绝候选。
- 原 calculateStats 抛错、原 updateInfo 拒绝、未完成异步更新不发布候选；失败保留旧个人库存、蛋、精灵及 RNG，修复后结果与连续原版相同。
- 双端拒绝换人输入重发返回原回执、不重复推进；创建／敌方 PostSummon／后续入场三处结果写盘失败恢复旧检查点，重启后重试相同原执行；另测规则失败、单 ACK 与交错两房间隔离。
- v6 原样恢复且不补空蛋库存，带蛋 v7 及 hatch-commit 仍保持 M6 前事务边界。

```powershell
node --test --test-concurrency=1 tests/battle-core-encounter-modifiers.test.mjs tests/coop-encounter-modifiers.test.mjs
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

测试只使用合成模型、房间和随机 loopback 端口，未访问真实存档／房间／恢复令牌；日志在系统临时目录，不纳入变更。含前两批保留工作，当前累计 28 个变更文件；范围检查未发现存档／房间／依赖／构建产物／临时日志，`git diff --check` 和全部新增文件空白检查通过，所列 GitHub／AWS／私钥模式扫描未命中。检查仅限本批与保留修改，不是全历史或绝对隐私保证。本批未提交／未推送。

## 下一步与剩余缺口

下一批优先把本批个人／敌方道具场景绑定贯穿已有原 FIGHT、命中／伤害、MoveEnd／TurnEnd 及战前换人入场链，核对树果、属性强化及临时效果的真实触发和一次性消费；复用原方法与现有运行器，继续原版连续／恢复和双端故障差分。本批到真实行动输入为止，不把无道具行动 driver 的旧测试计作带道具完整回合。

已只读定位下一批接缝：`move-execution-model.mjs / bindAction` 的默认 applyModifiers 为空、applyModifier=false，native-switch 的场景也只提供个人 findModifier；需通过组合 driver 显式绑定原实现，不能直接放宽这些旧夹具的支持声明。原 `TurnEndPhase` 会检查 BerryModifier 并排原 BerryPhase，也会 apply 回合回血／道具转移；原 BerryPhase 负责应用、扣栈和更新，原 MoveEffect／MoveEnd 也有持有物效果调用。下一批先核对这些原队列及异步依赖，不能只在计算伤害前挂一个道具列表就声称全链完成。

特殊遭遇／训练家／Boss／区域变化、感染、完整构造、复杂离场／入场与道具交互、TM／回忆／进化道具／融合／转移、战斗内主动换人／捕获／逃跑、生产全 RNG 和无渲染运行器仍有缺口。M3 仍部分完成；M4/M5 原 UI 与 M6 永久收藏事务另行推进。PLAY-13／14／15 保持已确认规则，券归属／时机和同时全倒下顺序未自行决定。RNG 仍只验证房间既定持久化顺序恢复，不表示个人独立随机流或生产全 RNG 验收。
