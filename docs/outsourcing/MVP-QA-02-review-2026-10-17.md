# MVP-QA-02 分段验收与维护者修订

日期：2026-10-17；主维护 agent。**A 通过独立验收；B 经维护者修订定向通过，修订版完整回归待执行；C 资料部分接收、定点退修。** 未合并 main、未推送，不宣告 MVP 或完整 M3 验收通过。

## Git、原报告与日志

- 起点 `a12f409808c6f18c14e30ee6c50d7af528d95715`；A `1f789f1a2fb8276150f8053bc570cad686e79906`，B `84a23fca429edb142add0aa6461e88e22229b3fd`，C `abeb6e430940121e8c54fd666477171d632caf10`，链条一致。
- 接手分支 `outsourcing/mvp-qa-02-batch` 干净；相对起点仅六个约定新增文件、1082 行；逐段均为各自两个文件，无生产／脚本／依赖／旧测试／fixture 变更，空白检查通过。
- B 的执行时 HEAD 为 A 提交，其未提交测试 blob `81d8ea40ea2d64f07115126d44cf6eea09342fa1` 与交付一致；A 测试 blob `32072270a5592325efc7f8750ddaf3b49965279c` 亦一致。此处按实际文件版本核对，未把当时 HEAD 当成已含 B 的提交。
- 实际 TAP 按 BOM 解码，确认 A 定向 94/94、退出 0（38298.3867ms），B 定向 101／100／1、退出 1（55069.8601ms），完整 880／879／1、退出 1（917454.0479ms）。均有正常 `1..N`，cancelled／skipped／todo 为 0。唯一失败为报告所述 P11；报告如实保留失败，处理符合任务要求。
- 日志 `build/qa-mvp-02-a.tap`、`build/qa-mvp-02/target-b.tap`、`full.tap` 及退出码／执行元数据均 ignored，不提交。
- 实际本地 main：`51de6356df27a32c91f083ee0f4c1d161cde6602`；只读实时远端 main：`5614776777eb820972c60a73d8986abb4f57836e`。普通沙箱 DNS 失败后经宿主只读核对；未改变远端。维护者新建 `review/mvp-qa-02-acceptance`，保留全部交付分支。

## A：接收

已审查 36 项：真实 Worker、发送／返回副本、原串行队列、拒绝后继续、未决关闭和另一宿主独立控制均有有效断言；H36 的 10 秒仅防永久悬挂，没有靠时间制造竞争。未引入测试宿主到生产，使用现有 bundle／host 和原类构造。没有复制规则或模拟 Worker。

维护者独立执行 A＋修订后的 B 两个文件：**80/80、退出 0**，正常 `1..80`、无取消／跳过／todo，29056.7138ms。日志 `build/qa-mvp-02-review/target.tap`、退出码 `target-exit.txt`，不与原完整回归拼成一次通过。

另经真实 Worker 复核 8 组额外拒绝：timeout=-Infinity、boolean trainerId、嵌套函数消息不可复制、native-validate 的 seat=-1／true／false、整备 wrapper 多字段、在 wait-actions 调换人；具体错误码、原输入／state 与后续合法控制均通过。这些是独立临时断言，不冒充登记测试数量。

## B：P11 是任务书前提错误，非本轮产品缺陷

维护者编写任务书时误设了“该真实初始整备菜单金币足够”的前提。原 `BattleScene.initializeRunResources()` 明确从 0 金币开始，当前声明普通分支的菜单为 money=0、rerollCost=250。`safe-decisions.mjs` 先做资金检查，返回 `INVALID_REROLL`，然后才可能到 `preparation-runner.mjs` 的效果可用性检查。外包没有义务篡改金币来满足错误前提。

维护者只改 `tests/battle-core-native-interactions-qa.test.mjs`：

1. P11 改为验证真实菜单无法负担重抽，具体拒绝 `INVALID_REROLL`；沿用共同拒绝辅助函数，核对 checkpoint／payload／bootstrap state 不变和后续合法 skip 与控制全等。
2. 修正共同辅助函数的部分 `stageSnapshot: () => clone(stage)` 是调用后重新克隆的无效自比较：在 RPC 前独立保存阶段快照，拒绝后与之比较。保留原固定控制比对。
3. 不改生产代码、原公式、金币、checkpoint 或阶段；不删除／skip 测试。P12 继续覆盖真实免费奖励到 `PREPARATION_EFFECT_UNAVAILABLE` 的效果守门。

