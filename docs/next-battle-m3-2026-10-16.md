# M3 原 NewBattle、普通遭遇与下一战行动入口

日期：2026-10-16。开发基点 `main / 3ce98d72`，代码基线 `119b9f5a` 已包含前批切片。前序记录显示当批开始时工作区干净、缓存 `origin/main` 与 HEAD 相同，并曾只读确认实时远端同为 `3ce98d72f410260c1b558c6c976293f7af6806af`；本窗口 2026-10-16 接手复核时工作区已包含本批及后续两批未提交改动，`git fetch origin` 因本机代理 `127.0.0.1:7897` 拒连失败，提权复核又被审批系统 429 拒绝，因此实时远端未在本窗口确认。本批修改尚未提交／推送。旧文档的未提交状态和测试数量不作当前证据。

## 实际范围

适配测试链路从双方个人整备完成，执行原 `NewBattlePhase.start → BattleScene.newBattle → new Battle → NextEncounterPhase`，再逐个执行原敌方 `PostSummon`、`ToggleDoublePosition`、个人 `CheckSwitch` 和 `TurnInit`，进入下一战真实 `wait-actions`。已接回现有原 Command／目标／敌方 AI／回合链，单端可完成新战斗的首个真实 FIGHT 回合；双端可提交并恢复新战斗的真实 FIGHT 输入，没有测试继续动作或手工伪造行动阶段。

本批可验证分支：经典模式 1→2、2→3、3→4 的同区域普通野生双打；双方当前各有一只存活上场成员，各自没有可用后备，无个人／敌方道具、无感染成员，原敌方道具抽取结果为零。波次、物种小目录和队伍状态都是测试夹具，**不构成产品内容限制**。存在可用后备、持有物、Pokerus、固定战斗／训练家／Boss／跨区域等条件时明确拒绝；原抽取若命中敌方道具，整个候选失败，不丢弃结果后继续。

原 `CheckSwitch` 在本分支实际运行，使用该席自己的队伍，沿原“无可用后备”路径结束；没有代替用户回答换人。双方现有成员实际仍在场，不触发玩家 Summon；本批的入场执行证据是两个新敌人的原 PostSummon 和原位置整理，不扩大为所有玩家召回／重上场分支。

## 创建、队列和事务边界

原 `newBattle()` 返回时已生成新等级和 Battle seed，敌方队伍仍为空。M2 codec 要求等级与敌方实例完整对应，不能在这个半初始化状态落盘。因此新增 `advanceNextBattle` 只协调一个独立候选，依原队列连续执行 NewBattle 与其实际排入的 NextEncounter；两者完成后才捕获合法检查点。遭遇后的 PostSummon／位置／CheckSwitch／TurnInit 继续使用现有逐 Phase runner，不另建调度器。

输入停点由原 TurnInit 实际排入 Command 后，经已有 `finishRoundBoundary` 暴露；没有自行拼装下一战队列。原敌方生成提供者创建实例后加入既有 roster，敌方位置由原 Encounter 的 field.add 设置；旧敌方 ID 进入既有 retiredIds，使残留来源 ID 可被显式解析。原队列必须只剩原未开始的 NewBattle，存在 Hatch／其他待续效果时不可越过。

候选检查新波次、双打、原回合号、两个存活敌人、双方原位置与队伍、个人金钱／球／道具、蛋和场地；仅允许原 Encounter 重置 player battleData。保护跨玩家可变对象别名，防止同值数组被偷偷共享。失败时保留旧战斗／RNG／资源和已持久化输入；结果保存后才发布，重启重建双端 ACK。

## 复用来源与适配

