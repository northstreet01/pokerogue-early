# MVP-UI-01 原 UI 接入复用清单（UI-01R 修订版）

日期：2026-10-17。原文代码引用起点：`a12f409808c6f18c14e30ee6c50d7af528d95715`；本次修订代码基线：`845c64deff334e6b9b03313b2f7c892983b79595`。代码自 a12f4098 起未变，行号按修订基线复核。本文只读 early，不修改 UI、不读真实存档、不启动正式服务或浏览器。**观察**＝当前代码读到的事实；**建议**＝给主维护者的接法，不是已批准协议／玩法；**未确认**＝缺少直接桥接或尚未核对。12 个脚本全部为未来脚本，本轮未执行。

## U01–U24 调用点清单

### U01 UI 模式路由

- 观察：`src/ui/ui.ts:318` `setModeInternal`；`:327` 清理旧 handler；`:330` 切换模式；`:334` 调用新 handler `show(args)`；`:356` `setMode`、`:364` `setModeWithoutClear`、`:368` `setOverlayMode`、`:372` `revertMode`。
- 调用链：Phase／Handler → `BattleScene.ui.setMode` → `handlers[mode].clear/show`；无统一错误回传。
- 读／写：不读规则模型；写 `mode`、`modeChain`、touchControls dataset（纯显示）。
- decision／RPC：当前无正式 UI adapter 桥接；decision 由服务器提供，UI mode 不参与权威判定。
- Phaser／GameData／存储：依赖 `scene`、transitionModes、fade；不碰 GameData、不写存储。
- 建议：正式桥只把已校验 decision 映射为 UI mode；`show` 返回值不得当规则结果。
- 未确认：Mode 与 command/fight/target/party/modifier 的完整映射需逐项核对。

### U02 输入路由

- 观察：`src/ui/ui.ts:185` `processInput`；`:186` overlay 激活丢弃；`:189` 取当前 handler；`:191-192` Awaitable 教程；`:194` `handler.processInput(button)`，返回值仅表示本次输入被消费。
- 调用链：`Button` → UI.processInput → 当前 handler.processInput；不直接调用规则 Phase。
- 读／写：读 UI mode／overlay；写 handler 局部状态（纯显示）。
- decision／RPC：真实 action 都经 `native-validate`／`native-submit`；`submitAction` 的持久去重字段是 `actionId`（`src/battle-core/coop-contract.mjs:45`），不是 UI flag。
- Phaser／GameData／存储：Phaser 输入事件；无 GameData；不写存储。
- 建议：UI 可在本地 pending 时忽略重复点击，但不能替代服务器 `actionId` 去重。
- 未确认：currentPhase 与 UI mode 不一致时谁阻止输入。

### U03 指令窗与 CommandPhase 依赖

- 观察：`src/ui/command-ui-handler.ts:41` `show`；`:44` `fieldIndex = args[0]`；`:48-53` 优先 `getCurrentPhase()`，否则 `getStandbyPhase()`；`:59` `commandPhase.getPokemon().name`；`:60` cursor。
- 调用链：`CommandPhase.start` → `ui.setMode(Mode.COMMAND, fieldIndex)` → handler.show。
- 读／写：只读 CommandPhase fieldIndex／Pokemon 与消息窗；写 UI 容器、文本（纯显示）。
- decision／RPC：native 真实动作由 `native-validate`／`native-submit` 提供；无独立 RPC。
- Phaser／GameData／存储：Phaser 容器；无 GameData。
- 建议：合作双打显式传 fieldIndex，不依赖全局 currentPhase。
- 未确认：standby CommandPhase 的 fieldIndex 在原单人路径是否稳定。

### U04 FIGHT 入口与 checkFightOverride

