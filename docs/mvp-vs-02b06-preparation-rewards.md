# VS-02B-06：普通奖励真实效果的生产接缝（A/B 未完成浏览器验收）

日期：2026-10-19。基线：`807960a0b421cb0ca9bcdaa9293c67eeea8a4864`。本记录只记录实际完成代码与验证；**A 服务端奖励闭环完成可审查子集，B 双浏览器验收未完成**。

## A. 生产 Worker 普通奖励效果

### 复用来源

- `preparation-effects-runner.mjs`（既有测试 driver 契约）。
- 原 `SelectModifierPhase.createModifierSelectCallback`。
- 原 `AddPokeballModifier.apply`、`PokemonHpRestoreModifier.apply`。
- 原 `restoreModifierTypeState`、`phases` codec、`bindNativeScene` 与既有 checkpoint/事务协调。
- 不导入 `tests/` helper；不手写球数、HP 或扣款公式。

### 实际实现

- `chooseNativePreparation` 改走 `advancePreparationEffect`；`validateNativePreparation` 改走 `validatePreparationEffect`，纯校验与执行使用同一 driver。
- 生产 driver：
  - 仅 `operation:'reward'` 的普通奖励；`skip-reward/ready/unready` 仍走原安全决策。
  - 支持 `AddPokeballModifier`（原球补给）与 `PokemonHpRestoreModifierType`（POTION／SUPER／HYPER／MAX／FULL_RESTORE 等本人目标治疗）。
  - Potion 目标必须是本人 party 中、原 `selectFilter` 允许的稳定 pokemonId；伙伴／敌方、无效目标、未知 optionId、旧 revision 等分别保留原错误。
  - 用原 phase callback 领取；`view.addModifier` 只对上述 consumable 调用原 `apply`，不落地持久 modifier，从而保留 `projectNativeSnapshot` 的个人 modifiers 空断言。
  - 未支持奖励（berries、REVIVE、FULL_HEAL、RARE_CANDY、TMs、held items、voucher 等）在执行前拒绝 `PREPARATION_EFFECT_UNAVAILABLE`。
  - 商店／重抽仍不支持，明确拒绝。
- 失败候选不发布；checkpoint/RNG/伙伴状态由 `advancePreparationEffect` 的保护比较。

### A 验证

`tests/battle-core-preparation-native-effects.test.mjs`：**4/4 通过**，约 3.4s；真实 Worker：
- Pokeball 实际球数 `{1:5}`、只授予一次、重复拒绝、伙伴/RNG 不变。
- Potion 15→21（原公式封顶）、伙伴 HP 不变、rewardResolved。
- unsupported／foreign target 拒绝。
- JSON 恢复后同候选结果一致。

## B. 原奖励菜单与本人 Party 目标

- `openPreparationMenu` 复用原 `ModifierSelectUiHandler`，服务器 rewards 只恢复类型展示；不再本地抽奖/计价。
- 回调把 row1/cursor 映射到服务器 `optionId`：
  - 球类：提交 `{kind:'preparation',operation:'reward',optionId,pokemonId:null,...}`。
  - HP 恢复类：打开原 `PartyUiMode.MODIFIER`，只显示/选择本人 party，提交本人稳定 pokemonId；浏览器不应用效果。
  - 其它行（商店/重抽/不支持奖励）明确提示，不提交。
- 继续使用现有 outbox、actionId 落盘、receipt／ACK、snapshot／epoch 门控；已处理奖励不再重开可领取菜单，失败可重选。
- 保留既有 skip／ready／unready 与下一战链路。

## 未完成／失败证据

- **B 双浏览器未完成**：本轮没有启动并完成两个独立浏览器的原选队→胜利→真实领取→下一战 FIGHT。此前静态 build 曾出现 StarterSelect 黑屏；本批未取得新的浏览器领取/资源变化证据。不能把 A 的真实 Worker 测试或 WS 结果写成浏览器领取成功。
- B 代码只通过 typecheck／生产 build；未在真实菜单点击领取。
- 普通奖励仅支持精灵球补给和 HP 恢复；REVIVE/FULL_HEAL/berries/TMs/held items/商店/重抽/成长子决策未接。
- 持久道具未接，个人 modifiers 空断言保留；捕获/主动换人/本局备用/战后换队未做。
- 完整串行回归结果见下方。

## 完整回归

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
```

- 执行时 HEAD：`e844e8d220aa0a0fe43bbf8d1f2e5dd45a588bcb`（A commit；B 为未提交工作树）。
- A 测试 blob：`611822fd31053025f00e971384f7fa061048788a`。
- 退出码：**0**；TAP `1..983`，tests **983**，pass **983**，fail 0，cancelled 0，skipped 0，todo 0，1000595.2568ms（约 16m41s）。
- 日志：`build/vs02b06/full.tap`（UTF-16LE BOM）、`build/vs02b06/full-exit.txt`、`build/vs02b06/execution-meta.txt`。
- 不沿用 979/970；本批新增 4 项后为 983。