**资金足够的真实 reroll 到达效果守门仍未覆盖**；不得把 P11 改名后声称旧覆盖目标已经完成。修订后的 B 44/44 已包含在维护者实际 80/80 中；修订版尚未运行完整串行回归，B 整体条件接收、禁止宣称完整放行。类型检查／构建本轮未重跑，生产代码与依赖未变。

## C：有价值资料保留，以下定点退修

U01–U24、12 份未来脚本和 8 风险条目均存在，未伪称浏览器已执行；原调用链大量定位可用。复核发现：

| 编号／位置 | 当前问题 | 原文证据／要求 |
| --- | --- | --- |
| U16 | `MODE_SELECT` 名称错误；“handler 的 5 参数形状”混淆 mode 与 args | `src/phases.ts:3589` 为 `Mode.MODIFIER_SELECT`；`src/ui/modifier-select-ui-handler.ts:72` 要求四个 args，mode 不在 args 内 |
| U19 | 写成 reroll／reward／buy／transfer 通过“结构校验”后统一到效果拒绝，遗漏资金／归属／候选等先验 | `safe-decisions.mjs:83–106` 先做对应语义检查，P11 即实际反例；区分非法输入与合法但未绑定的效果 |
| B03 未来脚本 | “turnCommands 未变”混淆原本地临时命令与权威输入 | `target-command.mjs:5–10` 取消会清除该席临时 command 并重排 CommandPhase；完整联机意图尚未提交时不应改服务器输入或消费 PP |
| B05／U18 | 使用 `inputId` 作为正式去重字段 | `coop-contract.mjs:45` 正式字段为 `actionId`；不要编造另一 wire 字段 |
| U22 | 建议把消息等待直接变成服务器 decision，容易扩展为未确认的协议设计 | `MessagePhase` 展示回调与规则推进需分开；此文只做复用定位，不决定每条消息是否新增服务端决策 |
| U02／U04／U08／U11 等 | 若干条未按任务要求显式列出调用去向、读写模型、RPC 和依赖；部分“未确认”其实已有 native 实现可查 | 补齐每条同一组字段；缺桥写当前无，已实现的 checkpoint／队列语义给实际来源，不把正式绑定缺失当规则未定 |
| C 交付元数据 | 只列总起点 a12f4098，未列自身父提交 | 保留代码引用基线，同时补本段实际父提交 B 的 84a23fca；B 报告同理应区分总起点与父提交 A |

修订须继续逐字核对来源，不按本表推断未读过的调用关系。C 状态为**部分接收、待修订**；不修改其原交付文档掩盖历史。下一任务提供明确修订清单，维护者复核后才将资料标成已验收。

## 本轮停点与下一批

旧完整 880／879／1 失败历史保留；当前仅修订定向 80/80 通过。下一外包批先做 C 的资料修订，再补正式 `createSnapshotConsumer` 模型应用／授予／ACK 的确定性故障测试，最终执行一次包含维护者修订与新增测试的完整串行回归，以真实统计关闭回归待验。主维护者继续负责生产 adapter／私有投影／持久意图与新 Worker WS 接线，再原 UI；不以连续扩充测试替代核心接入。

M3 仍部分完成，正式 WS 默认 `ADAPTER_UNAVAILABLE`。完整生产 RNG、资金足够的真实 reroll、M6、双浏览器及跨设备仍是未验收项；券和同时全倒下规则不自行决定。合入 SHA：未合入；推送：未推送。

## 维护者后续验收（2026-10-18）

上方完整回归待验与 C 退修为当时状态。后续 953d2922／3fd1368b 已验收：C 资料修订接收，实际完整 912/912、退出 0 和 P11 修订 blob 已核对，修订版回归待验关闭。资金足够的真实 reroll 仍未覆盖。见 [最终验收](MVP-QA-03-acceptance-2026-10-18.md)。未合入 main／未推送。
