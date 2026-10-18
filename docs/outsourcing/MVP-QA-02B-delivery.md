# MVP-QA-02B 交付说明：真实整备与战前换人输入矩阵

## 任务与状态

- 任务：MVP-QA-02B（MVP-QA-02 的 B 段），36 个拒绝项 + C01–C08 八项正常控制。
- 状态：**B 段定向与完整回归均已执行；因 P11 先决条件失败（退出码 1），存在阻断，不能据此合入或宣称完整通过。** 其余 43 项通过。等待维护者判断契约分歧。
- 本段不实现正式 adapter、私有投影、存档或协议；不把受控夹具写成完整 M3／原 UI／跨设备验收。

## 基线与文件

- 基线完整 SHA：`a12f409808c6f18c14e30ee6c50d7af528d95715`
- 当前分支：`outsourcing/mvp-qa-02-batch`
- 运行环境：Node.js v24.15.0；未安装依赖，未启动正式游戏。
- 本段新增文件（仅两个）：

```text
tests/battle-core-native-interactions-qa.test.mjs
docs/outsourcing/MVP-QA-02B-delivery.md
```

- 提交 SHA：见交付消息（本文件随提交一起提交，无法写入自身哈希）。

## 复用来源与适配差异

- 直接复用 `tests/battle-core-native-runtime.test.mjs` 的真实流程：`native-open-to-input` → `native-submit` → `native-run-to-boundary`（≤10 回合）到真实 `SelectModifierPhase` → `native-preparation` → 真实 `skip-reward`／`ready` → `native-next` → `native-step` 到 `switch-confirm` → 接受确认 → `native-step` 到 `switch-select`。
- 只新增测试驱动组织真实 RPC；没有 mock Worker、没有复制规则、没有手填 HP／队列／敌方或 decision 来伪造阶段。
- 固定 config：seed `mvp-native-entry`，identity `{ trainerId: 1, secretId: 2 }`；selection `{ parties: [[1, 4, 7], [906, 909, 912]], eggState: { players: [[], []] } }`。
- 每个负例使用独立复制的 wrapper／checkpoint／action，并断言：具体错误码、调用者 payload 未变、原阶段 checkpoint 未变、宿主 `request('state')` 前后相同、随后对原检查点的合法操作与控制结果全等。
- 真实 ID 均从 checkpoint 读取：`roster.field`、`roster.entries`（owner/index）、真实 rewards option id、真实 switch options；没有写死运行时 ID。
- 负例共用同一个真实 Worker；C05–C08 使用独立 Worker。所有 Worker 均通过 `t.after` 或显式 `close` 关闭。

## 逐编号结果

### 整备 P01–P20（20 项：19 通过、1 失败）

| 编号 | 场景 | 期望错误码 | 结果 |
| --- | --- | --- | --- |
| P01 | payload 为 null | INVALID_NATIVE_ACTION | 通过 |
| P02 | wrapper 多 extra | INVALID_NATIVE_ACTION | 通过 |
| P03 | wrapper 缺 seat | INVALID_NATIVE_ACTION | 通过 |
| P04 | seat=2 | INVALID_ACTION_OWNER | 通过 |
| P05 | seat 为字符串 `'0'` | INVALID_ACTION_OWNER | 通过 |
| P06 | action kind=`'fight'` | INVALID_ACTION | 通过 |
| P07 | skip-reward 多 extra | INVALID_SAFE_DECISION | 通过 |
| P08 | operation=`'unknown'` | INVALID_ACTION | 通过 |
| P09 | 尚未解决奖励就 ready | UNRESOLVED_PREPARATION | 通过 |
| P10 | 已 skip 后再次 skip | REWARD_ALREADY_RESOLVED | 通过 |
| P11 | 初始菜单请求 reroll（要求钱足够） | PREPARATION_EFFECT_UNAVAILABLE | **失败（见阻断）** |
| P12 | 真实 reward option、其余 null | PREPARATION_EFFECT_UNAVAILABLE | 通过 |
| P13 | 未知 optionId | INVALID_PREPARATION_OPTION | 通过 |
| P14 | 真实 option 但 pokemonId 取另一席在场精灵 | INVALID_PREPARATION_OWNER | 通过 |
| P15 | 真实 option 但 moveIndex=4 | INVALID_ACTION | 通过 |
| P16 | 对已打开 preparation 再 native-preparation | UNSAFE_PREPARATION_BOUNDARY | 通过 |
| P17 | 双方未 ready 直接 native-next | UNSAFE_NEXT_BATTLE_BOUNDARY | 通过 |
| P18 | 仅一席 skip+ready 直接 native-next | UNSAFE_NEXT_BATTLE_BOUNDARY | 通过 |
| P19 | 对首战 wait-actions 调 native-prepare-action | INVALID_SAFE_DECISION | 通过 |
| P20 | 对首战 wait-actions 调 native-run-to-boundary | UNSAFE_NATIVE_CONTINUATION | 通过 |

