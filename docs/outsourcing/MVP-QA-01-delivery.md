# MVP-QA-01 交付说明：原运行器黑盒边界矩阵与完整串行回归

## 任务与状态

- 任务：MVP-QA-01，只新增黑盒守卫矩阵与完整回归证据；未改生产代码、未挂正式 adapter。
- 状态：**自测与完整串行回归均已执行；完整回归 795 项中 794 通过、1 项既有失败（退出码 1），存在阻断，不能据此合入或放行。** 维护者已独立确认新增矩阵与阻断报告，修订后完整复验待 QA-01R，见 [审查记录](MVP-QA-01-review-2026-10-17.md)。
- 本工作不等于生产 WS、原 UI 或 MVP 上线验收；受控普通分支证据不能描述成完整机制或正式双端游玩完成。

## 基线与变更

- 基线完整 SHA：`287a96eb382a117614611ff7a1f2284541aff408`（已含 OUT-02A、OUT-02B1 与本任务书）。
- 工作分支：`outsourcing/mvp-qa-01-runtime-guards`
- 运行环境：Node.js v24.15.0，npm 11.12.1。
- 实际变更文件（仅两个，均为新增）：

```text
tests/battle-core-native-runtime-guards.test.mjs
docs/outsourcing/MVP-QA-01-delivery.md
```

- 实现提交完整 SHA：见交付消息（本文件随实现提交一起提交，无法写入自身哈希）。

## 真实入口与夹具

- 使用 `buildCoopRuntime` 在 `before` 中构建一次 Node bundle，通过 `createOriginalRuleHost` 启动真实 Worker；全部测试结束后 `await close`。未用手工 HP、队列、敌方或 decision 伪装已进入战斗。
- 固定夹具：`seed: 'mvp-native-entry'`、`identity: { trainerId: 1, secretId: 2 }`、`parties: [[1, 4, 7], [906, 909, 912]]`、`eggState: { players: [[], []] }`。这是假身份与固定测试夹具，不是产品目录限制。
- 通过 `native-open-to-input` 生成真实 checkpoint，并断言 `decision.kind === 'wait-actions'`、波次 1、双打、两席都有行动；两席动作从 `checkpoint.decision.options[seat]` 中选择 `Number.isInteger(action.target) && action.target >= 2` 的 FIGHT 选项，且断言其存在。
- 每个负例使用独立复制的 payload，并同时断言：指定错误码、宿主 `request('state')` 前后相同、调用方 payload 与 checkpoint 未被修改、随后合法 `native-validate` 仍等于正常控制值。`state` 只是宿主引导随机／池状态，不代表已实现房间落盘回滚。
- A／V／S 共用一个真实 Worker；R01–R04 各自使用独立 Worker；R03 会真实关闭旧 Worker 后重启。没有启用并发测试。

## 覆盖矩阵与结果

### 矩阵一：`native-open-to-input` 16 项（16/16 通过）

| ID | 输入／变更 | 期望 `error.code` | 实际结果 |
| --- | --- | --- | --- |
| A01 | payload 为 null | INVALID_NATIVE_PARTIES | 通过 |
| A02 | payload 为 `{}` | INVALID_NATIVE_PARTIES | 通过 |
| A03 | parties 为空数组 | INVALID_NATIVE_PARTIES | 通过 |
| A04 | parties 只有一席 | INVALID_NATIVE_PARTIES | 通过 |
| A05 | parties 有三席 | INVALID_NATIVE_PARTIES | 通过 |
| A06 | 第零席只有两个 species ID | INVALID_NATIVE_PARTIES | 通过 |
| A07 | 第一席有四个 species ID | INVALID_NATIVE_PARTIES | 通过 |
| A08 | 第零席为普通对象而非数组 | INVALID_NATIVE_PARTIES | 通过 |
| A09 | 正常 payload 增加未知顶层字段 | INVALID_NATIVE_PARTIES | 通过 |
| A10 | 一个 species ID 改为 -1 | INVALID_POKEMON_SELECTION | 通过 |
| A11 | 一个 species ID 改为 999999 | INVALID_POKEMON_SELECTION | 通过 |
| A12 | 一个 species ID 改为字符串 `'1'` | INVALID_POKEMON_SELECTION | 通过 |
| A13 | 一个 species ID 改为 1.5 | INVALID_POKEMON_SELECTION | 通过 |
| A14 | eggState.players 只有一个数组 | INVALID_EGG_STATE | 通过 |
| A15 | 蛋缺 timestamp | INVALID_EGG_STATE | 通过 |
| A16 | eggState 内增加未知字段 | INVALID_EGG_STATE | 通过 |

