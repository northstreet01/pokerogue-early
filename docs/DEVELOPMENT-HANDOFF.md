# 新窗口开发交接

2026-10-16 提交／推送核对：此前累计 M3 切片已汇总到 `119b9f5a` 并推送 `origin/main`（原远端 `5c9f3e34` → `119b9f5a`）。验证为完整串行回归 **517/517**、类型检查、生产构建和空白检查通过；提交包含 114 个代码、测试及文档文件，提交范围检查未发现存档／房间数据／依赖／构建产物，凭据模式扫描未命中。M3 仍部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。下一批优先原 NewBattle／遭遇到下一战真实行动输入。下方旧 HEAD、未提交／未推送和当时缺口均属历史切片记录；后续文档提交号以 Git 为准。

## 当前停在哪里

2026-10-16 提交／推送核对：此前累计 M3 切片已汇总到 `119b9f5a` 并推送 `origin/main`（原远端 `5c9f3e34` → `119b9f5a`）。验证为完整串行回归 **517/517**、类型检查、生产构建和空白检查通过；提交包含 114 个代码、测试及文档文件，提交范围检查未发现存档／房间数据／依赖／构建产物，凭据模式扫描未命中。M3 仍部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。下一批优先原 NewBattle／遭遇到下一战真实行动输入。下方旧 HEAD、未提交／未推送和当时缺口均属历史切片记录；后续文档提交号以 Git 为准。

- 历史切片：2026-10-16 糖果成长批：已接原普通／全队糖果触发的 LevelUp、自动学招／换招、进化／取消／暂停，复用已有原升级运行器与 M2 个人子决策。双方可同时处理成长，伙伴可继续个人整备；旧菜单和已开始阶段不重新 start。新增 26 项（16 单端、10 WS），完整串行回归 **517/517**、类型检查、生产构建及空白检查通过，见 [当前记录](preparation-growth-m3-2026-10-16.md)。下一批优先原 NewBattle／遭遇到下一战真实行动输入，其他复杂成长奖励仍缺。HEAD `5c9f3e34`，全部修改未提交／未推送，实时远端未核对；M3 仍部分完成，每批回复明确下一步。 以下为历史批次。

- 历史切片：2026-10-16 持久奖励批：已接原持久道具领取、堆叠／上限／满栈替代，以及原道具更新和维生素能力值重算；保护伙伴资源、精灵与可变对象引用。新增 26 项（18 单端、8 WS），完整串行回归 **491/491**、类型检查、生产构建及空白检查通过，见 [当前记录](persistent-rewards-m3-2026-10-16.md)。复杂成长子决策、NewBattle 和生产运行器仍缺。HEAD `5c9f3e34`，保留全部未提交修改，未提交／未推送，实时远端未核对。每批回复必须明确说明下一步开发范围。 以下为历史批次。

- 历史切片：原 SelectModifier 局部选择回调命名提取为 createModifierSelectCallback，保留回调自引用，原 start／恢复共用；回调体只归一化换行即可与冻结原版逐字一致。直接复用原 addModifier 和常用消耗品，购物／重抽原回调负责扣一次款；恢复旧菜单不 start，重抽新排队原实例才 start。新效果 runner 与旧 M2 协调分开扣款职责。免费奖励、购物和连续重抽已测；券／持久道具／复杂成长／转移等仍拒绝，NewBattle 未执行。新增 23 项，完整串行回归 **465/465**、类型检查、生产构建及 diff 检查通过，见 [本批记录](preparation-effects-m3.md)。以下为历史批次。

- 历史切片：无到期蛋分支执行两个个人原 SelectModifier.start，完整原奖励池／原 shop 工厂、个人资源及原 seed／池表绑定，已抽菜单持久化到 M2 preparation。可确认跳过、准备和取消准备；双方准备仅停原 NewBattle 未开始，不伪造下一战输入。PLAY-15 已确认联机始终双打，只在合作池排除三种诱饵，原单人默认池保留。原选道具／购物／重抽等效果在接收前明确拒绝；本人私有菜单、逐选择重启及结果写盘失败后已收输入恢复已测。新增 17 项，分段串行回归合计 **442/442**（435 项主回归＋7 项独立原整备 WS）、类型检查、生产构建及 diff 检查通过，见 [本批记录](preparation-m3-2026-10-15.md)。以下为历史批次。