- 观察：`src/ui/command-ui-handler.ts:76-82`；`:78` `checkFightOverride()` 为 true 直接返回；`:80` `setMode(Mode.FIGHT, getFieldIndex())`。`src/phases.ts:1653-1658` `checkFightOverride` 用 Encore 选择并直接 `handleCommand`。
- 调用链：UI ACTION → `checkFightOverride` → `handleCommand(FIGHT, forced)`；否则进 FIGHT 菜单。原 `CommandPhase.start` 的 forced 路径（`src/phases.ts:1513-1515`）在 native `native-submit` 执行原 CommandPhase 时也会跑。
- 读／写：读 Encore tag／moveset；写 `currentBattle.turnCommands`（规则写入，UI 不应自行决定）。
- decision／RPC：`native-submit`；当前无“强制动作状态”的正式 UI 投影，当前无正式桥接。
- Phaser／GameData／存储：UI 文本；无 GameData。
- 建议：强制动作判定留在运行器；UI 只展示服务器给的可用／强制状态。
- 未确认：正式 decision 是否暴露 forced／Encore 标记。

### U05 CANCEL／非 FIGHT 分支与生产缺口

- 观察：`src/ui/command-ui-handler.ts:99-100` CANCEL → `CommandPhase.cancel()`；`:85-87` BALL；`:90-91` PARTY(SWITCH, FilterNonFainted)；`:95` RUN → `handleCommand(Command.RUN, 0)`。
- 调用链：UI ACTION／CANCEL → 原 CommandPhase 方法；这些方法会写 `turnCommands` 或改 UI mode。
- 读／写：读 CommandPhase；写 turnCommands／UI（规则＋显示）。
- decision／RPC：native 运行器目前只接 FIGHT；Ball／Party／Run 无正式桥接（B 段只覆盖整备／换人），必须显式拒绝。
- Phaser／GameData／存储：UI；无 GameData。
- 建议：把 BALL／POKEMON／RUN 映射为“未支持”或后续切片，不能直接复用单人回调当完成。
- 未确认：正式协议是否规划这些 action。

### U06 FightUiHandler 招式显示

- 观察：`src/ui/fight-ui-handler.ts:39-51` `show`；`:42` fieldIndex；`:48` `displayMoves`；`:139-146` 读 `CommandPhase.getPokemon().getMoveset()`；`:101-137` 读 type／`getMovePp()`／`ppUsed`。
- 调用链：CommandPhase → `ui.setMode(Mode.FIGHT, fieldIndex)` → show/displayMoves/setCursor。
- 读／写：只读 Pokemon moveset／PP／type；写文本、icon（纯显示）。
- decision／RPC：native `wait-actions` options 含 `{kind:'fight',pokemonId,cursor,target}`；无独立 RPC。
- Phaser／GameData／存储：Phaser 文本／icon；无 GameData。
- 建议：展示原 Pokemon 视图，不重算 PP；服务器拒绝时再显示错误。
- 未确认：私有投影是否携带完整 moveset（当前 checkpoint roster 有 Pokemon fields）。

### U07 ACTION → handleCommand 返回值

- 观察：`src/ui/fight-ui-handler.ts:60-65` ACTION → `(getCurrentPhase() as CommandPhase).handleCommand(Command.FIGHT, cursor, false)`；失败 `playError()`。`src/phases.ts:1520-1643` `handleCommand`；`:1526-1546` FIGHT；`:1532-1533` 需要目标时 unshift `SelectTargetPhase`；`:1534` 写 `turnCommands[fieldIndex]`；`:1639-1640` 成功即 `end()`；`:1642` 返回 boolean。
- 调用链：FightUiHandler → CommandPhase.handleCommand → 写 command／unshift Phase。
- 读／写：读 moveset／目标；写 `currentBattle.turnCommands` 与原 Phase 队列（规则写入）。
- decision／RPC：真实边界是 `native-submit`（收集两席 FIGHT）与 `native-validate`（单席校验）；当前无正式 UI adapter。
- Phaser／GameData／存储：UI；无 GameData。
- 建议：正式桥把选择作为意图提交，服务器回包后再投影；不把客户端 `turnCommands` 当权威。
- 未确认：合作两席 command 的服务器合并顺序。

### U08 FightUiHandler CANCEL