| 来源（基点 3ce98d72，规则沿固定 early） | 本批直接复用 | 适配与未覆盖 |
| --- | --- | --- |
| `src/phases.ts` NewBattle／Encounter／NextEncounter／PostSummon／ToggleDoublePosition／CheckSwitch／TurnInit | 原创建调用、遭遇排队、原参战登记和输入阶段 | Encounter 原异步链仅增加 `observeRulePromise` 并返回已有嵌套 Promise，暴露资源／保存 hook 拒绝；单人没有 tracker 时仍返回原 Promise，不改规则。冻结源码核对只存在这项差异 |
| `src/battle-scene.ts` newBattle／resetSeed／getMaxExpLevel／trySpreadPokerus／generateEnemyModifiers | 原 Battle 构造、原 seed、原等级上限、原队列分支和敌方道具抽取 | 合作场景仅向原 newBattle 传批准的 `double=true`，不执行单人双打概率抽取。原生产方法体未修改。感染和非零道具结果仍阻断 |
| `src/battle.ts` Battle，`game-mode.ts`，`field/arena.ts` randomSpecies／getTrainerChance | 真正调用原 Battle 构造、等级／battleSeed 初始化、原经典模式判断、物种池抽取／野生等级替换接口 | 测试给原模式和方法补可信依赖；固定波次只提取原键用于分支识别，不创建训练家。物种目录与 EnemyPokemon 构造仍是受控提供者，完整构造、完整场景／生产 RNG 不因此验收 |
| 已有 personal preparation、M1/M2、rule-phase-runner、phase queue、codec、任务观察器 | 准备屏障、v6/v7 状态、个人所有权、独立候选、逐阶段恢复 | 不新建房间、ACK、去重或菜单机制；旧菜单不重新 start；不消费蛋、不写永久图鉴／统计 |
| 既有 command-cycle／round-loop、真实双客户端 WS harness、原模型视图 | 新战斗原行动输入、两端原模型恢复后提取摘要、单方输入重启、先落盘后发布 | driver 仍仅在测试中安装，正式 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE。永久 seen／save 是测试 hook，不能当作 M6 本地事务 |

没有移植另一份 pokerogue 的 Host 权威和轻量终态快照：本批所需规则、队列、状态及双端基础已在 early，直接复用即可；另一份目录未修改、未清理。渲染用即时展示回调，规则任务仍须完全结束，不按动画耗时裁决。原 Modifier 更新没有在本批验收，故带道具分支明确排除，不能把无道具 hook 写成全量更新完成。

## 验证

新增 **25 项**：17 单端、8 真实双端 WS。定向 **25/25**、完整串行回归 **542/542**（约 573 秒）、`npm run typecheck`、`npm run build`、`git diff --check` 及新增文件空白检查通过。构建仅有既有混合导入／大包警告。本批共 11 个变更文件，范围检查未发现存档／房间／依赖／构建产物，所列 GitHub／AWS／私钥模式扫描未命中；这仅为本批变更范围和所列模式的检查，不是全历史或绝对隐私保证。

- 冻结原创建／遭遇方法连续执行，对比每个入场阶段 JSON 保存恢复后的检查点、事件、等级、两个敌方实例、参战集合、房间 RNG 和池表；三个普通波次入口均相同。首个新战斗回合实际扣一次 PP，并进入原下一回合输入。
- v6 保持 v6，不自动补空蛋；v7 原个人蛋保持。原 player battleData 非空时确实由 Encounter 重置。特殊波次、个人可用后备、非零敌方道具抽取和待续效果明确拒绝。
- 原任务、资源加载与保存 hook 拒绝，伙伴 HP／金钱修改及同值可变数组跨席别名注入，不发布候选。
- 双端从最后 ready 到新战斗，各入场停点逐次服务重启、恢复原模型重新提取确认；下一战单方 FIGHT 输入先保存，重启重发回执不重复执行，再接另一席输入。
- 创建／PostSummon／CheckSwitch／TurnInit 结果写盘失败、最后 ready 已收输入的结果写盘失败、任务失败修复恢复、单 ACK 和两房间交错隔离。

沙箱下 loopback 连接返回 EACCES；在获准的执行环境重跑通过。全部使用合成房间／原目录夹具、内存存储和随机 loopback 端口，不访问真实存档／房间／令牌，不占用 8020。日志置于系统临时目录；依赖、dist 与临时输出不纳入变更。

## 剩余与下一步

下一批优先接有可用后备时原 `CheckSwitch → Switch` 的个人选择／取消和恢复，复用原队伍回调、现有 M2 选择与替补入场运行器；随后扩展原敌方持有物生成／更新，取消本批零道具分支限制，并补恢复差分。完整 EnemyPokemon 创建、召回／重新上场、跨区域／地图、固定训练家与 Boss 等仍待后续切片。

M3 仍部分完成；本批仅把普通受控分支接至下一战输入。TM／回忆、进化道具／融合、转移／备用换队、特殊奖励、捕获／主动战斗换人／逃跑、复杂机制与生产无渲染运行器仍缺。原合作 UI 属于 M4/M5，永久收藏及原子消费蛋属于 M6；保留 hatch-commit。券归属／时机和敌我同时全倒下最终顺序未决定；PLAY-13/14/15 保持已批准规则。RNG 仅验证房间既定持久化顺序的恢复，不表示独立个人流或生产全 RNG 验收。