- 历史切片：原 EggHatch.generatePokemon 直接调用不改方法体，保存原 PlayerPokemon 及 eggMoveIndex 到 hatch-commit；结果与个人 Egg 同一检查点，恢复不重抽。未运行原 start 的删蛋／渲染，也未运行 doHatch 的永久写入；当前 stop 是 M6 原子事务前边界。测试私有视图支持本人当前原 Hatch 结果，队友只见阶段／位置。创建提供者是受控夹具，完整原 Pokemon 构造／生产场景未验收。新增 19 项，完整串行回归 **425/425**、类型检查、生产构建及 diff 检查通过，见 [本批记录](egg-hatch-m3-2026-10-15.md)。以下为历史批次。

- 历史切片：PLAY-14 已接原 EggLapse，每个个人原实例只 start 一次，两席同一候选推进。新 v7 保存个人 Egg 与原 queued EggHatch 的所属席／实例引用；v6 原样支持，不补空库存。本人私有视图恢复原模型，队友蛋只显示数量与待孵化队列位置。到期停原 EggHatch 未开始，无到期停奖励；不删除蛋、不生成结果、不写永久收藏。新增 21 项，完整串行回归 **406/406**、类型检查、生产构建和 diff 检查通过。以下为历史批次。

- 历史切片：同一 victory-aftermath 只恢复原统计 hook／战后排队，剩余行动及 TurnEnd 先执行，再运行一次原 BattleEnd。原总分、battleSummonData、双方个人临时道具到期／更新、敌方 held item 清理已执行。PLAY-07 用原 REVIVE 50% 效果只恢复全灭个人第一位，不消耗物品；失败与清理同候选回滚。当前停原未开始 EggLapse，奖励／NewBattle 保留原队列；下一次 ACK 明确拒绝，不跳过蛋或发放奖励。永久统计／收藏只有 hook，M3 仍部分完成。以下为历史批次。

- 历史切片：原 LevelUpPhase.start 整段不改，已执行原能力值计算、等级招式和进化排队；原自动学招／满招式选择／换招回调、进化应用／取消暂停／EndEvolution 已接。复用 M2 learn-apply／evolution-apply／evolution-pause，恢复显式调用原剩余方法，不重跑 start；取消时 EndEvolution 在暂停选择前已排队。升级链结束到同一 victory-aftermath，统计和 BattleEnd／战后尚未执行。原成功回调的规则段仅作命名提取；统计／图鉴等为 hook，M6 事务未接。以下为历史批次。

- 历史切片：共享原参战集合、一次基础经验和个人道具，直接复用原经验段并执行原 Exp／后备经验条／Pokemon.addExp。经验排队后同一 Victory 以 `victory-aftermath` 放回原主队列前端，EXP 先按原 prepend 执行；该阶段的统计和战后排队尚未执行，**不能重新调用 Victory.start**。升级时原 LevelUp 保留所属席并明确停住，下一批复用原能力值重算／学招／进化安全阶段。以下为历史批次。

- 历史切片：普通野生敌方 Faint 已执行原标签／状态／分数／战利品暂存，停在原未启动 Victory，后续队列、位置目标和物品对象／类型别名保持；错误／写盘失败回退、双端逐阶段重启和两房间隔离已测。当前 driver 的下一次 ACK 会明确拒绝未支持的 Victory，不伪装战斗已胜利。经验方案已批准但尚未授予；蛋／券归属、同时全倒下及完整战后闭环仍缺。以下为历史批次。

- 历史切片：原 Switch.wait-switch 的合法个人实例意图已接回调，复用原 SwitchSummon／Summon／PostSummon 以及 M2 summon-initialize／summon-finish，接至下一真实行动输入；双方依次替补后还能完成一个真实新回合。恢复使用显式 resume，已开始的 Phase 不重跑 start。原撒菱入场和致死再替补已测；没有使用测试继续动作。敌方 Faint／Victory、全机制、生产 driver 等仍缺。以下为历史批次。

- 历史切片：已复用原玩家 Faint 结算及 M2 替补安全决策，受控致死回合到回合末个人 wait-switch；保留攻击位置，不改打伙伴，不重复扣 HP／PP，不压位。个人全灭时伙伴沿原 TurnInit／Command 继续输入。**尚未接受替补输入并执行入场**；敌方 Faint／胜利、同时敌我全倒下和生产 driver 仍缺。双方败退只验证安全 ended 决策，未验收 GameOver 事务。以下为历史批次。