- 观察：`src/ui/fight-ui-handler.ts:66-69` CANCEL → `setMode(Mode.COMMAND, fieldIndex)`，不写 command。
- 调用链：UI CANCEL → 回 COMMAND mode；无规则回调。
- 读／写：只写 UI mode（纯显示）。
- decision／RPC：当前无 cancel action 的正式桥接；`native-validate` 只校验已给出的 action。
- Phaser／GameData／存储：Phaser UI；无 GameData。
- 建议：保持本地返回；若服务器已锁定候选，取消／幂等策略需主维护者定协议，不在 UI 决定。
- 未确认：正式协议是否提供 cancel。

### U09 SelectTargetPhase 参数与回调

- 观察：`src/phases.ts:1700-1718`；`:1705` start；`:1708-1709` 读 turnCommand.move；`:1710` `setMode(TARGET_SELECT, fieldIndex, move, callback)`；`:1712-1715` 回调 `applyTargetSelection`，必要时 unshift CommandPhase；`:1716` `end()`。`src/ui/target-select-ui-handler.ts:27-45` show 校验 args≥3；`:37` `getMoveTargets` 重算。
- 调用链：CommandPhase FIGHT（needsTarget）→ SelectTargetPhase → TargetSelectUiHandler.show → callback → applyTargetSelection。
- 读／写：读 move／targets；写 `turnCommand.targets` 或清空／重排 CommandPhase（规则队列）。
- decision／RPC：native 有 wait-target decision（`src/battle-core/target-command.mjs:13-30`）；当前无正式 UI adapter 桥接。
- Phaser／GameData／存储：Phaser 光标／闪烁；无 GameData。
- 建议：正式投影携带 targets；UI 不本地重算，服务器重算并拒绝不一致。
- 未确认：服务器 target options 与 `getMoveTargets` 结果是否始终一致。

### U10 TargetSelect 确认／取消与全局场地索引

- 观察：`src/ui/target-select-ui-handler.ts:52-54` ACTION→`callback(cursor)`，CANCEL→`callback(-1)`；`:82-110` setCursor；`:94` `scene.getField()[cursor]` 全局索引；`:58-71` BattlerIndex 分上下。
- 调用链：processInput → targetSelectCallback → SelectTargetPhase 回调。
- 读／写：读全局 field；写光标／alpha（显示）；回调写 turnCommand（规则）。
- decision／RPC：wait-target options 用 `target`（全局场地索引）；`native-submit` 或目标 decision 校验；无正式 UI 桥。
- Phaser／GameData／存储：Phaser field 对象；无 GameData。
- 建议：合作双打沿用全局索引；个人队伍索引只用于己方展示，必须按 `roster.field` 映射。
- 未确认：替补后全局索引压缩与 target 重算边界。

### U11 目标闪烁／tween 清理

- 观察：`src/ui/target-select-ui-handler.ts:87-107` 停旧 tween、恢复旧 alpha、对新 target 建 yoyo tween；`:112-120` eraseCursor 停 tween 并 setAlpha(1)；`:122-125` clear 调 eraseCursor。
- 调用链：setCursor／clear → Phaser tween；无规则回调。
- 读／写：只写目标 alpha／tween（纯显示），不写模型或队列。
- decision／RPC：当前无正式桥接；与 decision 无关。
- Phaser／GameData／存储：Phaser tweens、`Pokemon.setAlpha`、`scene.getField()`；无 GameData。
- 建议：保留清理；展示层不得驱动规则层或 Phase 完成。
- 未确认：合作视图中对方目标是否同一对象引用。

### U12 PartyUiHandler 战前选人入口

- 观察：`src/ui/party-ui-handler.ts:55` `PartySelectCallback=(cursor,option)=>void`；`:169-194` show 读 mode／fieldIndex／selectCallback／selectFilter／moveSelectFilter／tmMoveId；`:190` populatePartySlots。调用点：`src/phases.ts:2960` POST_BATTLE_SWITCH；`:3689` 奖励选人；`src/ui/command-ui-handler.ts:90` 战斗内换人。
- 调用链：SwitchPhase／奖励 Phase／CommandPhase → setMode(PARTY,...) → showOptions → selectCallback。
- 读／写：读本人 party／filter；写选择结果与原队列（规则回调）。
- decision／RPC：`switch-confirm`／`switch-select` 与 `native-switch` 已接；正式 UI adapter 未接，当前无正式桥接。
- Phaser／GameData／存储：Phaser 容器；不写 GameData。
- 建议：战前换人复用 POST_BATTLE_SWITCH + 服务器候选 ID；不新建选择 UI。
- 未确认：`SwitchPhase.start` 对双打 fieldIndex 的覆盖（`:2958`）在合作两席下是否仍成立。

