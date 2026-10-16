# M3 原持有物偷取与复活种子

日期：2026-10-16。开工保留前序 44 个未提交文件，main／HEAD 为 `3ce98d72`，只读实时 origin/main 再核对为同一提交。最近已推送代码汇总当时为 `119b9f5a`，开发阶段没有 pull、reset、清理、commit 或 push。本批只在 early 开发，另一份 pokerogue 未操作。

后续提交核对：按用户要求，含本批的累计 52 个文件已汇总提交 `a14337a9` 并推送 origin/main，推送后只读实时远端一致。下文“未提交／未推送”仅描述开发阶段，本次交接文档另行提交，最终 HEAD 和工作区以实际 Git 为准。验证及剩余边界不变。

## 实际覆盖

在现有带道具普通战斗的组合测试 driver 中，显式开启 MINI_BLACK_HOLE、GRIP_CLAW、REVIVER_SEED 三类原持有物。原默认窄 driver 的支持范围不放宽，新分支也验证原持有物最大堆叠、真实持有人和非虚拟堆叠。目录和小精灵模型仍仅限定测试范围，不限制产品种类、世代、精灵数量。

- 原 TurnEnd 调用 Mini Black Hole；原 MoveEffect 调用 Grip Claw。原 HeldItemTransferModifier.apply 自行选择实际对手、抽取和转移道具；Grip Claw 的自然种子 contact-0／contact-3 覆盖不触发／触发，未改概率或指定必出结果。保留原方法本来的目标、稀有度／道具选择与随机顺序，不另写“修正版”规则。
- 原 BattleScene.tryTransferHeldItemModifier 负责克隆、改持有人、源扣栈／移除、目标匹配／堆叠／满栈拒绝、两侧更新。双方各自从敌方偷取、敌方从玩家偷取均执行原流程；新增道具归接收精灵所属玩家／敌方列表，伙伴库存不被借用。原 clone 保留的 ModifierType 共享引用经 M2 JSON 恢复仍保持。
- 转移的原方法 host 选择源玩家的个人场景，或敌方向玩家转移时的目标个人场景；原 addEnemyModifier 始终绑定共享敌方场景。这样从玩家偷到敌方时只更新被偷玩家，不对伙伴重算能力值。按对象身份验证来源；伪造来源和直接跨玩家转移拒绝。本批没有开放个人手动道具转移菜单。
- 双方与敌方持有原 Reviver Seed 后，真实致死行动进入原 Faint，执行原 PokemonInstantReviveModifier、扣种子、updateModifiers 和原排队 PokemonHealPhase(revive=true)。Faint 提交点中 HP 仍为 0、种子已消费，随后原 Heal 独立回复；恢复只执行当前剩余队列，不重跑 Faint 或再次扣种子。完整原回合可继续到下一真实行动输入。
- 原 preventEndure=true 的玩家分支绕过种子、走原倒下，不消费持有物。敌方无可用持有复活种子或 preventEndure 分支仍拒绝由本 driver 跨越，留给已有敌方 Faint／Victory 切片组合；没有用假复活绕过胜利或全灭顺序。

本批不是原所有持有物、敌方复活增益、复杂防偷特性或完整 M3 验收。正式 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE；测试 driver 未挂生产，`/` 与 `/coop.html` 独立。

主要差分沿用既有单个存活敌方的普通双打局面（double=true、双方各自上场），未覆盖双敌方同时活动时的全部偷取目标组合；没有在产品中限制敌方或精灵数量。防偷特性调用仍走原分派，但本批未把复杂防偷特性触发写成验收。

## 复用与适配

| 来源 | 直接复用 | 必要差异／范围 |
| --- | --- | --- |
| early `modifier/modifier.ts`，基点 3ce98d72 | 原 HeldItemTransferModifier／TurnHeldItemTransferModifier／ContactHeldItemTransferChanceModifier／PokemonInstantReviveModifier | 仅给原转移最终 Promise.all(...).then(...) 加已有 observeRulePromise；普通单人无观察器时保留原 Promise 和规则行为。原概率、选择、克隆与效果公式不改 |
| early `battle-scene.ts` | 原 tryTransferHeldItemModifier、addModifier、addEnemyModifier；已有原 remove／update 方法 | 方法体未改；对持有物所属的个人／共享场景绑定，并用既有任务观察器跟踪。展示／成就 hook 仍是既有受控提供者 |
| early Faint、PokemonHeal、MoveEffect、TurnEnd，以及既有 battle-items／faint／replacement driver | 原致死、复活判定／扣栈、回血队列与下一真实输入 | 只扩展明确的原持有种子正分支和原 revive=true Heal；敌方概率复活、原敌方非复活 Faint 等不冒充已接 |
| M2 原组件／类型／roster／Phase codec，M1 WS harness | 原实例与共享类型恢复、候选隔离、双方模型提取确认、回执去重、先保存后发布 | 不新增状态版本／队列／服务，不在恢复时重新生成持有物。v6/v7 与 hatch-commit 保持 |
| 既有 withOriginalRules 与房间随机状态 | Grip Claw 原场景随机、Pokemon 原战斗随机、原目录依赖 | 在实际候选执行作用域中绑定，不在输入校验消耗 RNG；仍只验收房间既定持久化顺序恢复，不宣称个人独立随机流或生产全 RNG 完成 |
| 新冻结 early-transfer-revive-reference.json | git show 3ce98d72 提取的三条原场景方法及原 HeldItemTransfer.apply | 对原场景方法逐字核对；去掉新增观察器后转移 apply 与冻结源码一致。原 Faint／Heal／Move／TurnEnd 继续用既有冻结参考 |

