# M3 原奖励、购物与重抽效果接续

本批接在个人整备入口之后。HEAD `5c9f3e34`，保留此前全部未提交修改；未提交／未推送，仅在 early 开发，另一份 pokerogue 未操作，实时远端未核对。

## 实际范围

在已保存的个人 preparation 菜单上，适配测试链路已调用原领取／购买／重抽回调，并直接执行原 BattleScene.addModifier 与原道具效果。本批支持球、金钱、常用 HP／状态／复活／PP 恢复和 PP 提升类消耗品，以及连续重抽。目标必须属于操作席个人队伍，原 selectFilter／moveSelectFilter 再校验是否有效；购物价格与原当前波次商店重新核对，重抽价格与原 Phase 公式核对。校验不抽奖或改模型。

原回调负责扣款，新的候选执行不调用 M2 的扣款／applyModifier／reroll 测试 hook，避免扣两次。免费奖励完成只标记本人 rewardResolved，个人菜单上下文保留供购物与准备；购物保持奖励可领，任何实际整备操作都会取消本人的 ready，不改伙伴标志。M2 已有跳过／准备／取消准备和双方屏障继续复用；双方准备依然只到原未开始 NewBattle。

恢复现有菜单时仅重建原回调，不执行 SelectModifier.start。重抽时先完成旧原回调的扣款／end，再运行它刚排入的新原 SelectModifier 实例；rerollCount 大于零沿原规则不重置 seed。新选项、原价格、个人原待续 Phase、房间 RNG／池表与扣款作为一个候选提交。保存失败不发布任何一部分，已持久化输入恢复后只完成一次。

## 复用记录

| 来源 | 本批复用 | 必要适配／边界 |
| --- | --- | --- |
| early phases.ts SelectModifierPhase.start，基点 5c9f3e34 | 原 modifierSelectCallback 全部代码体、原目标回调、原 shop 行列映射、扣款与 end／重抽排队 | 原局部回调只作命名提取为 createModifierSelectCallback，保留 party 和回调自引用绑定；原 start 与恢复路径共用。测试逐字核对回调体（仅归一化换行），没有另写领取、价格或效果公式 |
| early battle-scene.ts addModifier | 整个原方法，包含消耗品分派、个人 party 遍历、原 shouldApply／apply、原回复加成及异步 updateInfo | 场景绑定只暴露本人 party／modifiers／money／球；任务观察器等待被原 allSettled 包裹的更新任务，拒绝失败。展示与成就仅为 hook，本批不写永久统计或券 |
| early modifier.ts／modifier-type.ts | 原工厂、类型恢复、HP／复活／状态／PP／球／钱等效果和原筛选函数 | 执行范围明确限制为当前已接的消耗品；持久道具、糖果、TM／回忆、进化／融合、转移等尚未接，不移植为简化效果。券按未确认合作规则在接收前返回 COOP_VOUCHER_RULE_UNCONFIRMED |
| 个人菜单 driver、M2 preparation、v6／v7／Phase／type codec | 原已抽选项、个人 flags／scope、原待续 Phase 和重抽生成，个人私有视图 | 不新增另一套房间／准备／去重协议，版本保持。原 shop 的可信工厂 ID 适配沿用前批；随机奖励测试额外使用显式原工厂夹具覆盖分支，不限制产品道具或内容目录 |
| M1 正式 WS、候选、规则任务观察器、实际应用模型确认 | 已收输入先落盘、结果落盘后发布、重复回执、双方 ACK、重启恢复、故障隔离 | 新 effects runner 仅把原效果执行与既有菜单协调衔接，保护其他席资源／精灵、战斗／蛋状态和全局队列；不允许原效果外的永久 grant。测试 driver 不挂生产 |

原回调未公开为网络执行代码：检查点仍只保存数据，回调从可信原类恢复。测试场景不执行真实渲染器构造；原 ConsumableModifier 的 BattleScene 类型门槛由测试场景类型绑定满足，原 Pokemon 和 Modifier 实例保留。它不是完整生产无渲染场景验收。

PLAY-15 继续生效：所有新合作重抽仍经原池生成并排除 LURE／SUPER_LURE／MAX_LURE；单人默认空排除清单。没有删改道具目录、改写单人原回调、发放未确认券或跳过 hatch-commit。

## RNG 与实际限制

本批沿用原房间 RNG 与串行提交顺序，不创建新的席位 seed 偏移，也未新增两套个人随机流。当前验证是“相同已持久化执行顺序，恢复后的结果／消费一致”；两席重抽交错时相互独立的个人 RNG 方案与完整生产 RNG 绑定尚未验收。跨房间隔离和异步任务作用域仍复用既有 AsyncLocalStorage。

完整领取范围还缺持久道具堆叠／替代、复杂成长与子决策、转移和备用换队、自动奖励与特殊战后分支。NewBattle／遭遇与下一战真实输入仍未执行。M3 仍分战后闭环、非 FIGHT、复杂机制、生产运行器四类；永久收藏事务为 M6，原合作 UI 为 M4/M5。

## 验证

本批新增 23 项（15 单端、8 真实双端 WS）。最终完整串行回归 **465/465**（约 495 秒）、`npm run typecheck`、修正回调自引用后的 `npm run build`、`git diff --check` 及新文件空白检查均通过。构建只有既有混合导入／大包警告。完整回归覆盖现有所有测试文件，原实验整备与前批原菜单／准备测试完整保留。另以原模型继续检查已领免费奖励后购物会取消本人准备并保留 rewardResolved。

- 七类原消耗品奖励，原冻结回调＋原冻结 addModifier 连续执行与 JSON 恢复后命名回调／现 addModifier 逐字段一致；回调体换行归一化后不变。
- 两席分别原药水购物：只扣一次原价、不扣伙伴资金、不消耗免费奖励；原治疗加成、复活／状态和 PP 方法直接执行。反复重抽三次的价格、原 Phase 计数、菜单、RNG／池表差分一致。
- 纯校验拒绝外席／无效目标、无效 move、变造 shop 价格、未确认券和未支持复杂道具，不消费 RNG；购物仍可在免费奖励完成后继续，ready 协调沿 M2。
- 异步 updateInfo 拒绝、越权修改、重抽菜单失败时旧 HP／PP／钱／菜单／随机状态不变。私有视图还原新原 Phase 与本人选项，队友不见结果。
- WS 双席逐操作重启、购买／重抽写盘失败、更新任务失败、已持久化输入恢复完成、免费奖励回执重放不重复发球、非法目标／券接收前拒绝、单 ACK 屏障及两房间隔离。

测试均用合成房间／蛋／原工厂夹具、内存存储与随机 loopback 端口，不读取真实房间／凭据／存档，不占用 8020；日志在系统临时目录，node_modules／dist／临时输出不纳入提交。原实验整备测试和前批原菜单测试均保留。正式 `/coop/v1/ws` 默认仍 ADAPTER_UNAVAILABLE；`/` 与 `/coop.html` 保持各自入口。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

下一批优先扩展原持久道具／成长选择的恢复执行，再接原 NewBattle；继续使用原回调和已有 M2 子决策，不重新 start 已生成菜单。券归属和敌我同回合全倒下仍需按 SPEC 第 8 节确认。