### U13 PartyUiHandler 取消与过滤

- 观察：`:345-361` CANCEL → 有 selectCallback 则 `selectCallback(6, PartyOption.CANCEL)`，否则回 COMMAND；`:97` FilterNonFainted；`:105` FilterItemMaxStacks；`:226`／`:240`／`:247` 用 selectFilter；`:391` populatePartySlots。
- 调用链：CANCEL → selectCallback(6,CANCEL) → 原 Phase 回调；过滤只影响显示／可选性。
- 读／写：读本人 party；写选择结果（规则）／UI。
- decision／RPC：switch-select 的 `pokemonId:null` 取消选项对应原回调；正式 UI 桥未接。
- Phaser／GameData／存储：Phaser UI；无 GameData。
- 建议：过滤只用本人队伍；不能把对方精灵放进本人选项。
- 未确认：合作中本人后备与 `roster.group='party'/owner/index` 的稳定映射（native checkpoint 已区分）。

### U14 CheckSwitchPhase 与 createPreBattleSwitchDecision

- 观察：`src/phases.ts:1383-1434`；`:1394-1419` start（missing／无后备／FRENZY 后 showText → `createSwitchConfirmCallbacks()` → setMode(CONFIRM, accept, cancel)）；`:1421-1433` accept unshift `SwitchPhase(fieldIndex,false,true)` 并 end，cancel 仅 end。对照 `src/battle-core/switch-command.mjs:38-49`：`switch-confirm` options `{[seat]:[{accept:true},{accept:false}]}` 与 `switch.outgoing`，验证本人 active index=0 且有后备。
- 调用链：CheckSwitchPhase → CONFIRM → 原 accept/cancel 回调；native 由 `native-switch` 恢复该回调。
- 读／写：读本人 field／reserves；写原 Phase 队列（规则）。
- decision／RPC：`switch-confirm` + `native-switch` 已接；正式 UI adapter 未接。
- Phaser／GameData／存储：Phaser CONFIRM handler；无 GameData。
- 建议：UI 的 accept/cancel 映射为 decision 的 accept boolean；服务器重算，不接受客户端自造。
- 未确认：`useName` 文案参数与正式投影的对应。

### U15 SwitchPhase 与 SwitchSummonPhase

- 观察：`src/phases.ts:2937-2971`；`:2950-2961` start（`:2958` 双打 fieldIndex 覆盖；`:2960` setMode(PARTY, POST_BATTLE_SWITCH, fieldIndex, createSwitchSelectCallback(fieldIndex), FilterNonFainted)）；`:2963-2970` 回调 selectSwitchSummon，成功 unshift `SwitchSummonPhase` `:2967`，回 MESSAGE 并 end。
- 调用链：SwitchPhase → PARTY 选择 → callback → unshift SwitchSummonPhase → end。
- 读／写：读 party／slot；写 phaseQueuePrepend（规则队列）。
- decision／RPC：`switch-select` + `native-switch` 已接；正式 UI adapter 未接。
- Phaser／GameData／存储：Phaser UI；无 GameData。
- 建议：只调原回调，后续入场仍走原 Phase 队列。
- 未确认：合作双打两席同时换人时 SwitchSummonPhase 顺序。

### U16 SelectModifierPhase → MODIFIER_SELECT