没有复用另一份 pokerogue，因为 early 原方法与现有运行器已能承担本批范围；没有另建效果公式或转移账本，也没有绕过 M6 接永久收藏。原完整 Pokemon 构造和生产无渲染场景仍未完成。

## 任务收尾修复

故障注入实际复现：敌方更新先失败时，旧 helper 先 await 共享 tracker，抛错后立即 dispose，个人转移的原后续 addModifier 仍在执行，产生晚到回调及未处理拒绝。

现复用原有各场景 tracker，通过 Promise.allSettled 同时排空共享和两个个人 tracker，最后再抛出记录的失败；各已绑定 Modifier 场景的 driver 直接等待该完整 drain，不能先单独等待共享 tracker 然后跳过个人收尾。所有原回调结束后才解绑。失败候选仍被丢弃，不发布半次转移、扣栈、回复、消息或 RNG；没有通过吞掉错误使候选成功。

## 验证

新增 **51 项**定向通过（33 单端、18 真实双端 WS），类型检查和生产构建通过；构建仅有既有混合导入／大包警告。本批完整串行回归 **698/698** 通过（约 931 秒）。前序 647 项仅为上一批证据。

- 原冻结方法连续执行与逐 Phase JSON 恢复：检查点、事件、源／目标道具及共享类型、HP／状态、队列与 RNG 一致；Mini Black Hole 的单栈／多栈、匹配合并／上限、无道具／不可转移、Grip Claw 自然触发／不触发均覆盖。
- 双方和敌方从真实致死行动，经 Faint／Heal 完成原回合至真实后续输入；有检查点明确保留“已扣种子、尚未回血”，不在恢复时补回旧种子或重复回复。
- 未完成转移阻止提交；转移前任务、源／目标更新、Faint 更新、Heal 更新失败均保留各自准确的上一检查点。专门覆盖敌方先报错、个人异步任务尚未结束的晚到回调回归。
- 双端逐阶段重启重新提取实际客户端模型；真实后续输入重发返回原回执，不重复推进。六处 Faint／Heal 结果写盘失败与两种转移结果写盘失败可重启重试；另测规则任务失败、单 ACK 和两房间隔离。
- 旧窄 driver 对新增道具仍拒绝；新分支对原最大堆叠之外、未知来源、跨玩家直接转移和未支持的敌方倒下分支明确拒绝，不静默丢效果。

```powershell
node --test --test-concurrency=1 tests/battle-core-transfer-revive.test.mjs tests/coop-transfer-revive.test.mjs
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

仅用合成房间／原模型、随机 loopback 端口、既有内存存储，未读真实存档／房间／恢复令牌，不占用 8020；测试日志放系统临时目录。含前序保留工作，当前累计 52 个变更文件；git diff --check 和全部新增文件空白检查通过，未发现存档／房间／依赖／构建产物／临时输出纳入变更，所列 GitHub／AWS／私钥模式扫描未命中。仅检查当前变更和指定模式，不作全历史或绝对隐私保证。全部成果仍未提交／未推送。

## 下一步

下一批先扩展原敌方概率复活增益，核对原 revived／maxRevived 限次、场景 RNG、Faint／Heal 剩余队列及失败恢复；再扩展防偷特性与其余树果等机制。保留本批普通偷取和持有复活种子，不重做。复杂转移／特性组合、主动换人／接棒、捕获／逃跑、特殊遭遇／训练家／Boss、完整构造、复杂奖励与生产运行器仍缺。M3 部分完成，M4/M5 原 UI 和 M6 永久事务分别推进；PLAY-13／14／15 不变，券归属／时机和同时全倒下最终顺序不自行决定，RNG 仍是房间既定顺序恢复边界。