### 矩阵二：`native-validate` 17 项（17/17 通过）

| ID | 输入／变更 | 期望 `error.code` | 实际结果 |
| --- | --- | --- | --- |
| V01 | wrapper 为 null | INVALID_NATIVE_ACTION | 通过 |
| V02 | wrapper 增加未知字段 | INVALID_NATIVE_ACTION | 通过 |
| V03 | seat 为 -1 | INVALID_ACTION | 通过 |
| V04 | seat 为 2 | INVALID_ACTION | 通过 |
| V05 | seat 为字符串 `'0'` | INVALID_ACTION | 通过 |
| V06 | action 删除 kind | INVALID_ACTION | 通过 |
| V07 | action 增加 `args: []` | INVALID_ACTION | 通过 |
| V08 | pokemonId 改为另一席上场 ID | INVALID_ACTION | 通过 |
| V09 | pokemonId 改为本席 index=1 后备 ID | INVALID_ACTION | 通过 |
| V10 | pokemonId 改为真实敌方 ID | INVALID_ACTION | 通过 |
| V11 | cursor 改为 -1 | INVALID_ACTION | 通过 |
| V12 | cursor 改为 9999 | INVALID_ACTION | 通过 |
| V13 | target 改为 99 | INVALID_ACTION | 通过 |
| V14 | kind 改为 `'capture'` | INVALID_ACTION | 通过 |
| V15 | cursor 改为 0.5 | INVALID_ACTION | 通过 |
| V16 | pokemonId 改为 null | INVALID_ACTION | 通过 |
| V17 | action 整体为 null | INVALID_ACTION | 通过 |

真实 ID 均来自生成的 checkpoint：另一席 ID 取 `roster.field[1]`，本席后备 ID 取 `roster.entries` 中 `owner=0,index=1`，敌方 ID 取 `battle.enemyParty[0]`，没有写死运行时 ID。

### 矩阵三：`native-submit` 9 项（9/9 通过）

| ID | 输入／变更 | 期望 `error.code` | 实际结果 |
| --- | --- | --- | --- |
| S01 | inputs 只有第零席 | INCOMPLETE_COMMAND_INPUTS | 通过 |
| S02 | inputs 为 `{}` | INCOMPLETE_COMMAND_INPUTS | 通过 |
| S03 | inputs 另加第 2 席，原两席保留 | INCOMPLETE_COMMAND_INPUTS | 通过 |
| S04 | inputs 为含两个 action 的数组 | INCOMPLETE_COMMAND_INPUTS | 通过 |
| S05 | 将两席 action 交换 | INVALID_ACTION | 通过 |
| S06 | 第零席 kind 改为 `'capture'` | UNSUPPORTED_COMMAND_INPUT | 通过 |
| S07 | wrapper 增加未知字段 | INVALID_NATIVE_ACTION | 通过 |
| S08 | inputs 为 null | INCOMPLETE_COMMAND_INPUTS | 通过 |
| S09 | inputs 为字符串 | INCOMPLETE_COMMAND_INPUTS | 通过 |

### 正常控制与恢复 4 组（4/4 通过）

| ID | 实际断言 |
| --- | --- |
| R01 | 按 0→1、1→0 各两轮合法 validate；两席结果分别稳定等于控制值；checkpoint 与宿主 state 不变 |
| R02 | 相同 checkpoint 与双方 inputs 连续两次 submit 完整结果一致并等于控制值；`restoreTurnCommands` 解码两席 command 均为 FIGHT=0；队列前端为未执行 EnemyCommandPhase；确有两条原 CommandPhase 事件；intents 为空；宿主 state 不变 |
| R03 | checkpoint 经 JSON 往返、关闭旧 Worker、按同一 config 重启后提交，checkpoint／events／intents 与 R02 控制值完整一致；队列前端仍为 EnemyCommandPhase；所有 Worker 均关闭 |
| R04 | 两个独立 Worker；A 执行负例和合法 validate／submit 期间 B 的引导 state 不变；B 用同一真实保存点提交结果与控制值一致；checkpoint 不被修改 |

## 实际执行与结果