- 历史切片：M2 的原 Command.wait-actions／SelectTarget.wait-target 已直接用于混合手动／排队动作／Encore；只在当前原 Phase 真正请求输入时暂停，只等当前席。恢复 handle／目标回调与 end，不重新 start，目标取消沿原队列重新请求；新串行 driver 已覆盖前批混合次序缺口，旧批量 driver 的拒绝仅保留作兼容回归。decision 仍 v6；Faint／非 FIGHT／更多复杂机制和生产 driver 仍未验收，下面为历史批次。

- 历史切片：普通 FIGHT 新输入收齐后执行原玩家命令、目标阶段和敌方真实选择，再进入既有出招／效果／收尾链，单端连续三个新回合、双端连续两个新回合及重启／写盘失败已测。队首排队动作／Encore 自动执行后可只等待 partner 输入；混合强制次序仍 `UNSUPPORTED_MIXED_FORCED_ORDER`。新增 advanceCollectedFightCommands 只做候选和输入边界，不重写规则／调度。Faint／Boss／非 FIGHT／复杂机制及生产 driver 仍缺；下面为历史批次。

- 历史切片：原 TurnStart 从已收齐的三方 FIGHT 命令运行，经原出招／效果／伤害／能力阶段／续击／MoveEnd／TurnEnd／TurnInit 到下一 wait-actions。保留原未开始的 Command／EnemyCommand／TurnStart 队列，下一次合法行动可验证且单方输入可持久化／重启去重。没有重写规则或调度。下一回合新命令采集到执行仍缺，Faint／Boss／非 FIGHT／复杂机制及生产 driver 也未验收；下面为前批记录。

- 最新切片：原 Damage 展示收尾不重复扣 HP，原 StatChange 与多段 MoveEffect 可逐步保存恢复；新增原版差分、任务失败／隔离和双端逐击重启／写盘失败。直接复用原类和现有运行器／codec／harness，未修改生产执行链、未新增生产 driver，decision 仍 v6。Faint 与 FINAL_BOSS 特殊收尾仍拒绝，完整回合尚未连接。以下 206 等数字与缺口属于此前切片。

- 最新 M3 切片直接复用原 MoveEnd／TurnEnd、Battle.incrementTurn 和标签／天气／场地倒计时。新增逐个原 Phase 的独立候选推进，任务失败或无效候选保留旧状态；6 组原连续执行／逐步恢复差分、3 项双端 WS 重启／写盘失败及 2 项候选故障测试通过。累计 **206/206**、类型检查、生产构建通过，已汇总提交为 `f2377193` 并推送，decision 仍为 v6。本批是独立收尾切片，尚未连通 Damage／StatChange／Faint／多段攻击到下一行动停点，完整 M3 仍部分完成。测试 driver 未挂载生产，`/` 与 `/coop.html` 保持原行为。见 [当前记录](turn-end-m3-2026-10-14.md)。以下 195／183／177 项为历史切片。

- 历史伤害切片为 195/195，见 [原伤害／效果记录](move-effect-m3-2026-10-14.md)，现已包含在 `f2377193`；其数量／提交状态／下一步属于当时记录。

- 历史出招切片为 183/183，104 组出招、92 组命中差分及 3 项 WS 证据见 [出招记录](move-action-m3-2026-10-14.md)，现已包含在 `f2377193`，不重复实现。

- M2 批次基点 `8758a080`；当时本地相对 origin/main ahead 3。已提交的 M2 增加原 Phase/队列、可变引用、安全交互停点和正式协调器 incremental/auto 推进模式。
- M2 提交的 177/177 自动测试、类型检查和生产构建通过，范围与命令见 [M2 验收记录](m2-checkpoints-2026-10-14.md)。M2 的完成表示安全停点状态层验收，不表示完整 M3 战斗运行器、原合作 UI 或真实双机已完成。
- 当前 decision payload v6（已提交 M2 基线为 v5）、Pokemon v2、roster v3、original Phase v1；M1 envelope 不变。旧检查点明确拒绝，未静默迁移或覆盖。
- 原 Phase 清单覆盖三个源文件 68 个声明/63 个具体类；待续队列六字段、非空 pendingEffects、进化/形态目录引用及共享对象已支持。已开始的 Phase 必须保存剩余阶段，恢复不能重新 start。
- 安全停点包括选队完成、待行动/目标/替补/学招、进化及取消/暂停、地图、独立整备、整备内个人子决策、待续处理和结束。选队完成允许 Battle=null；不会在恢复时生成敌人或重抽选项。
- `/` 为原单人，`/coop.html` 为隔离实验页。正式 `/coop/v1/ws` 默认仍缺 M3 原运行器并返回 ADAPTER_UNAVAILABLE。测试适配器不能接入生产冒充完整规则。

