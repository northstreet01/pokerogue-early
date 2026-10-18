# MVP-QA-03 交付说明：正式 createSnapshotConsumer 单元故障矩阵

## 任务与状态

- 任务：MVP-QA-03，直接测试 `src/battle-core/coop-client.mjs` 的 `createSnapshotConsumer`，覆盖 32 个 K 编号。
- 状态：**新基线自测与完整回归已通过（912/912，退出码 0），等待维护者验收。** 本段不实现生产 adapter、私有投影、存档、协议或 UI；不表示原 UI／双浏览器／跨设备／M6 已验收。
- 原 QA-02 的 880／879／1 与 P11 旧阻断事实保留为历史，不改写；本批 P11 已由维护者修订（`43473dd3`），本轮未再修改。

## 基线与父提交

- 本段父提交：`953d29220ab59da9066bf73c21935b2a04e5f0c9`（UI-01R）。
- 代码引用基线：`845c64deff334e6b9b03313b2f7c892983b79595`（含 UI-01R 前任务书与 P11 修订）。
- 工作分支：`outsourcing/mvp-ui-01r-consumer-qa`
- 运行环境：Node.js v24.15.0；未安装依赖，未启动游戏或正式 WS。
- 本段新增文件（仅两个）：

```text
tests/coop-snapshot-consumer-qa.test.mjs
docs/outsourcing/MVP-QA-03-delivery.md
```

- 提交 SHA：见交付消息（本文件随提交一起提交，无法写入自身哈希）。

## 复用来源与夹具约定

- 直接 import `createSnapshotConsumer`；未使用实验 `src/coop/snapshot-sync.mjs`，未复制 consumer／哈希实现。
- 只读参考：`src/battle-core/coop-client.mjs`、`coop-contract.mjs`、`server/formal-coop-service.mjs`、`tests/coop-formal.test.mjs`。未 import 其他测试文件。
- 协议夹具：`shared={turn:1}`、`personal={money:0}` 仅为协议计数器，不是 Pokemon 规则、生产投影或 M6；假 ID 固定，无恢复令牌。
- snapshot 字段完整：type、四个 versions、roomId、runId、revision、decisionId、connectionEpoch、seat、shared、personal、sharedHash、personalHash、events、grants。
- hash 由 `node:crypto` SHA-256＋现有 `canonical()` 生成；expected 错误码、ACK 字段／次数／顺序全部硬编码，不由被测输出生成。
- fake adapter 三接口：applySnapshot 保存独立模型；captureAppliedState 返回独立副本；applyGrantsTransaction 更新测试内存 ledger 且正常不改投影；日志记录 hook 起止、capture 次数、事务次数与 send。
- 每个 K 编号独立 consumer／adapter／输出记录；先决条件由真实 consume 完成。并发用 deferred started／release 屏障，不用 sleep／短超时；K26–K31 的总超时仅防悬挂。

## 逐编号结果（32/32 通过）

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| K01–K04 | adapter 为 null 或缺少 applySnapshot／captureAppliedState／applyGrantsTransaction | 4/4 通过（同步 `ADAPTER_UNAVAILABLE`） |
| K05 | rulesVersion 不匹配 | 通过（`VERSION_MISMATCH`，无 hook／send） |
| K06 | snapshot 多未知字段 | 通过（`INVALID_MESSAGE`） |
| K07 | grant.seat 与 snapshot.seat 不同 | 通过（`INVALID_MESSAGE`） |
| K08 | 初始 connectionEpoch 非当前 | 通过（返回 false，无 hook／send） |
| K09 | 成功 revision=2 后给 revision=1 | 通过（返回 false，不应用旧模型、不新增 send） |
| K10 | 成功消费后更换 runId | 通过（`RUN_MISMATCH`，无新 hook／send） |
| K11 | shared 改值不改 hash | 通过（`SNAPSHOT_CORRUPT`，一次 requestSnapshot） |
| K12 | personal 改值不改 hash | 通过（同上） |
| K13 | applySnapshot 抛 `TEST_APPLY_FAILED` | 通过（原错误传播，一次 resync，无 capture／事务／ACK） |
| K14 | 第一次 capture 抛 `TEST_CAPTURE_FAILED` | 通过（原错误传播，一次 resync，无事务／ACK） |
| K15 | 第一次 capture shared 不一致 | 通过（`MODEL_MISMATCH`，一次 resync，无事务／ACK） |
| K16 | 第一次 capture personal 不一致 | 通过（同上） |
| K17 | applyGrantsTransaction 抛 `TEST_STORAGE_FAILED` | 通过（原错误传播，一次 resync，无 ACK） |
| K18 | 第二次 capture 抛 `TEST_FINAL_CAPTURE_FAILED` | 通过（原错误传播，一次 resync，无 ACK） |
| K19 | 事务回调改 applied shared | 通过（`MODEL_MISMATCH`，一次 resync，无 ACK） |
| K20 | 事务回调改 applied personal | 通过（同上） |
| K21 | 正常 snapshot、grants=[] | 通过（apply→capture→事务([])→capture→仅 stateAck） |
| K22 | 正常 snapshot、一条本人 grant | 通过（先复核后 grantAck→stateAck，各一次，字段对应） |
| K23 | 同一成功 snapshot 重复消费 | 通过（再次 apply／事务／ACK；ledger 同 ID 只计一次） |
| K24 | apply 修改收到的 events 副本 | 通过（原 snapshot 不变，模型正确） |
| K25 | 事务修改收到的 grants 副本 | 通过（原 snapshot／grants 不变，grantIds 来自原 snapshot） |
| K26 | 第一条 apply gate，第二条排队 | 通过（第二条不越过第一条；release 后 1→2 顺序完整） |
| K27 | 第一条 apply 失败，第二条已排队 | 通过（第一条 resync，第二条成功 ACK；chain 未被毒化） |
| K28 | apply 期间换 epoch | 通过（返回 false，不再 capture／事务／ACK／resync） |
| K29 | 事务期间换 epoch | 通过（返回 false，不发旧 grantAck／stateAck／resync） |
| K30 | 最后一次 capture 期间换 epoch | 通过（返回 false，不发旧 ACK／resync） |
| K31 | apply 期间换 epoch 且 hook 抛错 | 通过（原错误传播，旧连接不发 resync／ACK） |
| K32 | 两个独立 consumer 交错 | 通过（各自 hook／模型／ledger／send 隔离） |

