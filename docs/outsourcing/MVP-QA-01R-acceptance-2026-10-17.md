# MVP-QA-01R 维护者验收

日期：2026-10-17；审核人：主维护 agent。结论：**QA-01／R 回归工作包验收通过，原回归阻断关闭。** 本轮止于验收与文档更新，未继续开发功能。

## Git 与交付范围

- 交付：`7c2e0f4dd11be5bc4588b8bb4124f5611c5aa521`；分支 `outsourcing/mvp-qa-01r-recheck`。
- 基线：`fc2f59f0ab853da23df85e0c5f8ac5f71f5ad4d6`，包含 QA-01 的 `9665dfb8` 与维护者精确端口守门修订。
- 接手工作区干净；`git diff --name-status fc2f59f0...7c2e0f4d` 只有 `docs/outsourcing/MVP-QA-01-delivery.md`，追加 38 行，无删除；`git diff --check` 通过。
- 相对原 QA-01，`src/`、`server/`、`scripts/`、`package.json`、`package-lock.json`、`tests/fixtures/` 无变化。相对复验基线，测试及其余非报告内容亦完全相同。
- 本地 main：`51de6356df27a32c91f083ee0f4c1d161cde6602`；实时只读 `ls-remote origin refs/heads/main`：`5614776777eb820972c60a73d8986abb4f57836e`，与本地远端跟踪引用一致。普通沙箱 DNS 失败后，通过宿主只读网络执行核对；未推送或变更远端。
- 维护者在新分支 `review/mvp-qa-01r-acceptance` 保存本次文档；不移动外包交付分支、原评审分支或 main。合入 SHA：**未合入**。

## 实际日志复核

本轮维护者独立读取 ignored 的原始 TAP 和退出码文件，按 BOM 解码 UTF-16LE，断言统计、顶层 `ok` 条数、计划收尾、无 `not ok`，并逐项查找 A01–A16、V01–V17、S01–S09、R01–R04、精确源码守门与五项端口行为测试。结果全部一致：

| 外包实际执行 | tests / pass / fail | cancelled / skipped / todo | 收尾／退出码 | 时长 |
| --- | --- | --- | --- | --- |
| next-battle＋native-runtime-guards 定向 | 68 / 68 / 0 | 0 / 0 / 0 | `1..68`，0 | 30571.5874ms |
| 任务书规定的完整串行回归 | 800 / 800 / 0 | 0 / 0 / 0 | `1..800`，0 | 885369.9694ms |

原执行命令与环境 Node.js v24.15.0 见 [交付记录](MVP-QA-01-delivery.md#qa-01r-修订版完整复验2026-10-17)。完整命令包括 battle-core、coop、local-save、localization 及 outsourcing-locale-placeholders 文件，并未删掉 WS 或 A／B1 测试。

日志与退出码均受 Git ignore 保护，不提交；本次核对的日志 SHA-256 供本机后续比对：

- `build/qa-mvp-01r/target.tap`：`afc9f10ceb098e6f1f3593741eae4eebcc7c1a2685efc4b3523bc10a9f120610`。
- `build/qa-mvp-01r/full.tap`：`239344a975d250e3b3371f544c951dbc4c5eb867c76a90e17c4f1c4901c1b2fe`。
- `target-exit.txt`、`full-exit.txt`：均为 0。

本轮没有再次执行这两轮测试，也未重复 typecheck／build；不能把日志复核写成维护者重跑。源码未变，沿用 QA-01 同生产代码的类型／构建证据符合复验任务书。结合 [前轮独立审查](MVP-QA-01-review-2026-10-17.md) 已实跑的矩阵 46/46、额外 8 组 Worker 输入及修订后 next-battle 22/22，本次接受修订版本完整回归证据。

## 复用、适配和结论边界

继续复用现有 `createOriginalRuleHost`、完整原类 Worker、原入口生成的检查点、既有串行回归及 TAP 报告；本轮不改规则、适配器或冻结原文，不新增测试框架或替代引擎。前轮只为已存在的 `deferEncounterPersistence` 固定两行／位置登记守门，并补等待、回退与失败行为验证；其余冻结规则仍逐字比较。

原 QA-01 的 795／794／1、退出 1 是当时真实结果，保留不改写。本次接受的是 fc2f59f0 修订内容及 7c2e0f4d 报告对应的 800/800 回归，不能转述为旧提交当时已通过。

M3 仍部分完成，正式 `/coop/v1/ws` 默认 `ADAPTER_UNAVAILABLE`。本次未验收生产 adapter、生产私有投影／持久意图、新 Worker 双端 WS 故障矩阵、原 UI、双浏览器／跨设备、完整 RNG 或 M6 永久收藏事务；现有 WS 测试通过不能替代新 Worker 的正式接入验收。

下一批由主维护者处理已验收评审链的集成，再接现有普通闭环的生产 adapter／持久意图／私有投影，并验证双端重启、输入去重、写盘失败和房间隔离；通过后接 M4／M5 原 UI，尽早实现双浏览器连续游玩。本轮外包任务结束，语言工具 B2／B3 暂缓，不继续扩大无关测试范围。main 合入与推送另按负责人授权执行。