- 观察：`src/phases.ts:3566-3590`；`:3575` start；`:3578-3579` 非 reroll 更新 seed；`:3581-3586` 奖励池与数量；`:3588` `createModifierSelectCallback`；`:3589` `ui.setMode(Mode.MODIFIER_SELECT, this.isPlayer(), typeOptions, modifierSelectCallback, this.getRerollCost())`。
- 参数事实：`ui.setMode(mode, ...args)` 共五个实参，但 mode 不传入 handler args；`src/ui/modifier-select-ui-handler.ts:72` 要求 **四个 args**：player、typeOptions、callback、rerollCost；不是 handler 五参数。
- 调用链：SelectModifierPhase.start → setMode(MODIFIER_SELECT, player, typeOptions, callback, rerollCost) → handler.show(4 args) → processInput → 原回调。
- 读／写：读奖励池／money；写选择结果与原 Phase 队列（规则）。
- decision／RPC：`preparation` decision + `native-preparation`／`native-prepare-action` 已接；正式 UI adapter 未接。
- Phaser／GameData／存储：Phaser UI；无 GameData。
- 建议：整备复用该四参数 handler 形状；菜单生成后不得再次 start。
- 未确认：合作两席个人菜单与共享 SelectModifierPhase 的拆分（runner 用 player 标志与 pendingEffects 表达）。

### U17 ModifierSelect 行／光标

- 观察：`src/ui/modifier-select-ui-handler.ts:63-121` show（`:72` 四个 args，`:89` rerollCost，`:99-106` reward 行，`:108-120` shop 行）；`:19` rowCursor；`:246-274` setCursor（`:255` 按行取 options；`:257` scale；`:265` 描述）；`:277-295` setRowCursor；`:297-305` getRowItems。
- 调用链：handler.show → 构建行 → processInput → setRowCursor／setCursor → onActionInput。
- 读／写：读 options／shop／money；写光标／文本（显示）。
- decision／RPC：preparation decision 的 players[...].rewards/shop；native-prepare-action 的 skip/ready/unready 已接；reward/buy/reroll/transfer 未有正式效果桥。
- Phaser／GameData／存储：Phaser UI；无 GameData。
- 建议：正式投影保留 reward／shop 行与 rowCursor/cursor 语义。
- 未确认：合作排除 LURE 后行数与 option id 的映射（runner 有 coopRewardExclusions）。

### U18 ACTION／CANCEL 与 awaitingActionInput

- 观察：`src/ui/modifier-select-ui-handler.ts:182-244`；`:185` 未 awaitingActionInput 直接 false；`:190-200` ACTION 清 flag 后调 onActionInput(rowCursor,cursor)，返回 false 时恢复；`:201-210` CANCEL 调 onActionInput(-1)；`:63-68` active 时仅替换回调并返回 false。
- 调用链：processInput → onActionInput（原 createModifierSelectCallback）。
- 读／写：只写 UI flag／光标；不写规则模型（回调内部才写）。
- decision／RPC：正式 `submitAction` 去重字段为 `actionId`（`coop-contract.mjs:45`；服务端 receipt key `${seat}:${actionId}`，`server/formal-coop-service.mjs:196`）。
- Phaser／GameData／存储：Phaser UI；无 GameData。
- 建议：`awaitingActionInput` 只是 UI 防重入，不能替代服务器持久 `actionId` 去重。
- 未确认：ACK 前重复点击是否能被该 flag 完全挡住。

### U19 reroll／transfer 与 native-prepare-action 缺口