## 工作目录与保护边界

- 只在 `E:\pokeregue\pokerogue-early` 开发；远程 `https://github.com/northstreet01/pokerogue-early.git`，分支 `main`。
- 不修改 `E:\pokeregue\pokerogue`，不重置、清理或覆盖用户工作。
- 接手先读 `git status --short`、`git log -5 --oneline`、`git rev-list --left-right --count HEAD...origin/main`；本地 origin/main 可能过期，不声称远程已同步。
- 用户于 2026-10-14 明确要求本批提交、推送并更新文档；正常快进推送已成功，不强推或绕过审批拒绝。
- 不提交个人房间、恢复凭据、存档、环境秘密、node_modules、dist 和临时测试输出；不要用真实房间生成公开夹具。

## 已确认玩法

地图双方选择一致后前进，一致前可修改；战后各自独立整备，双方准备后继续。状态协调已实现，原 UI 和完整权威下一战推进仍待后续模块。没有因版本限制精灵种类、世代或内容范围；测试小目录是夹具，不是产品限制。

经验方案已确认并接原经验段：合并双方实际参战成员计算一次，再发给各自符合条件的队员，保留原版公式和个人道具效果（SPEC PLAY-13），不重复询问。原升级／学招／进化及 BattleEnd／半血恢复已有切片，永久统计／收藏和战后闭环仍待接。

蛋规则已确认 PLAY-14：每次共同过关，双方各自蛋都推进 1 波，孵化结果各归蛋原持有人，不因个人全队倒下而排除；适配测试链路已执行原 EggLapse 和原生成规则，保存个人结果；完整孵化／永久事务仍待接。券归属和同时全倒下最终顺序仍见 SPEC 第 8 节，不要重复询问蛋规则。PLAY-15 已确认合作始终双打，合作奖励排除三种诱饵，单人原池保留。

## 阅读顺序

1. [SPEC](../SPEC.md)：需求与当前验收，重点第 5/7/8 节。
   开发前必读第 4.5 节：按模块列出的复用来源、适配边界和每批复用记录要求，落实用户节省重复开发工期的要求。
2. [架构](coop-architecture-2026-10-13.md)、[计划](coop-development-plan.md)：权威边界、接口和 M1–M8 依赖。
3. [M2 当前验收](m2-checkpoints-2026-10-14.md)：字段/引用/安全停点、177 项证据、测试范围和 M3 缺口。
   当前优先读 [M3 个人整备中的糖果成长](preparation-growth-m3-2026-10-16.md)，再读 [M3 持久道具领取与更新](persistent-rewards-m3-2026-10-16.md)，再读 [M3 原奖励／购物／重抽效果](preparation-effects-m3.md)，再读 [M3 原奖励菜单／整备与合作诱饵排除](preparation-m3-2026-10-15.md)，再读 [M3 原孵化生成与结果停点](egg-hatch-m3-2026-10-15.md)，再读 [M3 原蛋推进／个人待孵化队列](egg-lapse-m3-2026-10-15.md)，再读 [M3 胜利待续／BattleEnd／恢复](victory-aftermath-m3-2026-10-15.md)，再读 [M3 原升级／学招／进化](level-up-m3-2026-10-15.md) 和 [M3 合作经验](experience-m3-2026-10-15.md)：原公式／个人效果、实际授予和 victory-aftermath 精确定义；再读 [M3 敌方倒下](enemy-faint-m3-2026-10-15.md)、[M3 个人替补入场](replacement-m3-2026-10-15.md)、[M3 玩家倒下](faint-m3-2026-10-15.md)、[M3 混合命令恢复](mixed-command-m3-2026-10-15.md)、[M3 连续回合命令](command-cycle-m3-2026-10-15.md)、[M3 无倒下回合](round-loop-m3-2026-10-15.md)、[M3 伤害后待续](post-damage-m3-2026-10-15.md) 和 [M3 原收尾](turn-end-m3-2026-10-14.md) 的来源与边界。
   再读 [M3 原伤害/效果](move-effect-m3-2026-10-14.md)：195 项结果、v6 引用、异步错误及完整回合缺口。
   再读 [M3 最新工作区](move-action-m3-2026-10-14.md)：183 项结果、实际复用、出招和命中边界、仍缺的伤害/效果。
