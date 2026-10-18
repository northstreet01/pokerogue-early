# MVP-UI-01 交付说明：原 UI 复用清单

## 任务与状态

- 任务：MVP-UI-01（MVP-QA-02 的 C 段），只新增原 UI 接入复用资料与交付记录。
- 状态：**C 段资料已完成，待维护者验收**。仅文档，不改产品代码、不接 UI、不执行浏览器脚本。
- 本段不表示原 UI 已接入、生产 adapter 已完成或 MVP 上线通过。

## 基线与文件

- 基线完整 SHA：`a12f409808c6f18c14e30ee6c50d7af528d95715`
- 工作分支：`outsourcing/mvp-qa-02-batch`
- 运行环境：Node.js v24.15.0；未安装依赖，未启动正式服务，未读取真实存档。
- 本段新增文件（仅两个）：

```text
docs/outsourcing/MVP-UI-01-reuse-inventory.md
docs/outsourcing/MVP-UI-01-delivery.md
```

- 提交 SHA：见交付消息（本文件随提交一起提交，无法写入自身哈希）。

## 读过的文件与核对方式

- 已读：`src/ui/ui.ts`、`command-ui-handler.ts`、`fight-ui-handler.ts`、`target-select-ui-handler.ts`、`party-ui-handler.ts`、`modifier-select-ui-handler.ts`、`battle-info.ts`、`message-ui-handler.ts`、`battle-message-ui-handler.ts`、`src/phases.ts`、`src/battle-core/coop-client.mjs`、`src/coop/client.mjs`、`src/coop/snapshot-sync.mjs`、`src/battle-core/preparation-runner.mjs`、`src/battle-core/switch-command.mjs`。
- 方法名与行号按上述基线的实际代码核对；每一条区分**观察事实／建议／未确认**，没有直接桥接的写“当前无”或“未确认”，未编造完成状态。
- 没有把旧实验 `src/coop/client.mjs` 当作正式原 UI；U23／U24 明确列出正式 consumer 与实验链路的差异。

## 清单完成情况

- U01–U24：24 条全部给出编号、文件＋行号＋类／方法、调用链、读写模型、decision／RPC、Phaser／GameData／存储依赖、复用建议与未接缺口。
- 12 个双浏览器手工验收脚本：全部列出前提、两端操作、模型／UI 预期与检查方法；全部标注“未来脚本，本轮未执行”，并明示生产桥缺失前提。
- 8 项集成风险：currentPhase／standby、fieldIndex、个人 party 与共享 field、target 重算、菜单 start 重入、动画结束重复推进、epoch／revision、GameData／永久授予；每条给真实引用与建议。
- 资料总量约 200 行，重事实与调用点，未用重复长段落充数。

## 实际执行与结果

- 本段仅文档，按任务书不单独重跑构建或测试；A／B 段的定向与完整回归结果记录在各自交付说明与 `build/qa-mvp-02/` 日志中。
- 未执行浏览器、未启动游戏服务、未创建房间、未做跨设备验证；因此不声称原 UI 或双浏览器验收通过。

## 已知限制

- 行号随代码变动，接入前需按当时 HEAD 复核。
- 部分桥接点（强制动作投影、cancel 动作、双打 fieldIndex 压缩、私有投影是否含完整 moveset）标为未确认，需主维护者在正式 adapter 设计中决定。
- 实验 client／snapshot-sync 只作为可借鉴结构，不能直接移植其状态模型、授予路径或版本校验。

## 未修改声明

- 只新增上述两个文档；未修改 `src/`、`server/`、已有测试、脚本、SPEC、主计划／交接、package／锁文件、语言包、资源或冻结 fixture。
- 未提交日志、构建产物、真实存档／房间或凭据；未推送、未合并 main。
- 未挂生产 adapter，未实现私有投影、存档、协议或 UI。

## 维护者审查追加（2026-10-17）

资料条目和未执行浏览器声明已审查，部分接收、定点退修：菜单 mode／handler 参数数、目标取消的本地命令语义、actionId、先验校验层次及逐条元数据。实际本段父提交为 B 的 84a23fca，a12f4098 是原代码引用起点。尚未整体验收，不把资料当 UI 已实现。详见 [分段审查](MVP-QA-02-review-2026-10-17.md)。

## UI-01R 修订追加（2026-10-17）

### 基线与父提交

- 本次修订代码基线／父提交：`845c64deff334e6b9b03313b2f7c892983b79595`；工作分支 `outsourcing/mvp-ui-01r-consumer-qa`。
- 原 C 资料代码引用起点为 `a12f4098`；原 C 交付的实际父提交是 `84a23fca429edb142add0aa6461e88e22229b3fd`。本段不改写原交付事实，只追加修订记录。
- 运行环境：Node.js v24.15.0；仅文档修订，未运行浏览器、未启动服务、未读真实存档。

