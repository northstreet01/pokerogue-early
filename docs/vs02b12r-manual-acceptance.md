# VS-02B-12R 用户手测清单（维护者更新，浏览器未执行）

## 维护者更新：核心可测，原Trainer展示仍缺（2026-10-21）

用户已确认原版奖金双方平分，源码f0bbc07d已自动跑通原普通Trainer胜利→原总额110分为本人55/伙伴55→个人整备→自然下一场FIGHT；恢复/写盘失败/去重验证见维护者复验。**以下浏览器步骤未执行**，原Trainer人像/对话仍未接齐，不能把其缺失当成已完成展示。下文旧“奖金未批准/B阻断”为原交付历史，已被本更新覆盖。

使用新目录，不覆盖已有房间/真实资料：

```powershell
Set-Location E:\pokeregue\pokerogue-early
npm run build:coop-runtime
npm run build
$env:COOP_PROFILE_LOBBY='1'
$env:COOP_ROOM_SEED='learning-natural-2'
$env:COOP_DIST='dist'
$env:COOP_FORMAL_DATA='build/user-vs02b12r-rooms'
$env:COOP_DATA='build/user-vs02b12r-legacy'
$env:PORT='8050'
node server/start.mjs
```

两个独立浏览器/profile打开`http://127.0.0.1:8050/coop-play.html`，各用自己的正常资料；不混用localhost/127.0.0.1或切换端口验证恢复，不清IndexedDB/outbox、不导入虚构收藏。席位0呆火鳄+杰尼龟，席位1新叶喵+杰尼龟；默认配招/IV10/中性性格参照，各6点共享12点。历史资料差异可能改变回合与奖励，不要求修改资料来匹配。

1. 正常原选队/准备；优先本人火花/树叶等原元素攻击，目标左侧存活敌人，再选另一敌人。支持治疗且本人受伤可正常领取，否则跳过；双方准备，保持当前前场。
2. 自然遇到普通Trainer后实际攻击到胜利，核对倒下敌人不再行动、不自动改打空目标。此默认原Youngster模板没有后备，不能以它手测证明通用后备；后备目前有明确原构造自动证据。
3. 核对本人原整备的金钱比战前增加55、伙伴自己的页面也增加55；球/个人队伍不因奖金改变。不要靠隐藏调用读取或改值。
4. 在原整备刷新一端，再同目录正常关服（含Worker）重启/两端刷新，钱仍是各自+55，不再增加；正常处理奖励/准备进入原下一遭遇，双方真实FIGHT，PP只按实际执行消耗。
5. 新snapshot/断线/取消重选、WASD/Enter/Esc/鼠标及窄窗按实际检查。原Trainer人像/对话缺失属于下一批已知展示缺口，记录即可，不用用户反复回避或导入其他队伍。

遇未支持进化、地图、Boss、券或其他具体机制，记录准确步骤/错误并停止，不跳阶段。不是所有seed/完整冒险/跨设备验收。

## 以下为原交付时的历史状态

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
