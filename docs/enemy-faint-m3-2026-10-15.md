# M3 敌方倒下到未启动的 Victory

日期：2026-10-15。HEAD 仍 `5c9f3e34`；保留此前全部修改，本批未提交／未推送。只在 early 开发，未操作 `E:\pokeregue\pokerogue`。未核对远端实时状态。

## 实际完成与停点

适配测试链路已接普通野生敌方 Faint：原标签／FAINT 状态／友好度处理、原 BattleScene 分数公式、原 Battle.addPostBattleLoot 暂存、展示收尾和 end。两敌方位置分别验证，真实致死行动也经过原 MoveEffect／Pokemon.apply／Damage 到该边界。

原 Victory 按原队列插入且保持 remaining=start，后续 Move／MoveEnd／TurnEnd 原样保留；攻击 targets 不自动改到另一敌人。这里没有执行 Victory、授予经验、移走战后奖励队列或认定整场胜利。当前测试 driver 在下一次 ACK 尝试运行未支持的 Victory 时明确拒绝，保留已提交的倒下检查点；这不是面向产品的胜利 UI 或完整自动运行器。

本轮用户已确认经验规则：**合并双方实际参战成员计算一次，再发给各自符合条件的队员，保留原版公式及各自道具效果**。已写入 SPEC PLAY-13／第 8 节。下一批据此接原经验结算；本批不宣称已实现经验授予。蛋／券归属及敌我同回合全部倒下的最终顺序仍未确认。

## 复用及适配

| 来源 | 已复用 | 差异与原因 |
| --- | --- | --- |
| 原 FaintPhase 与前批 faint／replacement 组合 driver | 原 start／doFaint／标签／状态／展示回调／end；独立候选和任务观察 | 合作绑定增加普通野生敌方分支：按原位置排入原 Victory，沿 PLAY-09 不重定向目标。训练家／最终 Boss 等本批不支持，单人未绑定路径保持原样 |
| BattleScene.addFaintedEnemyScore（`5c9f3e34`） | 原基础经验值、等级上限、IV、持有物及 Boss 计分倍率、最后取整 | 原函数体提取为 `faint-score.mjs`，原 BattleScene 回调直接调用。没有替换分数公式；Boss 只验证纯计分倍率，未验收 Boss 运行流程 |
| 原 Battle.addPostBattleLoot | 原可转移物筛选、清 pokemonId、向 postBattleLoot 推入同一对象 | 只暂存，不给任何个人发放道具，不进入永久收藏事务。不可转移物仍保持敌方归属，分数计算先于清归属 |
| Modifier codec 与 decision v6 组件表 | 原 ModifierType／实例／共享类型／组件引用、敌方行与战利品行的别名 | 修复原生 `pokemonId=null` 战利品状态被拒绝的问题：只允许 HeldItem 后代的 pokemonId 为 null，消耗品仍拒绝；个人库存禁止 null；敌方行的 null 物品必须也在 battle.postBattleLoot 中且是同一对象，不能用空归属绕过所有权 |
| 既有完整模型／原规则测试依赖 | 原 getMaxExpLevel、GameMode.getWaveForDifficulty、Battle 原方法及目录夹具 | 在场景绑定中执行原等级上限／难度映射；补齐 Battle 原方法的 PokemonHeldItemModifier 词法依赖。native-switch helper 安装完整 Command 枚举，避免组合导入次序覆盖 FIGHT 等枚举值 |
| 冻结原方法与现有双端 harness | `5c9f3e34` 原 Faint、场景计分／等级上限，连续活模型与逐阶段生产 codec 恢复 | 原方法直接编译作对照；两端恢复真实类。生成持有物目录参数在测试 VM 中含跨 realm 数组，WS 对照先按正式 JSON 传输复制再比较；未放宽生产 JSON／对象校验 |

未迁移此前项目：early 已有全部对应原规则、状态层与双端测试，旧 Host 规则不适用于当前权威架构。没有新建替代战斗调度器、简化伤害或经验规则。

## 验证

新增 16 项：10 项单端、6 项真实 WS。最终完整串行回归 **321/321**、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。构建只有既有混合导入／大包警告；日志在系统临时目录，dist 为忽略输出，不纳入提交。

- 两个敌方位置 × 有／无持有物，模型、分数、状态、事件、队列及 RNG 与原连续执行一致；玩家资源、经验及参战集合保持。
- 真实致死行动经原伤害展示、Faint 到原未启动 Victory；之后继续执行被明确拒绝，旧边界和后续行动不丢失。
- 原战利品可转移筛选、多个物品与共享目录类型；敌方行／暂存池的同一物品身份跨 JSON 恢复保持，不提前授予玩家。
- 原分数公式覆盖等级／IV／持有物／Boss 计分倍率，共 12 组组合；不是 Boss 机制验收。
- 计分中途抛错、末尾规则任务拒绝、非法 null 消耗品／个人物品／未暂存敌方物品、最终 Boss 及存活敌方 Faint 均拒绝并保持旧状态。
- 敌我都倒下只保留未启动的 Victory，不自行决定胜负。
- 双端逐原阶段重启，核对两席投影、状态及事件；边界再次重启后继续 ACK 会拒绝不支持的 Victory，不改变检查点。
- 写盘失败／异步失败后恢复原物主、HP／状态、分数、队列和 RNG；修复重启后只计分和暂存一次。两房间的分数／物主／暂存池互不影响。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 下一批与限制

按已批准 PLAY-13 优先复用原 Victory 的经验公式、个人道具、Exp／学招／进化及既有安全阶段，完成经验部分；需要区分原 Victory 的经验、统计、战后排队及永久授予副作用。蛋／券及同时全倒下仍保留未确认边界；不能为方便直接执行整个 Victory 并跳过这些问题。

原 Victory 还用敌人的 isOnField 判断敌方是否清空。当前绑定保留倒下实例的 field ID，供后续 PokemonPhase.getPokemon 按原位置找回实例；展示容器移除只是事件。下一批须把原实例查找与逻辑离场判定分别绑定，不能把保留的 ID 当作敌人仍在场，也不能直接清空而令原 Victory 失去倒下实例。

当前只支持已声明普通野生敌方分支及受控持有物；训练家替补、复活修饰器、更多特性、复杂形态、Boss、捕获／逃跑及完整战后闭环仍缺。生产无渲染场景、全量合法意图提供者和完整 RNG 绑定仍待实现。生产 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE，测试 driver 未挂生产；`/` 与 `/coop.html` 入口和产品精灵范围保持。M3／FAINT-01／GAME-01 不整体验收。

WS 仅用合成房间、内存存储与本机随机端口，不占 8020，不读真实房间、令牌或存档。dist 忽略，日志在系统临时目录，不纳入提交；未做浏览器视觉或真实双机验收。