### 逐项修订

- U16：原写“handler 5 参数形状”有误。`src/phases.ts:3589` 的 `ui.setMode(Mode.MODIFIER_SELECT, isPlayer(), typeOptions, modifierSelectCallback, getRerollCost())` 共五个实参，但 mode 不属于 handler args；`src/ui/modifier-select-ui-handler.ts:72` 要求**四个 args**（player、typeOptions、callback、rerollCost）。已按四参数改写，并在 U17 同步。
- U19：原写“reroll／reward／buy／transfer 统一 `PREPARATION_EFFECT_UNAVAILABLE`”不准确。已按 `src/battle-core/safe-decisions.mjs:87-98` 与 `preparation-runner.mjs:47-51` 分层：资金不足先 `INVALID_REROLL`、optionId 未知 `INVALID_PREPARATION_OPTION`、越权 `INVALID_PREPARATION_OWNER`、moveIndex 非法 `INVALID_ACTION`；全部先验通过后才到 `PREPARATION_EFFECT_UNAVAILABLE`。结合 P11（money=0、rerollCost=250 → `INVALID_REROLL`）与 P12（reward 先验通过、效果 hook 未接 → `PREPARATION_EFFECT_UNAVAILABLE`）说明。
- B03：原“turnCommands 未变”要求不成立。`src/battle-core/target-command.mjs:5-10` 的取消分支会把 `commands[fieldIndex]=null` 并 `requeueCommand`；这是原本地临时命令语义。已改为：取消会清空该席临时 turnCommand 并重排 CommandPhase；在尚未向服务器提交完整意图时，服务器 inputs／PP 不变；不再要求本地临时 command 完全未变。
- B05／U18：原写 `inputId` 属发明字段。正式 `submitAction` 使用 `actionId`（`src/battle-core/coop-contract.mjs:45`），服务端 receipt key 为 `${seat}:${actionId}`（`server/formal-coop-service.mjs:196`）。已统一为 `actionId`，并声明 UI 防重入 flag 不能替代持久去重。
- U22：原建议预设“每条消息新增服务器 decision”。已改为：照实定位 MessagePhase 文本／prompt／end 回调；说明“展示完成”与“权威规则推进”的隔离需求；是否把确认等待映射为服务器停点属于协议变更，由主维护者决定，本文不预判。
- U02／U04／U08／U11／U12–U15／U17／U18／U20／U21／U24：补齐调用链、读／写模型、decision／RPC、Phaser／GameData／存储依赖；对已有 native 实现给出来源（如 wait-target `target-command.mjs:13-30`、switch-confirm `switch-command.mjs:38-49`、preparation `preparation-runner.mjs`），并区分“现有规则已接”与“正式 UI adapter 未接（当前无正式桥接）”。
- U01／U03／U05／U06／U07／U09／U10／U16／U19／U22／U23：保留原有事实，补充纯显示写入与规则写入的区分，以及未确认项。
- 12 个脚本与 8 项风险：保留全部编号与“未来脚本，本轮未执行”声明；B03／B05 已按上述语义修正；风险项未改写为已验证，不把模拟 ACK 或脚本计划写成双浏览器通过。

### 核对来源与缺口

- 复核文件：`src/ui/ui.ts`、`command-ui-handler.ts`、`fight-ui-handler.ts`、`target-select-ui-handler.ts`、`party-ui-handler.ts`、`modifier-select-ui-handler.ts`、`battle-info.ts`、`message-ui-handler.ts`、`battle-message-ui-handler.ts`、`src/phases.ts`、`src/battle-core/coop-client.mjs`、`src/coop/client.mjs`、`src/coop/snapshot-sync.mjs`、`preparation-runner.mjs`、`safe-decisions.mjs`、`target-command.mjs`、`switch-command.mjs`、`coop-contract.mjs`、`server/formal-coop-service.mjs`。
- 仍未接的正式桥：正式 UI adapter、私有投影、强制动作投影、cancel action、reward／buy／reroll／transfer 的原效果 hook、message 等待与服务器停点的映射；均在条目中标“当前无正式桥接”或“未确认”。
- 本段仅文档修订；未改 `src/`、`server/`、旧测试、脚本、SPEC、主计划／交接、package／锁文件、语言包、资源或 fixture。未执行 `git diff --check` 之外的构建／测试；资料尚未验收。

## 维护者后续验收（2026-10-18）

UI-01R 的 953d2922 已接收：24 条调用资料、12 未来脚本、8 风险保留，mode／四 args、语义先验、临时 command、actionId、MessagePhase 与父提交均修订。仅资料验收，未执行浏览器或实现 UI。见 [最终验收](MVP-QA-03-acceptance-2026-10-18.md)。未合入 main／未推送。
