# VS-02B-12R：普通训练家生命周期（A 通过到下一输入，B 停在奖金策略边界）

日期：2026-10-21。起点 `880ff636`（源码／测试基点 `59c2bb25`），分支 `feature/vs02b12r-trainer-lifecycle`；main／实时远端仍 `86798227ca995c4ff40043b99a0c6846ed177154`。未合并、未推送。

## A 提交 `bb96bcc8`

### 机制实现

- 删除 native-next 的 `wave === 5` 临时准入：
  - 任意 fixed battle 只要是原 `BattleType.TRAINER` 即可进入；
  - 原 Boss（`trainer.config.isBoss`）在候选完成后仍拒绝，不按编号登记；
  - 合作双打差异只在同步调用原 `BattleScene.newBattle` 期间设置 fixed trainer 的 `double`，`finally` 立即恢复；不改 fixedBattles 定义、Trainer variant 或队伍模板。
- `faint-queue` 合作敌方分支不再只允许 WILD：
  - 保留原 `FaintPhase` 的逐敌 `VictoryPhase`；
  - TRAINER 且存在同 `trainerSlot` 的后备时，按原逻辑 push 原 `SwitchSummonPhase`；
  - 不手写敌方 AI、换位、等级、伤害、经验或 PP。
- 仍不自动改打目标；PLAY-09 的位置语义保持。
- 无后备时不伪造补位，保持原空场处理。

### 自然默认收藏验证

`tests/battle-core-native-trainer.test.mjs` 使用 `tests/helpers/native-default-trainer.mjs` 的原 `GameData.initDexData` 全新默认收藏：

- 席位0 呆火鳄909＋杰尼龟7，席位1 新叶喵906＋杰尼龟7；原默认中性性格、IV10、默认配招，每席6点、共12点；
- server-only seed `learning-natural-2`；不修改真实存档、经验、等级、HP、RNG 或队列；
- 正常到 wave4 末，进入原 wave5 Youngster；
- 实际攻击越过首次敌方倒下，回到双方合法 `wait-actions`；
- 训练家无 ball options，伪造球仍被 `INVALID_ACTION` 拒绝（既有测试）。

结果：**A 通过到下一合法输入**。训练家最终胜利在 B 的明确边界处停止。

### A 未覆盖

- 拥有后备的实际训练家（wave5 Youngster 为两员无后备）尚未取得真实 native 后备补位证据；`SwitchSummonPhase` 分支已按原逻辑接入但无自然用例。
- 正式双 WS＋FormalRoomStore 消费本次训练家倒下检查点的故障矩阵未新增；既有 M2/WS 套件仍通过，但不能冒充本批训练家事务验证。
- 浏览器未执行。

## B 提交 `cf6a9020`（部分）

- 原 `TrainerVictoryPhase` 已接入 supported phase；普通训练家用原 `TrainerVictoryPhase.start` 执行，随后原 `TrainerVictoryPhase` unshift 原 `MoneyRewardPhase`。
- 当原 `MoneyRewardPhase` 成为当前阶段时，native **明确拒绝**：
  `TRAINER_MONEY_REWARD_POLICY_UNCONFIRMED`，不写任何一方金钱，也不继续整备或 wave6。
- 原因：SPEC `PLAY-03` 只确认双方各自持有金钱；没有批准训练家奖金归谁、是否平分或复制。原触发为：
  - `TrainerVictoryPhase.start()`；
  - `trainer.config.moneyMultiplier`；
  - `BattleScene.getWaveMoneyAmount(moneyMultiplier)`；
  - wave5 Youngster 的 multiplier 为 0.5，原公式计算为 **110**（`floor(.../10)*10`）。
  该金额和归属未由本批自行决定。
- 因此 B **部分完成**：已到训练家胜利、奖金前边界；未到奖金、个人整备、双方准备、wave6。
- 券归属／时机、同回合敌我全倒仍未决定，本批未写。

### B 未执行

- 训练家奖金归属／金额落地；
- 个人整备菜单、双方准备、wave6 自然生成与双方 FIGHT；
- 原 UI 训练家/敌方展示浏览器；
- 刷新、旧回调、outbox 失败恢复等 B 浏览器路径。

## 验证

| 检查 | 结果 |
|---|---|
| 默认路线 trainer 三测 | 3/3，退出 0，约 16.6s（进入 wave5、真实敌方倒下回下一输入、胜利停在 money 边界） |
| 既有 faint 套件 | 18/18，退出 0，约 26.5s |
| 完整串行 | **1072/1072，退出 0**，`1..1072`，fail／cancelled／skipped／todo 均 0，`1206748.8398ms`（约 20m7s）；运行 HEAD `cf6a9020` |
| typecheck | 退出 0 |
| build:coop-runtime | 退出 0 |
| 生产 build | 退出 0，Vite 49.78s，既有动态导入／chunk 警告 |
| 真实双浏览器 | 未执行，待用户；当前 B 无成功整备/wave6 路径，不要按“训练家通关”测试 |

完整串行单次 TAP 与退出码在 ignored `build/vs02b12r-final/`，不提交日志。

## 用户手测状态

当前没有可交付的完整 A→B 双浏览器成功清单；B 在奖金前明确停下。可复现默认队伍与 seed 见上，服务启动和浏览器步骤须在奖金规则确认后补；不要求额外收藏解锁。不能把自动 Worker 流程写成双浏览器通过。

## 收尾

- A/B 两个独立提交。
- 工作区干净，main 未动，未合并／未推送。
- 未扩 Boss、剧情、地图、进化、M6、孵化或部署。
