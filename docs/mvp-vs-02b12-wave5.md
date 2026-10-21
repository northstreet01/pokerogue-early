# VS-02B-12：第5波固定训练家（部分接入，未打通）

日期：2026-10-21。起点 `6c9dc35c1f9c5f939babb7fb23988e037e012cc9`（源码／测试基点 `b4e856a3`），分支 `feature/vs02b12-wave5`；main／实时远端仍 `86798227…`。只处理 wave5 固定训练家入口，不扩 wave8、Boss、M6、孵化或部署。

## 实际改动 A 提交 `caceab6f`

- `nextNativeBattle` 只对 **wave5 固定 TRAINER** 放行，其他固定波仍拒绝；没有整体删除 fixedBattles 检查。
- 为合作双打临时把 `fixedBattles[5].double` 置 true（执行后恢复），保留原 fixedBattles 定义和原随机 variant 生成。
- `next-battle-runner` 增加固定训练家结果分支，并允许原 `ReturnPhase`／`ShowTrainerPhase` 先于 `NextEncounterPhase` 执行；仍然要求原阶段完成、资源不变和敌队非空。
- native 增加 `ShowTrainerPhase`、`ReturnPhase` 支持及 headless 训练家显示端口：
  - `Trainer.initSprite/playAnim` 仅显示层 no-op；
  - `load.atlas/once/anims`、`charSprite`、`showFieldOverlay`、`ui.showDialogue`、`setPipeline` 等显示端口；
  - 没有手写敌队、AI、等级、经验、奖金或训练家规则。
- `DisplayTarget.setPipeline`，以及 `SwitchSummonPhase` 归一化只处理 `slotIndex >= 0`，避免把 `ReturnPhase` 的 `-1` 当非法换人目标。

## 实际到达点

使用维护者已有的自然路线（`tests/helpers/native-natural-learning.mjs`，Azurill／Snorlax，固定 `learning-natural-2`）从 wave4 结束自然进入下一战：

- 修复前：`UNSUPPORTED_NATIVE_NEXT_BATTLE`。
- 修复后：已构造 wave5 的真实 `Trainer` 和 fixed-battle 队列，执行到原 `ShowTrainerPhase`／`NextEncounterPhase`。
- 最近一次失败：`NextEncounterPhase` 在 headless 执行结束时 `ended=0, waiting=null`，报 `INCOMPLETE_NATIVE_PHASE`。训练家展示异步链（对话／charSprite／enemy summon 回调）尚未闭合。
- **没有进入 wave5 的合法战斗输入，没有训练家 FIGHT、训练家胜利、整备或 wave6。**
- 因此 A **部分完成**；B 未开始。

## 验证

- `battle-core-next-battle.test.mjs` **22/22 通过**，退出 0（约 32.8s）；只覆盖既有野生／下一战路径，不含训练家。
- `npm run typecheck` 退出 0。
- `npm run build:coop-runtime` 退出 0。
- 生产 `npm run build` 退出 0，约 1m27s，既有警告。
- 完整串行回归**未运行**；不得沿用 1068。
- 自然诊断脚本在 ignored `build/vs02b12/`，未提交日志或存档。

## B

未开始。没有 wave5 胜利整备、奖金归属、wave6、原 UI 展示或双浏览器路径。训练家奖金／券归属和同回合敌我全倒仍未确认，本批没有自行决定。

## 剩余阻断

1. 训练家 `NextEncounter` 的异步显示／召唤闭包未完成（具体为 headless 对话回调与敌方召唤队列）。
2. 训练家战斗的 ball option 拒绝、敌方 AI／后备、胜利 aftermath 全部尚未验证。
3. 正式双 WS／FormalRoomStore 尚未消费本批训练家检查点。
4. 默认收藏选队和用户浏览器均未执行。

不能宣称 wave5 到 wave6 打通。

## 维护者后续复验（2026-10-21）

上文是原交付状态，保留不覆盖。维护者在独立评审分支修复Trainer.scene重绑定、展示回调、原召回/遭遇池重置事务核验，并补原默认收藏自然路线。现已进入wave5双方合法输入，有限非击倒FIGHT后可继续；正常攻击首次训练家敌方倒下仍被UNSUPPORTED_COOP_ENEMY_FAINT阻断，胜利/wave6未完成。A整体仍部分，B未开始，浏览器未执行。实际修复、失败与最终验证见[维护者复验](mvp-vs-02b12-review.md)，不能将本附录写成第5波通关。
