# VS-02B-13：权威战斗过程展示与转场（代码／自动验收）

日期：2026-10-21。起点 `9a419345`（源码／测试基点 `f0bbc07d`），分支 `feature/vs02b13-battle-presentation`，实现提交 `804634ef`，后续修复 `2311fdcc`（404／超时）与 `866a9496`（恢复显示名）。未合并、未推送。本文只记录本批新增内容，旧记录和用户反馈保留。

## 1. 完成事项

### 1.1 服务端事件补齐

原快照已经携带 `events`，但事件信息不足以播放原动画。本次补：

- `BattleAnim.play` 事件增加：
  - `sourceId`、`targetId`；
  - `moveId`（MoveAnim）；
  - `commonAnim`（CommonBattleAnim）；
  - 仍保留 `animation` 类名。
- 训练家 `showDialogue` 增加 `kind:'dialogue'`、`text`、`speaker` 事件。
- 伤害展示事件增加 `remainingHp`，客户端可按事件顺序显示血条变化。
- 公开投影 `shared.trainer` 增加只读展示描述：
  - `type`、`variant`、`name`、`partnerName`、`spriteKey`、`double`；
  - 不暴露敌方队伍、seed、RNG 或 AI 状态。
- 事件仍由正式 snapshot 的 `events` 传输；eventId／revision／eventIndex 沿用正式服务。

### 1.2 客户端展示队列

新增 `CoopBattlePresentation.playEvents()`，在 `applySnapshot` 完成权威模型 apply 后、返回快照给 consumer 之前执行：

- 按 `eventIndex` 顺序消费事件；
- 复用原 `MoveAnim`／`CommonBattleAnim`、`initMoveAnim`、`loadMoveAnimAssets`；
- 复用原伤害数字端口；
- 训练家展示：
  - 按 descriptor 加载原 Trainer atlas；
  - 显示原训练家 sprite，`ShowTrainerPhase` 从 -72 移动到 106；
  - `NewBattlePhase`／`NextEncounterPhase`／`TrainerVictoryPhase` 使用原 UI fade 转场；
- 原 `showDialogue`／`showText` 消息回放；
- 经验条事件回放；
- 事件 ID 记录到 `sessionStorage`，同一事件刷新／重复快照不再次播放；
- 播放过程中检查 epoch／disposed；新连接会中止旧队列；
- **stateAck 在播放完成后才发送**，因此双方不会在动画结束前提交下一回合；
- 任何展示异常都不会把已通过校验的快照变成失败 ACK；规则、RNG、PP、EXP、伤害仍只在服务器执行。

## 2. 卡死、404 与 undefined 消息修复（`2311fdcc`、`866a9496`）

用户实测反馈的 404 和卡死已定位到两个独立接缝：

1. **arena 404**：原 `BattleScene.preload` 直接用 `Biome[bt].toLowerCase()`，把 `METROPOLIS/JUNGLE/ISLAND` 请求成不存在的 `metropolis_*/jungle_*/island_*`；early 资产只存在 `slum/tall_grass/beach`。现使用原 `getBiomeKey` 别名并去重预加载。实测刷新后唯一 404 为 `favicon.ico`（不影响游戏）。
2. **展示等待可能无限挂住 ACK**：客户端在 `applySnapshot` 内等待动画/对话/atlas；任一原资源或回调不结束，就会让 `stateAck` 永不发送，双方停在等待。现增加：
   - 每个动画加载/播放、经验条、训练家 atlas 的超时；
   - `enterBattle` 对 apply／playEvents 分别 5s／4s 的总超时；
   - 展示异常只显示错误状态，仍完成快照应用和 ACK，不再形成重连风暴。
   - 训练家 atlas 加载也限制 2s。

`AnimationManager key already exists: pkmn__*` 是 Phaser 在重复创建显示动画时的警告，不是规则错误；它们仍可能出现，但现在不会无限阻塞输入。若卡死仍在，状态栏会显示“战斗展示回放失败”，且不应再让双方永久等 ACK。

3. **`undefined's Speed harshly fell!!` 名称缺失**：`Pokemon.name` 是展示字段，不在规则 codec 中；原生恢复后阶段用 `getPokemonMessage` 读名称，得到 undefined。现每次 native restore 后按 species/form 重新 `generateName()`，不运行构造函数、不消费规则 RNG。新增训练家回合断言：消息中不得出现字面 `undefined`。

## 3. 自动验证结果

| 检查 | 结果 |
|---|---|
| 完整串行 `node --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs` | **1084/1084，退出 0**；`1..1084`；fail／cancelled／skipped／todo 均 0；`1750551.4918ms`（约29分11秒） |
| 运行源码／测试树 | `866a9496`（全量运行后源码／测试无差异） |
| 新增 replay／trainer entrance 测试 | 通过 |
| 训练家事件／公开投影断言 | 通过；dialogue 事件、trainer descriptor、动画 source／target／moveId 或 commonAnim 均校验 |
| `npm run typecheck` | 退出 0 |
| `npm run build:coop-runtime` | 退出 0 |
| `npm run build` | 退出 0；最终构建约1m58s，既有警告 |

