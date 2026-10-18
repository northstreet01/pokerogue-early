# VS-02B-04B：原战斗 UI 与首回合（未完成验收）

日期：2026-10-18。基线：`b4d1a38951adad50700fe343e0d0da540ab7b8ea`。本记录只记录实际代码子集与失败证据；**B1/B2 均未通过双浏览器验收**。

## 已写代码

### B1 展示子集

- `CoopPlayPhase.enterBattle(snapshot)`：
  - 从已核验 snapshot 和 `original-client-model` 已应用的本人 `PlayerPokemon` 取出本席前场；席 1 使用 `field[1]` 映射，不把本人首位当作 `party[1]`。
  - 队友与敌方用 `Object.create(PlayerPokemon.prototype)`／`EnemyPokemon.prototype` 的公开观察代理，填入 snapshot 的 species／form／level／HP／maxHp／gender／shiny；不构造完整模型、不重抽随机。
  - 设置本页 `scene.party` 为 `[seat 0 前场, seat 1 前场, 本人后备…]`，`scene.currentBattle` 为只读展示对象；不执行本地 `Phase.start`、不产生本地规则队列。
  - 尝试用原 `scene.addPokemonSprite` 在四个场上位置挂占位贴图；失败时保留原背景。
  - 更新波次／回合／己方与敌方 HP 状态文字。

### B2 输入子集

- `CoopPlayPhase.handleCommand` + `checkFightOverride`：
  - 原 `CommandUiHandler` 读取 `standbyPhase` 的 stub `getPokemon/getFieldIndex`。
  - 原 `FightUiHandler` 的 `handleCommand(FIGHT,cursor)` 调用 `selectFightCommand`，使用原招式列表／光标。
  - 需要目标时进入原 `Mode.TARGET_SELECT`；取消回原 Fight，不提交；确认后映射服务器 `decision.options` 中该席 actor 的 `{cursor,target}`。
  - 只提交合法 option，不执行本地 CommandPhase／扣 PP／推阶段。
  - 通用 `sendAction`：actionId 先写现有 IndexedDB outbox 再发送，复用正式 submitAction／receipt；不另建去重系统。
  - 非 FIGHT 按钮明确提示本片未接。

## 实际验证与失败

- `npm run typecheck` 退出 0。
- `npm run build` 退出 0（约 1m56s，既有 chunk 警告）。
- 浏览器：本机 Edge headless + CDP 曾打开 `/coop-play.html` 并进入原 StarterSelect（维护者 A 已验收），但本轮 B 代码未取得任何战斗画面证据；多次 CDP 会话出现页面 target 消失／连接拒绝，且没有完成两个独立浏览器。
- **没有**原战斗四场上位截图、没有双方原 FIGHT、没有共同结算、没有刷新续局战斗输入验证。
- 未跑完整串行回归。

## 具体缺口／风险

- 原 `PlayerPokemon` 由 codec 恢复后不是已初始化 Phaser 活容器；当前展示只挂占位 sprite，未正确补原 `init`／`loadAssets`／BattleInfo 生命周期。这是 B1 未完成的关键。
- 公开代理未实现完整渲染接口；`BattleInfo`、状态图标、动画、目标高亮没有验证。
- B2 代码可能可通过类型检查，但没有实际浏览器证据；未验证 Command/Fight/Target 原光标链、目标取消、旧 revision／epoch、重复点击与 ACK 后重开。
- 非 FIGHT 菜单（BALL／POKEMON／RUN）未接；本批不宣称完成。
- 完整回归未跑，不能沿用 953。

## 结论

**B1/B2 未达到验收，只提交可审查代码子集；不宣称双浏览器首回合。** 下一步应先修通恢复 PlayerPokemon 的 Phaser 生命周期与公开代理渲染，再在双浏览器完成一次 FIGHT，最后补事件展示/ACK 门控。