| 阶段 | 命令 | 退出码 | 实际结果 |
| --- | --- | --- | --- |
| 已有定向基线 | `node --test --test-concurrency=1 tests/battle-core-native-runtime.test.mjs tests/battle-core-runtime-bootstrap.test.mjs tests/battle-core-phase-state.test.mjs` | 0 | tests 32，pass 32，fail 0，skipped 0（47.688s） |
| 新增矩阵 | `node --test --test-concurrency=1 tests/battle-core-native-runtime-guards.test.mjs` | 0 | tests 46，pass 46，fail 0，skipped 0（9.941s） |
| 类型检查 | `npm run typecheck` | 0 | 无错误输出（未单独计时） |
| 生产构建 | `npm run build` | 0 | `built in 1m 32s`；既有 chunk／混合导入警告 |
| 完整串行回归 | `node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs` | 1 | tests 795，pass 794，fail 1，cancelled 0，skipped 0，todo 0（885874.5696ms，约 14m46s） |

- 完整日志：`build/qa-mvp-01/full.tap`（已忽略，不提交）；退出码另存 `build/qa-mvp-01/exit-code.txt`。
- TAP 有正常收尾：`1..795` 与完整 summary；结果不是推算。WS 测试已包含在本轮回归中，未出现连接权限阻断；失败项不是 WS。
- 本轮未出现环境阻断，也未跳过任何测试；`cancelled`／`skipped`／`todo` 均为 0。

## 阻断清单

### 1. 既有失败：原遭遇段冻结源码对照（不属于本轮新增矩阵）

- 测试：`tests/battle-core-next-battle.test.mjs:19` — `original encounter changes consist only of observing and returning the existing Promise chain`。
- 输入：当前 `src/phases.ts` 的 `EncounterPhase.start` 与 `tests/fixtures/early-next-battle-reference.json` 的冻结原文逐字比较。
- 期望：冻结原版 `EncounterPhase.start`，其中 `saveSystem()` 前没有 defer 分支。
- 实际：当前实现多出两行

```ts
const deferred = this.scene.deferEncounterPersistence?.();
if (deferred) return deferred.then(() => this.doEncounter());
```

- 错误：`AssertionError [ERR_ASSERTION]`（非业务错误码），`operator: strictEqual`。
- 单文件复现：

```powershell
node --test --test-concurrency=1 tests/battle-core-next-battle.test.mjs
```

实际退出码 1，tests 17、pass 16、fail 1（约 17s）；与完整回归失败项一致。

- 稳定性：可稳定重现；`51de6356`、`287a96eb` 上均失败，`git log 51de6356..HEAD -- src/phases.ts tests/battle-core-next-battle.test.mjs` 无变更，属既有问题，不是本轮 46 项造成。
- 处理：按任务要求未改生产代码、未改测试或放宽断言；由维护者决定是扩展该守门测试的已知适配规范化，还是把 `deferEncounterPersistence` 移出冻结函数。
- 影响：**完整回归非全绿，存在阻断，不能据此合入或宣称 MVP 回归通过。**

### 2. 其它

- 无其它断言失败；无环境阻断；无未执行项。
- 新增 46 项矩阵在完整回归中全部通过（TAP 中 A01/A16/V01/V17/S01/S09/R01/R04 等编号均可检索）。

## 已知局限

- 只覆盖声明的普通受控分支（固定种子、假身份、两边各三只 5 级精灵、显式空蛋库存）；不代表全精灵、全波次、特殊遭遇、训练家／Boss、非 FIGHT、LevelUp 子决策、捕获或永久收藏已验收。
- 只验证 Worker 引导随机／池状态与输入边界；未验证完整房间 RNG、落盘回滚、房间／WS 故障矩阵、私有投影或生产 adapter。
- 未做原 UI、双浏览器连续游玩或跨设备验收；不把本交付描述成生产 WS、原 UI 或 MVP 上线完成。
- A／V／S 共用一个真实 Worker，但每行都独立检查错误码、state、payload、checkpoint 与后续合法调用；R01–R04 用独立 Worker 覆盖纯度、重试、重启与隔离。

## 未修改声明

- 只新增上述两个文件；未修改现有测试、`src/`、`server/`、脚本、`package.json`、锁文件、语言包、资源、SPEC 或主交接。
- 未提交 `build/qa-mvp-01/` 日志、dist、bundle、node_modules、真实存档／房间或凭据；未推送、未合并 main。
- 未挂生产 adapter，未修改生产规则，未代做 OUT-02B2／B3。

## 维护者审查更新（2026-10-17，QA-01R 前）

原交付 795／794／1 与退出码 1 已从实际 TAP 核对，失败历史保留。新增矩阵独立复跑 46/46，额外 8 组真实 Worker 拒绝／状态控制通过。维护者仅修订原 next-battle 守门的精确候选 IO 白名单与固定位置检查，并增加五项端口行为测试；生产源码、冻结 fixture 均未改。修订后该文件 22/22，通过定向不等于完整回归通过，整体放行仍等待 QA-01R。详见 [维护者审查](MVP-QA-01-review-2026-10-17.md)。未合并 main、未推送。