证据：ignored `build/vs02b13-final4/full.tap`、`full-exit.txt`；不提交日志。

## 4. 实际尚未验证／边界

- **真实双浏览器视觉尚未执行**：本环境没有用户浏览器操作，不能把自动测试写成浏览器通过。需要用户按第 5 节实际观察。
- 客户端在应用最终快照后回放事件，血条最终值可能先反映到模型；`damage-display` 会按剩余 HP 更新显示，但这不是逐帧服务器增量协议。若用户观察到 HP 在动画前先跳变，应作为下一轮展示时序缺口记录，不能算已验收。
- 只回放当前 snapshot 携带的 `events`；断线前更早的动画不做历史补播，只保证不重复当前事件。
- 训练家展示当前为单 sprite／名称／对话；双打伙伴训练家、特殊剧情／Boss 训练家、攻击/受击的每个帧级特效仍未验收。
- 券、同回合敌我全倒、进化、M6、地图、部署不在本批。

## 5. 用户测试步骤

### 5.1 构建和服务

```powershell
cd E:\pokeregue\pokerogue-early
npm run build:coop-runtime
npm run build

New-Item -ItemType Directory -Force server\data\vs02b13-formal, server\data\vs02b13-rooms | Out-Null
$env:COOP_PROFILE_LOBBY = '1'
$env:COOP_DIST = 'dist'
$env:COOP_FORMAL_DATA = 'server/data/vs02b13-formal'
$env:COOP_DATA = 'server/data/vs02b13-rooms'
$env:COOP_ROOM_SEED = 'learning-natural-2'
$env:PORT = '8031'
node server/start.mjs
```

打开两个独立浏览器（普通窗口＋无痕窗口，或两个浏览器配置）：

`http://localhost:8031/coop-play.html`

### 5.2 默认队伍

不需要额外解锁：

- 席位0：呆火鳄909＋杰尼龟7
- 席位1：新叶喵906＋杰尼龟7
- 原默认中性性格、六项 IV10、默认配招；每席6点、共享12点

### 5.3 观察点

1. 双方完成原选队并准备，进入战斗。
2. 第一次行动提交后，确认没有立刻跳到下一回合；应看到：
   - 双方行动顺序／消息；
   - 技能或变化招式动画；
   - 命中、伤害数字、HP 变化；
   - 倒下、经验条／升级提示；
   - 回合结束转场。
3. 到第5波训练家时观察：
   - 训练家 sprite 入场和移动；
   - 训练家对话文字；
   - 训练家战斗与普通野生战斗的转场差异；
   - 敌方倒下后训练家胜利文本。
4. 在动画播放期间尝试操作：下一回合输入不应提前可用；等播放完成后再出现。
5. 刷新一端或两端：
   - 不重复播放已完成的同一事件；
   - 已结算 HP／PP／经验不重复；
   - 旧 epoch 不再播放。
6. 关闭 HTTP／Worker 后同目录重启，重复第2-5项。

### 5.4 反馈格式

请记录：

- 是否看到技能动画／伤害数字／HP 变化／倒下／经验；
- 训练家是否显示、对话是否出现；
- 动画是否卡住、重复或与文字错位；
- 播放期间是否提前出现输入；
- 刷新后是否重复；
- 浏览器控制台错误（如有）。

自动测试和本次未执行的浏览器结果必须分开记录；用户确认前本批展示只算“自动通过、视觉待用户验收”。

## 6. 提交与工作区

- 本批实现：`804634ef`；404／超时修复：`2311fdcc`；undefined 名称修复：`866a9496`
- 既有用户反馈文档和交接／计划修改仍未提交（用户/前序工作保留，未被本批覆盖）。
- main／实时远端仍 `86798227…`；未合并、未推送。

## 7. 2026-10-23维护者后续复验

上文为原交付历史。维护者已核对1084日志与真实退出码，不能把它沿用到修复版本。直接发现并修复：CommonBattleAnim属性读取错误、Promise.race超时后旧任务仍继续、消息被逐字延迟覆盖、经验条不收起、失败后中途HP残留、过期fade和Trainer资源/刷新定位。修复源码2b66d130/ace41bb6，最终UI定向58/58、退出0，最终完整测试及范围见[维护者复验](mvp-vs-02b13-review.md)。

原“stateAck在播放完成后”不是无限等待或完整动画保证：现在单项等待有界、过期回放取消，失败保留最终显示及明确错误。仍未实现独立展示完成屏障、回合前HP与离场对象完整回放，原Trainer双人物和真实双浏览器未验收，因此本批展示整体部分通过。用户捕获故障、选队实时同步、钱显示、整备页完成按钮、统一入口及退出重开均不能由本批测试标为解决。下一片只接退出重开，不在维护者验收期间扩功能。

2026-10-23最终验证：源码/测试ace41bb6，完整串行1092/1092、退出0，2130421.0305ms，无失败/取消/跳过/todo；UI定向58/58、typecheck/Worker/生产build退出0（Vite1m35s）。受限EACCES中断历史单独保留，最终结果为允许本地连接后的独立完整运行。展示仍部分通过、浏览器待用户；main与实时远端仍86798227，未合并/未推送。