K11–K20 的 requestSnapshot 均核对完整固定字段：type、roomId、runId、knownRevision、reason=`CLIENT_APPLY_FAILED`；失败后原 snapshot 不变。

## 实际命令、退出码与统计

### 快速单元定向

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/coop-snapshot-consumer-qa.test.mjs
```

- 退出码：**0**
- 实际 TAP：tests 32，pass 32，fail 0，cancelled 0，skipped 0，todo 0，`1..32`，176.9265ms
- 日志：`build/qa-mvp-03/consumer.tap`；退出码 `build/qa-mvp-03/consumer-exit.txt`

### 完整串行回归

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
```

- 执行时 HEAD：`953d29220ab59da9066bf73c21935b2a04e5f0c9`（UI-01R 提交；QA-03 两个文件尚未提交）
- 新增 consumer 测试 blob：`2d38464996f0266d48caeeab7e88c300f5d525a3`
- 基线 P11 修订测试 blob：`44f9c3e0d1c81c9dc9a973e84f7ae4a841a38b09`
- 退出码：**0**
- 实际 TAP：tests 912，pass 912，fail 0，cancelled 0，skipped 0，todo 0，`1..912`，918439.2206ms（约 15m18s）
- 日志：`build/qa-mvp-03/full.tap`（UTF-16LE，`FF FE` BOM，按 BOM 读取）；退出码 `build/qa-mvp-03/full-exit.txt`；元数据 `build/qa-mvp-03/execution-meta.txt`
- 回归同时覆盖 A／B、修订后的 P11、正式 WS 与新增 consumer；未另跑旧 880 全套。
- 无环境阻断、无跳过、无取消、无未执行项；WS 测试包含在内且未失败。

## 失败、未执行与范围限制

- 本段无失败、无 skip、无环境阻断。
- 未重新执行 `npm run typecheck`／`npm run build`：生产源码与依赖相对前序未变，本轮只新增测试与文档。
- 未实现生产 adapter／私有投影／存档／WS 故障矩阵／原 UI／跨设备；本测试不挂正式服务，ledger 幂等是测试 adapter 假设，不是 consumer 或永久收藏已验收。
- 未读真实存档、未建正式房间、未启动游戏；日志与 bundle 只在 ignored `build/`。

## 未修改声明

- 只新增本段测试与报告（UI-01R 已单独提交）；未修改 `src/`、`server/`、旧测试、脚本、SPEC、主计划／交接、package／锁文件、语言包、资源或 fixture。
- 未推送、未合并 main；未改 P11、金币、checkpoint 或既有测试。

## 维护者后续验收（2026-10-18）

QA-03 3fd1368b 已接收：独立复跑 32/32，额外外部挂起窗口和联合 ACK 顺序控制通过；实际完整 912/912、退出 0、执行 HEAD 与两个测试 blob 已核对。维护者未重跑全套，类型检查／构建未重跑。旧 880／879／1 保留，QA-02B 修订版完整回归待验关闭。见 [最终验收](MVP-QA-03-acceptance-2026-10-18.md)。未合入 main／未推送。