- 观察：`src/ui/modifier-select-ui-handler.ts:49-60` 按钮；`:222-235` LEFT/RIGHT；`src/phases.ts:3607-3635` rowCursor 0：reroll `:3610-3621`（扣钱、更新、入新 SelectModifierPhase），transfer `:3622-3634`（PARTY MODIFIER_TRANSFER）。
- 校验层次观察：`src/battle-core/safe-decisions.mjs:87-98` 先查结构／语义先验——资金不足 `INVALID_REROLL`、optionId 不存在 `INVALID_PREPARATION_OPTION`、越权 `INVALID_PREPARATION_OWNER`、非法 moveIndex `INVALID_ACTION`；全部满足后才进入 `src/battle-core/preparation-runner.mjs:47-51` 的效果可用性检查，返回 `PREPARATION_EFFECT_UNAVAILABLE`。
- 与 P11／P12 对照：P11 真实菜单 money=0、rerollCost=250，先验即 `INVALID_REROLL`，到不了效果边界；P12 的 reward 先验通过（structure／option／owner）但原效果 hook 未接，才是 `PREPARATION_EFFECT_UNAVAILABLE`。不能写成“所有 reroll 都返回效果不可用”。
- 调用链：UI 按钮／回调 → 原扣款／transfer；native 侧 `native-prepare-action`。
- 读／写：读 money／options／modifiers；写 money、菜单、modifier（规则）。
- decision／RPC：preparation decision + `native-prepare-action`；reward/buy/reroll/transfer 当前无正式效果桥。
- Phaser／GameData／存储：Phaser UI；扣款写 `scene.money`（规则内存），不写 GameData。
- 建议：接效果前补原 hook 与所有权验证；不能把测试 hook 当生产。
- 未确认：合作两席个人商店池／价格是否与单人相同。

### U20 金币显示与扣款

- 观察：`src/battle-scene.ts:1184-1186` updateMoneyText（`₽` + toLocaleString）；`:669`／`:822` 调用；`src/phases.ts:3618-3619` reroll 扣款，`:3655-3656` 购物扣款；`:3659-3663` reward cost=0 时清文本并 end。
- 调用链：UI 选择 → 原回调 → 扣款 → updateMoneyText。
- 读／写：读 scene.money；写 money（规则）与文本（显示）。
- decision／RPC：preparation 资源在 native checkpoint 的 `players[seat].money`；reward/reroll 效果桥未接。
- Phaser／GameData／存储：Phaser 文本；无 GameData。
- 建议：只定位展示与扣款点，不重写公式；正式桥以服务器资源为准。
- 未确认：个人 money 与共享 scene.money 的正式拆分。

### U21 BattleInfo 与伤害动画

- 观察：`src/ui/battle-info.ts:263` updateInfo；`:174-180` HP bar＋setHpNumbers；`:187-191` expBar 读 levelExp/getLevelTotalExp；`:380` updatePokemonExp；`:439` setHpNumbers。
- 调用链：Pokemon／Phase 展示 → updateInfo／updatePokemonExp → Phaser 文本／bar。
- 读／写：读 HP／状态／经验；写 bar／文本（纯显示）。
- decision／RPC：native Damage 展示已不重复扣 HP；正式 UI 事件桥未接（当前无正式桥接）。
- Phaser／GameData／存储：Phaser 对象；不写 GameData。
- 建议：只消费服务器事件驱动展示；伤害扣减只发生一次。
- 未确认：现有展示事件是否足够覆盖状态／经验／等级变化。

### U22 战斗消息与 Phase 结束

- 观察：`src/phases.ts:2433-2466` MessagePhase；`:2448-2458` start 按 `$` 分页；`:2457` `ui.showText(text, null, () => this.end(), ...)`；`:2460-2465` end 收起 abilityBar。`src/ui/message-ui-handler.ts:20-21` showText，`:28` showTextInternal，`:56-62` prompt／延迟；`src/ui/battle-message-ui-handler.ts:10` 继承、`:135` processInput、`:154-157` 转发。
- 调用链：MessagePhase.start → ui.showText → 文本完成／prompt 确认 → 原 end 回调 → Phase 队列。
- 读／写：读文案；写文本／prompt（显示）；end 推进原 Phase 队列（规则）。
- decision／RPC：当前无正式 UI adapter 桥接；是否把“等待确认”映射为服务器停点／新增 decision，属协议变更，由主维护者决定，本文不预判。
- Phaser／GameData／存储：Phaser 文本／prompt；无 GameData。
- 建议：隔离“展示完成”与“权威规则推进”；展示回调不得直接结束规则 Phase，除非服务器/运行器已授权。
- 未确认：pendingPrompt 与 ACK 屏障的关系。

### U23 正式 createSnapshotConsumer

