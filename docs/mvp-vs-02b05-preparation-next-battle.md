# VS-02B-05：原整备菜单与下一战（未完成双浏览器验收）

日期：2026-10-18。基线：`4bb921bbd096833e34595d79252676d656b007a8`。本记录只描述实际代码与失败证据；**A/B 均未完成真实双浏览器验收**。

## A. 原整备菜单代码

- `CoopPlayPhase.openPreparationMenu()`：
  - 仅在 revision／epoch 已核验、本人为 requiredSeat、无 actionId／submitted 时打开。
  - 从 `personal.decision.players` 读取服务器已抽出的 rewards／shop／rerollCost；用 `restoreModifierTypeState` 恢复类型，不重新抽奖、不本地计价。
  - 复用原 `Mode.MODIFIER_SELECT`、原 `ModifierSelectUiHandler` 与原光标；`gameMode.hasNoShop=true` 避免原 handler 再次调用本地 shop 生成器。
  - 奖励选择回调只显示“普通奖励效果尚未接入”，返回 false，不提交、不应用本地 Modifier。
- 已接生产支持的动作（仅这些）：
  - `{kind:'preparation', operation:'skip-reward'}`：原跳过奖励；成功后 `rewardResolved=true`，可准备。
  - `{kind:'preparation', operation:'ready'}`：仅在 `rewardResolved` 时允许。
  - `{kind:'preparation', operation:'unready'}`。
- 购物、重抽、奖励效果、成长子决策仍由 `validatePreparationAction` 拒绝；客户端不展示成功、不静默跳过。
- 复用现有 `sendAction`：actionId 先写 IndexedDB outbox 再发送；receipt／submitted 门控；旧 revision／epoch 菜单不提交。
- 按 seat 只读本人 personal 菜单／资源；等待队友；重复同 revision syncStatus 不重开菜单。

## B. 下一战代码

- 双方 ready 后，正式服务继续原 `native-next` → NewBattle／Encounter／入场；客户端只应用新快照，不本地推进 Phase。
- `enterBattle` 对新 rev 重新应用 `CoopBattlePresentation`，清理旧展示对象；沿用原 Command／Fight／Target 输入。
- 新增 `openSwitchPrompt`：
  - `switch-confirm` 选择 `{kind:'switch-confirm', pokemonId: outgoing, accept:false}`（保持当前出场者）。
  - `switch-select` 选择 `{kind:'switch-select', pokemonId:null}`（保持当前）。
  - 只接“保持当前出场者”；更换队伍 UI 尚未接，明确提示。
- 第二战继续复用同一 `sendAction`、presentation、actor／options 映射；代码层面支持再次 FIGHT。

## 实际验证

- `npm run typecheck` 退出 0。
- `npm run build` 退出 0（约 1m17s，既有 chunk 警告）。
- 准备／下一战服务端定向：`battle-core-preparation*`、`battle-core-next-battle`、`coop-preparation`、`coop-next-battle`、`coop-original-preparation` **82/82 通过**，约 103s。
- 浏览器：正式静态 build + `server/start.mjs`（`COOP_PROFILE_LOBBY=1`，独立端口 8030／独立 ignored 房间目录）启动成功；两个独立 Edge headless profile 打开 `/coop-play.html`，A 创建房间（实测 `BCF348`），但原 StarterSelect 画面未稳定出现（canvas 黑屏、仅触控按钮），未完成选队、双方 ready、首战、整备或第二战。没有两张战斗截图、没有两端共同 FIGHT。
- 没有跑完整串行回归，不能沿用 970。

## 普通奖励到底支持什么

- **支持**：原“跳过奖励”；准备／取消准备。
- **不支持并明确拒绝**：任何 `operation:'reward'`／`'buy'`、重抽、成长子决策。当前生产 `validatePreparationAction` 只允许 skip-reward／ready／unready；本片没有补原效果端口，因此不宣称普通奖励可用。

## 结论与缺口

本批只提交可审查的原整备菜单／安全动作与下一战输入代码；**未进入第二战，也未完成双浏览器验收**。需要先解决静态 build 下 StarterSelect 黑屏／资源加载（或改用能稳定操作的两浏览器方案），再完成：
1. 两席原选队→首战两回合→revision 4 preparation；
2. 各自原整备菜单 skip→ready（一端刷新）；
3. 原 switch-confirm 保持当前；
4. 第二战双方真实 FIGHT 与新 revision；
5. 对照波次／回合／公开 HP／本人 PP；
6. 完整回归。

普通奖励效果端口、购物／重抽／成长、主动换人／捕获仍是后续缺口；孵化／永久授予和券规则不在本批。