### 换人 Q01–Q16（16/16 通过）

| 编号 | 场景 | 期望错误码 | 结果 |
| --- | --- | --- | --- |
| Q01 | payload 为 null | INVALID_NATIVE_ACTION | 通过 |
| Q02 | wrapper 多 extra | INVALID_NATIVE_ACTION | 通过 |
| Q03 | wrapper 缺 inputs | INVALID_NATIVE_ACTION | 通过 |
| Q04 | inputs={} | INCOMPLETE_SWITCH_INPUTS | 通过 |
| Q05 | inputs 同时给 0、1 两席 | INCOMPLETE_SWITCH_INPUTS | 通过 |
| Q06 | inputs 只给非 requiredSeat | INCOMPLETE_SWITCH_INPUTS | 通过 |
| Q07 | inputs 为数组 | INCOMPLETE_SWITCH_INPUTS | 通过 |
| Q08 | inputs=null | INCOMPLETE_SWITCH_INPUTS | 通过 |
| Q09 | confirm accept 为字符串 `'true'` | INVALID_ACTION | 通过 |
| Q10 | confirm 缺 pokemonId | INVALID_ACTION | 通过 |
| Q11 | confirm pokemonId 取另一席在场精灵 | INVALID_ACTION | 通过 |
| Q12 | confirm pokemonId 取本人后备 | INVALID_ACTION | 通过 |
| Q13 | confirm 多 extra | INVALID_ACTION | 通过 |
| Q14 | select 选另一席后备 | INVALID_ACTION | 通过 |
| Q15 | select 选本人当前在场 | INVALID_ACTION | 通过 |
| Q16 | select 阶段提交 confirm 结构 | INVALID_ACTION | 通过 |

### 正常控制 C01–C08（8/8 通过）

- C01：新菜单 `unready` 保持未 ready；个人资源、双方 rewards/shop、随机与池状态不变；decisionId 按现有规则变为 `~1`。
- C02：两种 skip/ready 顺序得到完全相同的 checkpoint，停在未执行 `NewBattlePhase` 的 next-battle。
- C03：一席 skip→ready→unready 后另一席菜单／资源不变；可再次 ready，菜单不重抽、不提前进入下一战。
- C04：同一旧候选上重复 skip／ready／unready，三次完整结果各自全等。
- C05：preparation JSON 往返 + 新 Worker，合法 skip 的完整 checkpoint／events／intents 与不中断一致。
- C06：switch-confirm JSON 重启后拒绝换人，完整结果与不中断一致。
- C07：switch-select JSON 重启后选择本人真实后备，结果与不中断一致；继续原队列到下一 wait-actions，field 与行动 options 归属正确（另一席拒绝确认）。
- C08：两宿主交错坏整备／坏换人及合法操作；另一宿主 bootstrap state、菜单与合法结果保持独立。

## 实际命令、退出码与数量

### B 定向

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core-native-interactions-qa.test.mjs tests/battle-core-native-runtime.test.mjs tests/battle-core-native-runtime-guards.test.mjs
```

- 退出码：**1**
- 实际 TAP：tests 101，pass 100，fail 1，cancelled 0，skipped 0，todo 0，`1..101`，55069.8601ms
- 日志：`build/qa-mvp-02/target-b.tap`；退出码 `build/qa-mvp-02/target-b-exit.txt`

### A 定向（同批次前段）

- 退出码 0；tests 94，pass 94，fail 0，skipped 0；38298.3867ms；日志 `build/qa-mvp-02-a.tap`。

### 完整串行回归

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
```

