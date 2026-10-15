# M3 个人整备中的原糖果、升级与成长选择

本批接续持久奖励切片。HEAD `5c9f3e34`，保留全部未提交修改；未提交／未推送，实时远端未核对，仅在 early 开发。

## 实际完成

适配测试链路支持原 RARE_CANDY 与 RARER_CANDY：调用原奖励回调、原 BattleScene.addModifier 和 PokemonLevelIncrementModifier.apply，再运行原 LevelUpPhase.start、原自动学招／满招式选择及原进化／取消／暂停回调。CANDY_JAR 的额外等级及个人原道具效果沿原 applyModifiers 执行；全队糖果仅遍历操作席自己的原 party。

领取、等级／经验／亲密度变化、能力值重算、已完成的自动成长和新停点同一候选提交。只有需要玩家选择时返回个人 preparation.subdecision；对应原 Phase 与剩余原队列放入个人 pendingEffects。原 LearnMove 已开始后使用 learn-apply；进化用 evolution-apply 或 evolution-pause，后续 EndEvolution 仍保存，恢复不重新 start 已完成阶段、不重新领取糖果。

共享队列中的原 NewBattle 保持未开始。成长选择结束返回本人原整备菜单，免费奖励已领取；伙伴可继续购买、领取自己的糖果、处理自己的成长、准备／取消准备。双方全部处理完各自选择并准备后，仍只停下一战边界，不执行 NewBattle。本批没有增加其他合作玩法决定。

## 复用记录

| 来源 | 直接复用 | 必要适配／未复用原因 |
| --- | --- | --- |
| 原 SelectModifier 选择回调、BattleScene.addModifier、PokemonLevelIncrementModifier.apply | 原领取、全队分派、等级／经验／亲密度处理及 LevelUp 排队 | 仅扩展既有测试 driver 的可信类型与原 Phase 收集；原函数体未修改。冻结 5c9f3e34 的 apply 源码逐字检查，未新写等级或经验公式 |
| 原 LevelUpPhase.start、LearnMove、Evolution、EndEvolution | 原能力值计算、原等级招式目录、原进化判定及已命名的剩余回调 | 直接复用此前 progressionDriver、advanceQueuedRulePhase 与 advanceProgressionChoice；不另写成长规则、升级运行器或取消进化逻辑 |
| M2 preparation.subdecision、原 Phase codec、v6/v7 pendingEffects | 原类、所属席、队列顺序和剩余阶段 | 新协调器只把个人待续 Phase 接入既有运行器，再将未完成部分放回个人 pendingEffects；共享 NewBattle、伙伴队列／选项、个人资源及蛋必须不变，不新增检查点版本 |
| 既有独立候选、规则任务观察器、M1 正式 WS 和客户端实际模型确认 | 先持久化输入、结果落盘后发布、重复回执、ACK 屏障、重启／故障矩阵 | 原菜单恢复不 start，成长失败回退到原菜单／原选择，已收输入恢复后只执行一次。测试 driver 不挂生产 |
| 原整备／蛋／资源视图与 createSnapshotConsumer | 本人原 Phase、本人原选择及原模型恢复后哈希确认 | 测试视图仅个人部分带成长 Phase 内容，伙伴只见所属席、阶段与队列位置；双方同时进化时也不泄漏对方选择引用。修正保护投影中别名编号随个人 Phase 移除变化的比较方式，以内容验证伙伴不变 |

候选额外保护伙伴／敌方精灵、共享战斗／场地／资源／蛋、原队列与跨席可变对象共享分组。故障测试验证同值数组跨席别名注入也被拒绝，不仅比较数值。每次候选自动推进最多 1000 个阶段，超界失败保留旧检查点；不把不支持阶段当成功跳过。

未复用另一套成长或房间系统，因为 early 原实现和当前 M1/M2／升级运行器已能覆盖本批。此前 pokerogue 副本未操作。原游戏规则及单人入口没有本批修改；渲染／成就／收藏仍是测试 hook，不是生产无渲染场景或永久事务验收。

## 验证

新增 26 项（16 单端、10 真实双端 WS）。修正后定向回归 **41/41**（含前批 15 项消耗品）；最终完整串行回归 **517/517**（约 563 秒）、`npm run typecheck`、`npm run build`、`git diff --check` 及新增文件空白检查均通过。构建只有既有混合导入／大包警告，原实验整备测试完整保留。

- 原冻结 addModifier／LevelUp／学招／进化规则连续执行，与当前逐选择 JSON 恢复执行的检查点和事件一致；原糖果 apply 方法体与冻结基点一致。
- 两席分别领取、自动学招、满招式换招／放弃、多等级 CANDY_JAR、全队糖果、进化、取消后暂停／继续、原暂停标志生效；能力值实际变化。
- 一方学招、另一方进化以及双方同时进化；伙伴购物会取消自己的准备，成长中的一方不会阻挡伙伴处理个人菜单。双方处理完才经过原准备屏障。
- 校验无 scene 挂载或 RNG 消费；外席选择、非法 move slot、伪造 Phase 所属／剩余方法／缺失原实例以及缺少驱动拒绝，旧输入不重复领糖果。
- 原异步任务失败、伙伴状态越权修改／跨席别名注入不发布候选，原等级／选择／资源／菜单保持；双端逐选择重启、重复回执、四类结果写盘失败及已收输入恢复、单 ACK、两房间隔离。

所有测试使用合成模型／原目录夹具、内存存储与随机 loopback 端口，不读取真实房间／令牌／存档，不占用 8020。夹具不限制产品精灵或道具范围。日志在系统临时目录，node_modules／dist／临时输出不纳入提交。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 下一步与边界

下一批优先复用原 NewBattle／遭遇流程，从双方整备完成接到下一战真实行动输入，逐个明确原创建、队列和无渲染场景依赖并补恢复差分。TM／回忆、进化道具／融合、转移／备用换队、自动奖励与特殊战后仍需后续切片；糖果触发的学招／进化完成不等于所有成长道具完成。

M3 仍有战后闭环、非 FIGHT、复杂机制、生产服务器运行器四类。原合作 UI 属于 M4/M5，完整创建／孵化及永久原子事务仍有 M3/M6 边界，保留 hatch-commit。券及敌我同时全倒下规则未确认；PLAY-13、14、15 沿已确认规则，不重复询问。RNG 只保证房间既定持久化执行顺序的恢复，独立个人随机流与生产全 RNG 尚未验收。正式 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE，`/` 与 `/coop.html` 保持各自入口。

每批完成的回复必须说明下一步开发范围。
