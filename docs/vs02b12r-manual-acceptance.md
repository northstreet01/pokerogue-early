# VS-02B-12R 用户手测清单（当前部分可用，B 阻断）

当前自动结论：A 已到普通训练家真实敌方倒下后的下一合法输入；B 在训练家胜利后的原 `MoneyRewardPhase` 前明确停止（奖金归属未批准）。因此**没有**完整的 wave5 胜利→整备→wave6 浏览器成功路径，下面的后续步骤暂不可执行。

## 默认收藏路线（不需要额外解锁）

- 席位0：呆火鳄909＋杰尼龟7
- 席位1：新叶喵906＋杰尼龟7
- 原默认中性性格、六项 IV10、默认配招；每席6点、共12点（个人10／共享14内）
- 不导入真实存档、不修改收藏；使用新 ignored 数据目录

## 当前可自动复现的 A 路径

- server-only seed：`learning-natural-2`
- 从原 selected 入口正常战斗、奖励、整备到 wave4 末
- 进入原 wave5 Youngster，双方合法 FIGHT
- 实际攻击使训练家敌人倒下，回到下一合法 `wait-actions`
- 训练家选项中没有球；伪造投球被 `INVALID_ACTION` 拒绝

这些目前是 Worker／测试证据，不是双浏览器通过。

## B 阻断

原 `TrainerVictoryPhase.start` 会 `unshift` 原 `MoneyRewardPhase`，金额来源为 `trainer.config.moneyMultiplier` 与 `BattleScene.getWaveMoneyAmount`；wave5 Youngster 的 multiplier 0.5，按原公式为 110。奖金归谁、是否平分／复制尚无批准规则，因此当前不写金钱、不进入整备、不生成 wave6。

在奖金规则确认前，用户不需要执行整备或 wave6 手测；不要按“第5波已通关”验收。

## 后续浏览器步骤（待 B 接通后）

1. 原选队确认上述默认四人；
2. 正常打到 wave5 Youngster；
3. 实际攻击到敌方倒下、后备／空场行为正确；
4. 训练家胜利后查看原奖金／整备；
5. 双方准备后进入原自然分配的 wave6 并真实 FIGHT；
6. 刷新／同目录重启后检查不重复奖金、不重复 PP、伙伴数据不变。

浏览器结果待用户验收；自动 WS 不作为双浏览器结果。
