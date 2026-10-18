# MVP-QA-01 独立审查与维护者阻断修订

- 日期：2026-10-17；主维护 agent 审查。
- 交付：`9665dfb851ee54745df7201f2bec5b14da1cf6c6`。
- 基线：`287a96eb382a117614611ff7a1f2284541aff408`。
- 接手分支 `outsourcing/mvp-qa-01-runtime-guards` 干净；交付范围确为两个新增文件，测试 208 行、说明 158 行，共 366 行。
- 维护者在 `review/mvp-qa-01-encounter-port` 保存本次修订和记录，不改原交付分支、不合并 main、不推送。

## 外包实现审查

42 个拒绝场景和 R01–R04 控制均有独立编号，使用完整 Node bundle 的真实 `createOriginalRuleHost`。输入与 checkpoint 均由原入口生成，没有手填阶段或模拟规则。拒绝场景核对具体错误码、引导 state、原 payload／保存点和后续合法 validate；R02 额外确认真实 FIGHT 命令、未开始的 EnemyCommand 队列和两个原 Command 事件。Worker 有明确关闭流程，没有改动生产代码或既有测试。

这满足新增矩阵的实现范围。引导 state 不等于房间已提交状态，矩阵不替代生产 WS／落盘／私有投影验收。

## 独立复验与原报告核对

| 项目 | 结果 |
| --- | --- |
| 原交付 `full.tap` 与退出码 | 按文件 BOM 读取，确认正常 `1..795`，795／794／1，cancelled／skipped／todo 0，唯一失败就是报告所述冻结守门测试；exit-code 为 1 |
| `node --test --test-concurrency=1 tests/battle-core-native-runtime-guards.test.mjs` | 退出 0，46/46，约 9.7 秒 |
| 额外真实 Worker 临时断言 | 退出 0；8 组新值拒绝及状态／后续合法控制通过 |
| 修订前 `tests/battle-core-next-battle.test.mjs` | 退出 1，17／16／1，稳定复现原阻断 |
| 修订后同文件 | 退出 0，22/22，约 18.7 秒 |

额外值包括第二席 species 0／null、蛋负 timestamp／未知 gachaType、boolean seat、字符串 target、第 3 席额外命令及 `01` 额外键；错误码、宿主流、输入和合法控制均符合既有契约。未把全部断言数量加成一次全回归。

原完整日志是 UTF-16LE，使用 BOM 识别解码核对；这不是测试失败原因。后续读报告应正确处理编码，不因错误读取日志而改写测试。

## 阻断原因与维护者修订

原 `EncounterPhase.start` 已按生产候选 IO 适配增加两行 defer 端口，但旧源码守门仅登记 Promise 观察／return 链，未登记该适配，因此逐字比较报错。外包方没有删测或放宽规则，报告有效。

本次仅修改 `tests/battle-core-next-battle.test.mjs`，不改 `src/`、`server/` 或冻结 fixture：

1. 守门只精确识别现有两行端口，要求恰好一次且位于原 `!loaded` 保存分支的固定位置。
2. 仅移除这一个明示 IO 片段后，继续逐字比较冻结 Encounter 规则及原场景方法；没有泛化删除源码或更新冻结原文来掩盖差异。
3. 严格核对原 BattleScene 的默认端口仍返回 null，保留单人原保存路径。
4. 增加五项执行验证：无端口／null 返回时 system→session 原顺序；待提交 Promise 完成前不进场；拒绝／同步抛错时不进场、不调用原保存、原候选不变且可重试。完成候选与原正常执行的完整模型和事件一致。

## 当前结论与下一步

**外包范围、46 项矩阵和阻断报告通过独立审查；维护者修订的定向验证通过。整体完整回归尚未放行。** 原 794/795 失败事实必须保留；不能将修订后 22 项与另跑的 46 项相加，宣称完整套件通过。

下一步交给外包执行 MVP-QA-01R 修订版完整复验。本轮只需追加原交付报告，不改测试或生产代码。完整复验通过后由维护者再次核对，再决定合入；main 仍 `51de6356`，没有生产 adapter／原 UI／双浏览器验收进展。

## QA-01R 后续结论（覆盖上方复验前状态）

7c2e0f4d 已按 fc2f59f0 基线完成复验并由维护者核对，实际定向 68/68、完整 800/800、退出 0，见 [最终验收](MVP-QA-01R-acceptance-2026-10-17.md)。上方“尚未放行”是当时历史，当前回归阻断已关闭；仍未合入 main／未推送，生产 adapter／原 UI／跨设备仍未验收。