- 观察：`src/battle-core/coop-client.mjs:13` createSnapshotConsumer；`:15`／`:46` 串行 chain；`:19-24` 校验类型／版本／epoch／runId／revision；`:25` 双投影 digest；`:26` applySnapshot；`:27` epoch 复检；`:28` captureAppliedState；`:29-30` shared/personal 复核；`:31` applyGrantsTransaction；`:33-34` 再取模型复核；`:36` 更新 runId/latest；`:37-38` grantAck／stateAck；`:40-44` 失败时 requestSnapshot。
- 调用链：`consume(snapshot)` → adapter.applySnapshot → captureAppliedState → applyGrantsTransaction → captureAppliedState → send ACK。
- 读／写：写 adapter 模型／授予内存；不直接写 GameData（由 adapter 决定）。
- decision／RPC：正式 snapshot 消息（`coop-contract.mjs:51`）；无 UI 桥。
- Phaser／GameData／存储：本模块不依赖 Phaser；adapter 才可能接 GameData／存储。
- 建议：原 UI 必须通过该 consumer 的 adapter 接口接入，不能绕过 digest／ACK。
- 未确认：adapter 的 applySnapshot／captureAppliedState 尚未实现原类绑定（native 入口不是正式 adapter）。

### U24 实验 client／snapshot-sync 与正式 consumer 差异

- 观察：`src/coop/client.mjs:3` 引入 applySnapshot，`:67` 以 saveGrants: applyCollectionGrants 调用；`src/coop/snapshot-sync.mjs:4-18` 只比较 ENGINE_VERSION／RULES_HASH 与整状态 stateHash，直接 saveGrants 后发 ack。
- 调用链：实验 WebSocket → applySnapshot → saveGrants → ack；无正式 adapter 三接口。
- 读／写：读实验整状态；写实验模型／收藏（实验路径）。
- decision／RPC：实验消息不是正式 `submitAction`／`stateAck` 协议；当前无正式桥。
- Phaser／GameData／存储：实验直接写收藏存储；正式 consumer 由 adapter 决定。
- 差异：无 shared/personal 双投影 digest、captureAppliedState 复核、applyGrantsTransaction、decisionId／ack 版本屏障。
- 建议：可借鉴消息序列与渲染结构，不能移植其状态模型／授予路径；正式接入走 U23。
- 未确认：实验重连恢复能否映射到正式 epoch／revision。

## 12 个双浏览器手工验收脚本（未来脚本，本轮未执行）

| # | 脚本 | 前提 | 两端操作 | 模型／UI 预期 | 检查方法 |
| --- | --- | --- | --- | --- | --- |
| B01 | 同战显示 | 原 UI 已接正式 consumer | A、B 进入同一房间并完成首战入场 | 双方看到同一波次、同一敌方与 HP | 比对截图与服务器 checkpoint；无重复入场 |
| B02 | 双方 FIGHT | 进入 wait-actions | A、B 各选真实 FIGHT 并提交 | 服务器收齐后进入原回合队列 | 查 decisionId 递增、两席 command=FIGHT |
| B03 | 目标选择／取消 | 招式需目标 | A 选目标提交；B 选目标后 CANCEL | 原 `applyTargetSelection` 在取消时清空该席临时 `turnCommands[fieldIndex]` 并重排 CommandPhase（`src/battle-core/target-command.mjs:5-10`）；在尚未向服务器提交完整联机意图时，服务器 inputs／PP 不变 | 查本地临时 command 被清空且重排；再查服务器未收到该 action、PP 未扣；不要求本地临时 command “完全未变” |
| B04 | 单方先提交 | wait-actions | A 先提交，B 等待 | A 的输入被保存，不提前执行 | 查 server inputs／ACK；A UI 显示等待 |
| B05 | 重复点击 | 菜单/战斗行动 | 同一按钮快速点两次 | 服务器按 `actionId` 去重（`coop-contract.mjs:45`；receipt key `seat:actionId`，`server/formal-coop-service.mjs:196`），只接受一次 | 查 actionId／receipt；扣款一次；UI flag 不作为持久去重证据 |
| B06 | 对方等待 | A 已提交、B 未提交 | 观察 A 的 UI | A 显示等待，不自行推进 Phase | 查服务器 decision 仍 wait-actions |
| B07 | 单方刷新 | 双方在战斗 | A 刷新浏览器 | A 恢复到同一席位且模型一致 | 比对刷新前后 checkpoint；B 不重抽 |
| B08 | 双方先后刷新 | 准备/战斗中 | 先 A 后 B 刷新 | 两人回到同一局与同一 decision | 查 runId／revision／ACK；无重复结算 |
| B09 | 独立菜单 | 进入整备 | 双方各自打开菜单／skip | 只有本人菜单与资源变化 | 比对 players、rewards、money；无跨席修改 |
| B10 | skip／ready／unready | 整备 | A skip→ready→unready；B 同时操作 | 各自 ready 标记正确，菜单不重抽 | 查 decision.id 递增、rewards 不变 |
| B11 | 战前换人 | 第二战 switch-confirm | A 接受并选后备；B 拒绝 | 只改本人 field；队列进 SwitchSummon | 查 roster.field、SwitchSummonPhase、options 归属 |
| B12 | 进入第二战再提交 | 完成换人 | 双方进入 wave 2 后各提交 FIGHT | 第二战真实命令可执行 | 查 waveIndex=2、command=FIGHT、无重复扣 PP／HP |