- 执行时 HEAD：`1f789f1a2fb8276150f8053bc570cad686e79906`（A 提交）；工作区包含未提交的 B 两个文件。
- A 测试文件 blob：`32072270a5592325efc7f8750ddaf3b49965279c`
- B 测试文件 blob：`81d8ea40ea2d64f07115126d44cf6eea09342fa1`
- 退出码：**1**
- 实际 TAP：tests 880，pass 879，fail 1，cancelled 0，skipped 0，todo 0，`1..880`，917454.0479ms（约 15m17s）
- 唯一失败项：`P11 reroll requires the declared money precondition before the effect boundary`
- 日志：`build/qa-mvp-02/full.tap`；退出码 `build/qa-mvp-02/full-exit.txt`；执行元数据 `build/qa-mvp-02/execution-meta.txt`
- 未出现环境阻断；WS 测试包含在回归中且未失败。

## 阻断清单

### P11：reroll 的“金币足够”先决条件与实际夹具不一致

- 测试：`tests/battle-core-native-interactions-qa.test.mjs` — `P11 reroll requires the declared money precondition before the effect boundary`。
- 输入：真实初始整备菜单（`native-preparation` 后的 checkpoint），seat 0，`action={kind:'preparation',operation:'reroll'}`。
- 契约期望：先断言 `money >= rerollCost`，随后 RPC 返回 `PREPARATION_EFFECT_UNAVAILABLE`。
- 实际：`prep.players[0].money = 0`，`prep.decision.players[0].rerollCost = 250`，先决条件不成立；测试在 `assert.ok(money >= rerollCost, ...)` 失败（`AssertionError`）。
- 若跳过先决条件直接请求，实际返回 `INVALID_REROLL`（safe-decision 在 `src/battle-core/safe-decisions.mjs:91` 先检查金币与 rerollCost），无法到达 `PREPARATION_EFFECT_UNAVAILABLE`（`src/battle-core/preparation-runner.mjs:47-51` 的 effect 边界）。
- 单文件复现：

```powershell
node --test --test-concurrency=1 tests/battle-core-native-interactions-qa.test.mjs
```

退出码 1；44 项中 43 通过、1 失败（P11）；可稳定重现。

- 稳定性与范围：固定夹具下真实菜单金币恒为 0；没有修改 checkpoint 或金币来制造通过，没有把实际错误码写成 expected，没有 skip。
- 影响：**B 定向与完整回归均为退出码 1，存在阻断，不能据此合入或宣称完整通过。**
- 处理建议（仅供参考，未实施）：由维护者决定是调整验收夹具（提供合法获得的足够金币路径），还是把 P11 的预期改为先验 `INVALID_REROLL`／新增“钱足够时”的受控真实路径；测试保持当前期望，不自行放宽。

## 已知限制

- 只覆盖声明的普通受控分支（固定种子、假身份、各三只 5 级精灵、空蛋库存、波次 1→2）；不代表全机制、特殊遭遇、训练家／Boss、非 FIGHT、LevelUp 子决策或永久收藏。
- 只验证真实整备／战前换人的 RPC 边界与 Worker 引导状态；未验证完整房间 RNG、落盘回滚、生产 WS 故障矩阵、私有投影或正式 adapter。
- 未重新 typecheck／build：生产源码与依赖相对前序未变，本轮只新增测试。
- A／B 的 36+36+8 数量来自实际文件注册；不把 A 的 94 或旧 800 与新编号相加充当执行结果。

## 未修改声明

- 只新增 B 段测试与 B 报告（A 段已单独提交）；未修改 `src/`、`server/`、已有测试、脚本、SPEC、主计划／交接、package／锁文件、语言包、资源或冻结 fixture。
- 未提交日志、构建产物、真实存档／房间或凭据；未推送、未合并 main。

## 维护者审查追加（2026-10-17）

原 P11 失败报告属实，责任是维护者任务书误设资金前提；未要求外包改金币。维护者纠正为真实资金不足 INVALID_REROLL，并加强拒绝前阶段快照；修订后的 B 44 项已含于独立 A＋B 80/80。资金足够的真实 reroll 仍未覆盖，修订版完整回归待执行，旧 880／879／1 保留。本段实际父提交为 A 的 1f789f1a，总任务起点 a12f4098 不等于本段父提交。详见 [分段审查](MVP-QA-02-review-2026-10-17.md)。
