# MVP-QA-02A 交付说明：Worker 通信与生命周期

## 任务与状态

- 任务：MVP-QA-02A（MVP-QA-02 的 A 段），只新增真实 Worker 通信／复制／排队／关闭测试。
- 状态：**A 段自测通过，待维护者验收**；未改生产代码、未挂 adapter、未实现协议或 UI。B／C 另段交付。
- 本段不等于生产 WS、原 UI、跨设备或 MVP 上线验收。

## 基线与变更

- 基线完整 SHA：`a12f409808c6f18c14e30ee6c50d7af528d95715`
- 工作分支：`outsourcing/mvp-qa-02-batch`
- 运行环境：Node.js v24.15.0；未安装依赖，未启动游戏。
- 本段新增文件（仅两个）：

```text
tests/battle-core-runtime-transport-qa.test.mjs
docs/outsourcing/MVP-QA-02A-delivery.md
```

- 提交 SHA：见交付消息（本文件随提交一起提交，无法写入自身哈希）。

## 复用来源与适配差异

- 直接复用 `server/original-rule-host.mjs`、`server/original-rule-worker.mjs`、`src/server/original-runtime.ts` 的真实 Worker 路径；测试方式参照 `tests/battle-core-runtime-bootstrap.test.mjs`，没有 mock Worker、mock Phaser 或复制规则实现。
- `before` 中构建一次 Node bundle；所有宿主通过 `createOriginalRuleHost` 创建，`t.after`／`finally`／显式 `close` 释放。
- 固定测试 seed `mvp-transport-qa`、假身份 `{ trainerId: 1, secretId: 2 }`、构造参数 `{ speciesId, level: 5, enemy: false }`。控制基线在 `before` 中用独立同配置宿主顺序取得。
- `request('state')` 只描述宿主引导随机与池状态，不代表房间落盘状态。
- H35／H36 在发消息后同步关闭；H36 的 10 秒计时仅用于防止 close 永久悬挂，不用于制造竞态。未跑 watchdog 长等待、CPU／OOM 场景。

## 逐编号覆盖与结果

定向命令与结果：

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core-runtime-transport-qa.test.mjs tests/battle-core-runtime-bootstrap.test.mjs tests/battle-core-native-runtime-guards.test.mjs
```

- 退出码：**0**
- 实际 TAP：tests 94，pass 94，fail 0，cancelled 0，skipped 0，todo 0，`1..94`，38298.3867ms
- 日志（已忽略、不提交）：`build/qa-mvp-02-a.tap`，退出码 `build/qa-mvp-02-a-exit.txt`

| 编号 | 场景 | 期望 | 结果 |
| --- | --- | --- | --- |
| H01–H10 | timeoutMs 为 null／-1／0／1.5／NaN／Infinity／`'15000'`／false／120001／MAX_SAFE_INTEGER | INVALID_RUNTIME_TIMEOUT | 10/10 通过 |
| H11–H18 | identity 为 null／{}／只有 secretId／只有 trainerId／trainerId=1.5／secretId=65536／trainerId=`'1'`／secretId=false | INVALID_TRAINER_IDENTITY | 8/8 通过 |
| H19–H22 | seed 为 null／1／空串／257 个 a | INVALID_ROOM_SEED | 4/4 通过 |
| H23–H26 | operation 为 null／{}／空串／`STATE` | UNSUPPORTED_RUNTIME_OPERATION；随后 state 不变、合法 construct 与控制一致 | 4/4 通过 |
| H27–H30 | construct payload 为函数／Symbol／WeakMap／Promise | INVALID_RUNTIME_PAYLOAD；随后 state 不变、合法 construct 与控制一致 | 4/4 通过 |
| H31 | 调用后、await 前修改 payload.speciesId／level／enemy | Worker 使用发送时副本，结果与控制一致 | 通过 |
| H32 | 修改返回 catalogs 的嵌套数组／构造结果字段后再请求 | 返回对象不反向污染 Worker；后续目录、construct、state 与控制一致 | 通过 |
| H33 | 一次排队 6 个 construct（1、25、906、4、7、912） | 每个结果与顺序控制全等，最终 state 全等 | 通过 |
| H34 | 排队 1、999999、25、state | 中间项 INVALID_POKEMON_SELECTION；前后项完成且随机序列不被拒绝项改变 | 通过 |
| H35 | ready 后提交 catalogs 不 await，立即 close | 先注册拒绝观察；未决项 ORIGINAL_RUNTIME_CLOSED；close 正常；后续请求同码 | 通过 |
| H36 | 有未决请求时重复 close，同时另一宿主排队 construct／state | 两次 close 为同一可等待任务且无悬挂；未决项 CLOSED；另一宿主结果与顺序控制全等 | 通过 |

本段没有重复 QA-01 的 A01–V17／S01–S09 FIGHT 字段矩阵；只覆盖 host／worker 通信边界。

## 失败、未执行与范围限制

- 本段无断言失败、无跳过、无取消、无环境阻断。
- 未重新执行 `npm run typecheck`／`npm run build`：生产源码与依赖相对 QA-01 未变，本轮只新增测试。
- 不验证正式房间／WS 协议、私有投影、存档、原 UI 或跨设备；不宣称完整 RNG 或永久收藏事务完成。
- 不修改 `src/`、`server/`、已有测试、脚本、SPEC、主计划／交接、package／锁文件、语言包、资源或冻结 fixture；未推送、未合并 main。

## 维护者审查追加（2026-10-17）

A 实现范围及真实 Worker 断言通过独立审查；本轮实跑 A＋修订 B 80/80，包含 A 的 36 项。原 A 94/94 日志已按 BOM 核对；额外输入控制通过。A 验收通过，未合入 main／未推送。详见 [分段审查](MVP-QA-02-review-2026-10-17.md)。