以上 12 项全部标“未来脚本，本轮未执行”；不把模拟 ACK、脚本计划或本文资料写成双浏览器通过。

## 8 项集成风险定位

| # | 风险 | 真实引用 | 建议 |
| --- | --- | --- | --- |
| R01 | currentPhase／standby 混用 | `command-ui-handler.ts:48-53` | UI 显式绑定 fieldIndex，不推断全局当前阶段 |
| R02 | fieldIndex 与个人 party 索引混用 | `fight-ui-handler.ts:42`、`target-select-ui-handler.ts:94`、`switch-command.mjs:41-44` | 统一 `roster.field[seat]` 与 owner/index 映射，禁止把单人 party index 当全局 |
| R03 | 个人 party 与共享 field 混用 | `party-ui-handler.ts:97`、`phases.ts:2958` | 过滤只用本人队伍；展示共享场地；双席各一 active |
| R04 | target 重新计算 | `target-select-ui-handler.ts:37` | 正式投影携带 targets；服务器重算并拒绝不一致 |
| R05 | 菜单 start 重入 | `preparation-runner.mjs:10-41`；`phases.ts:3589` | 恢复只调原命名回调，不再 start／重抽 |
| R06 | 动画结束重复推进 | `target-select-ui-handler.ts:87-107`、`battle-info.ts:263` | 展示回调不得 end() 规则 Phase；只由原队列推进 |
| R07 | epoch／revision | `coop-client.mjs:21-24,27,32,35-38` | UI 只消费已校验 consumer；旧 epoch 输入必须丢弃 |
| R08 | GameData／永久授予 | `coop-client.mjs:31`；`src/coop/snapshot-sync.mjs:9-13` | 正式 UI 不直接写收藏；授予走 M6 原子事务 |

## 核对范围

- 已核对：`src/ui/ui.ts`、`command-ui-handler.ts`、`fight-ui-handler.ts`、`target-select-ui-handler.ts`、`party-ui-handler.ts`、`modifier-select-ui-handler.ts`、`battle-info.ts`、`message-ui-handler.ts`、`battle-message-ui-handler.ts`、`src/phases.ts`、`src/battle-core/coop-client.mjs`、`src/coop/client.mjs`、`src/coop/snapshot-sync.mjs`、`src/battle-core/preparation-runner.mjs`、`src/battle-core/safe-decisions.mjs`、`src/battle-core/target-command.mjs`、`src/battle-core/switch-command.mjs`、`src/battle-core/coop-contract.mjs`、`server/formal-coop-service.mjs`。
- 原文代码引用起点 `a12f4098`；本次修订基线 `845c64de`；原 C 交付实际父提交 `84a23fca`。行号随代码变动，接入前复核。
- 本文不读真实存档、不启动服务或浏览器、不执行脚本；不修改 UI 或生产代码。