## QA-01R 修订版完整复验（2026-10-17）

### 基线与范围

- 任务：MVP-QA-01R，只追加本复验记录；未开发新功能。
- 新基线完整 SHA：`fc2f59f0ab853da23df85e0c5f8ac5f71f5ad4d6`（含原交付 `9665dfb8`、维护者审查记录与本任务书）。
- 分支：`outsourcing/mvp-qa-01r-recheck`
- 运行环境：Node.js v24.15.0；本轮未安装依赖、未启动游戏、未挂 adapter。
- 本轮唯一修改文件：`docs/outsourcing/MVP-QA-01-delivery.md`（本追加）；未改测试、脚本、配置、生产源码或冻结 fixture，未新增跟踪文件。
- 与 `9665dfb8` 对比，`src/`、`server/`、`scripts/`、`package*.json`、`tests/fixtures/` 均无变更；变更仅为文档、任务书与 `tests/battle-core-next-battle.test.mjs`（维护者修订）。

### 修订与原阻断的关联

原 QA-01 阻断为 `tests/battle-core-next-battle.test.mjs` 的冻结源码守门未登记 `deferEncounterPersistence` 两行候选 IO 端口。维护者修订只做三件事：精确识别该两行端口并要求恰好一次、位于原 `!loaded` 保存分支的固定位置；仅移除这一个明示片段后继续逐字比较冻结规则；核对 `BattleScene` 默认端口仍返回 null，并增加五项执行验证（无端口／null 时原 system→session 顺序、待提交 Promise 完成前不进场、拒绝／同步抛错不进场且可重试）。生产源码与冻结 fixture 未改。

原交付的 795／794／1 与退出码 1 作为历史事实保留，不改写、不与本轮结果相加或覆盖。

### 本轮命令与实际结果

| 阶段 | 命令 | 退出码 | 实际 TAP 统计 |
| --- | --- | --- | --- |
| 定向复验 | `node --test --test-concurrency=1 --test-reporter=tap tests/battle-core-next-battle.test.mjs tests/battle-core-native-runtime-guards.test.mjs` | 0 | tests 68，pass 68，fail 0，cancelled 0，skipped 0，todo 0；`1..68`；30571.5874ms（约 30.6s） |
| 完整串行回归 | `node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs` | 0 | tests 800，pass 800，fail 0，cancelled 0，skipped 0，todo 0；`1..800`；885369.9694ms（约 14m45s） |

- 定向覆盖：修订后的 next-battle 22 项（原 17 项 + 五项端口行为测试）与 QA-01 守卫矩阵 46 项，共 68 项。
- 完整回归包含修订后的 22 项与既有全部文件；TAP 中已确认 `original encounter preserves frozen rules with tracked Promises and one explicit candidate IO port`、五项端口测试及 A／V／S／R 编号全部 `ok`，无 `not ok`。
- 日志（均被忽略、不提交）：`build/qa-mvp-01r/target.tap`、`build/qa-mvp-01r/full.tap`；退出码记录：`build/qa-mvp-01r/target-exit.txt`、`build/qa-mvp-01r/full-exit.txt`。
- 两个日志均为 UTF-16LE（首字节 `FF FE`），按 BOM 读取；未为解码改动任何产品代码或旧日志。
- 无环境阻断、无跳过、无取消、无未执行项；两轮都有正常 `1..N` 收尾。

### 类型检查与构建

生产源码相对 `9665dfb8` 无变更，本轮按任务书要求未重复 `npm run typecheck` 与 `npm run build`，沿用 QA-01 同生产代码证据；本轮变化仅是测试与文档。

### 结论

**修订版本自测完整回归通过（800/800，退出码 0），等待维护者复核。** 原 795／794／1 失败历史保留；这不代表已合并 main、生产 adapter 完成、原 UI／跨设备验收或 MVP 上线通过。

## 维护者最终复核（2026-10-17）

交付 7c2e0f4d 已通过范围与实际日志独立核对：相对 fc2f59f0 仅本报告追加 38 行；定向 68/68、完整 800/800，退出 0，正常 TAP 收尾且无失败／跳过／取消／todo。结合此前矩阵独立复跑、额外输入与维护者修订行为验证，QA-01／R 回归工作包验收通过。原 795／794／1 历史不改写。本轮维护者未再运行全套／typecheck／build；细节及剩余边界见 [最终验收记录](MVP-QA-01R-acceptance-2026-10-17.md)。未合入 main／未推送，不代表生产 adapter、原 UI、跨设备或 MVP 上线通过。
