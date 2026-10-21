# VS-02B-13：权威战斗过程展示与转场（代码／自动验收）

日期：2026-10-21。起点 `9a419345`（源码／测试基点 `f0bbc07d`），分支 `feature/vs02b13-battle-presentation`，实现提交 `804634ef25047bb7c48c90429bee79e241de9864`。未合并、未推送。本文只记录本批新增内容，旧记录和用户反馈保留。

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

## 2. 自动验证结果

| 检查 | 结果 |
|---|---|
| 完整串行 `node --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs` | **1084/1084，退出 0**；`1..1084`；fail／cancelled／skipped／todo 均 0；`1699865.8485ms`（约28分20秒） |
| 运行源码／测试树 | `804634ef`（全量运行后源码／测试无差异） |
| 新增 replay／trainer entrance 测试 | 通过 |
| 训练家事件／公开投影断言 | 通过；dialogue 事件、trainer descriptor、动画 source／target／moveId 或 commonAnim 均校验 |
| `npm run typecheck` | 退出 0 |
| `npm run build:coop-runtime` | 退出 0 |
| `npm run build` | 退出 0；Vite 53.62s，既有动态导入／chunk 警告 |

证据：ignored `build/vs02b13-final2/full.tap`、`full-exit.txt`；不提交日志。

## 3. 实际尚未验证／边界

- **真实双浏览器视觉尚未执行**：本环境没有用户浏览器操作，不能把自动测试写成浏览器通过。需要用户按第 4 节实际观察。
- 客户端在应用最终快照后回放事件，血条最终值可能先反映到模型；`damage-display` 会按剩余 HP 更新显示，但这不是逐帧服务器增量协议。若用户观察到 HP 在动画前先跳变，应作为下一轮展示时序缺口记录，不能算已验收。
- 只回放当前 snapshot 携带的 `events`；断线前更早的动画不做历史补播，只保证不重复当前事件。
- 训练家展示当前为单 sprite／名称／对话；双打伙伴训练家、特殊剧情／Boss 训练家、攻击/受击的每个帧级特效仍未验收。
- 券、同回合敌我全倒、进化、M6、地图、部署不在本批。

## 4. 用户测试步骤

### 4.1 构建和服务

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

### 4.2 默认队伍

不需要额外解锁：

- 席位0：呆火鳄909＋杰尼龟7
- 席位1：新叶喵906＋杰尼龟7
- 原默认中性性格、六项 IV10、默认配招；每席6点、共享12点

### 4.3 观察点

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

### 4.4 反馈格式

请记录：

- 是否看到技能动画／伤害数字／HP 变化／倒下／经验；
- 训练家是否显示、对话是否出现；
- 动画是否卡住、重复或与文字错位；
- 播放期间是否提前出现输入；
- 刷新后是否重复；
- 浏览器控制台错误（如有）。

自动测试和本次未执行的浏览器结果必须分开记录；用户确认前本批展示只算“自动通过、视觉待用户验收”。

## 5. 提交与工作区

- 本批实现：`804634ef`
- 既有用户反馈文档和交接／计划修改仍未提交（用户/前序工作保留，未被本批覆盖）。
- main／实时远端仍 `86798227…`；未合并、未推送。