4. 按需查看历史 [队列/换人收尾](phase-continuation-m2-2026-10-13.md)、[共享标签](shared-tag-checkpoints-m2-2026-10-13.md)、[决策随机流](decision-random-checkpoints-m2-2026-10-13.md)、Pokemon/Trainer/Modifier 记录；旧版本/数量属于当时状态。
5. [语言适配](upstream-localization-2026-10-13.md)、[实验页](../COOP.md)：维护扩展，保持原内容和独立入口。

## 下一步工作安排

M3 当前缺口合并为四类：战后到下一战闭环、非 FIGHT 实际执行、复杂机制补齐、生产服务器运行器。详细范围见 [模块计划](coop-development-plan.md#接下来执行方向)。优先第一类；原合作 UI 属于 M4／M5，永久收藏事务属于 M6。

先按 [SPEC 第 4.5 节](../SPEC.md#45-复用优先与后续开发约束)检查复用来源：M3 用 early 原规则和当前 M1/M2 基础；M4/M5 用原 UI，并适配此前项目的大厅、行动采集和展示回放；M6 用原收藏与本地事务；M7/M8 扩展现有及旧项目测试案例。此前 `E:\pokeregue\pokerogue` 只读，移植记录来源/差异/验证；不用旧 Host 权威和轻量快照替换当前架构。未复用候选须说明具体原因，不从零重写已有系统。

1. M3：保留原领取／购物／重抽、持久道具、糖果触发的 LevelUp／学招／进化及 M2 个人整备。下一批优先原 NewBattle／遭遇到下一战真实行动输入，复用原创建、队列及已有行动链；TM／回忆、进化道具／融合等另补，不将糖果成长写成全奖励完成。PLAY-15 三种诱饵排除保持；券／同时全倒下仍未确认。完整创建和 M6 消费蛋／收藏仍待接，不越过 hatch-commit。当前只保证相同房间持久化顺序的 RNG 恢复，不声称个人独立随机流完成。
2. 提供无副作用合法目标校验和房间 RNG；接原进场特性/场地、持有物、形态及非 FIGHT 效果；不把测试提供者当生产规则。
3. 每一切片都补原版未中断/恢复差分与真实 WS 双端提取确认；延续输入重发、单方输入重启、写盘失败、损坏模型、旧连接 ACK 和两房间隔离矩阵。
4. M4/M5 接原选队/共同战斗/整备 UI，M6 接永久收藏事务；M7 故障矩阵贯穿，M8 用真实双机和长局验收。

## 检查命令

```powershell
Set-Location E:\pokeregue\pokerogue-early
git status --short
git log -5 --oneline
git rev-list --left-right --count HEAD...origin/main
npm run typecheck
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run build
git diff --check
```

本机 WS 测试使用随机端口。先查现有服务，不占用 8020 或停止用户游戏。生产构建有既有 chunk/混合导入警告。并发回归曾出现测试进程无断言详情退出，相关文件单跑通过；最终验收采用串行完整回归，保留此环境限制。

## 可直接发送给新窗口

> 请继续 E:\pokeregue\pokerogue-early 的联机开发，使用中文。先读本交接、SPEC 4.5／5／7／8、模块计划及 preparation-growth-m3-2026-10-16.md，并实际核对 Git。累计 M3 代码已汇总提交 119b9f5a 并推送 origin/main，后续文档提交以 git log 为准；历史 HEAD 5c9f3e34、未提交／未推送描述不是当前状态。完整串行回归517/517、类型检查、生产构建通过。已接普通 FIGHT 闭环、倒下／替补、原经验／升级学招进化、战后／个人恢复、双方蛋推进及个人孵化结果停点、个人整备菜单／常用消耗品／持久道具／糖果成长子决策与准备屏障，M3 仍部分完成。下一批优先复用原 NewBattle／遭遇到下一战真实行动输入；现有阶段与菜单恢复不重新 start，原规则和 M1/M2／升级运行器不重写。TM／回忆、进化道具／融合、非 FIGHT、复杂机制、完整创建与生产运行器等仍缺。PLAY-13、14、15 已确认，不重复询问；券／同时全倒下仍未确认。保留 hatch-commit，不跳过 M6 消费蛋／收藏事务；RNG 只保证房间既定持久化顺序恢复，独立个人流与生产全 RNG 未验收。正式 WS 默认 ADAPTER_UNAVAILABLE，测试 driver 不挂生产。只在 early 开发，不改另一份 pokerogue，不限制内容；每批结束说明验证和下一步。
