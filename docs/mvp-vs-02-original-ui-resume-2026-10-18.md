# VS-02 第一段交付记录：持久化 envelope 与真实 lobby

日期：2026-10-18。基线：`9aca592d815916f6640deca0ec20c06f335cf1be`；分支 `feature/vs-02-original-ui-resume`。本文只记录实际完成的第一段，不代表 VS-02 整体或原 UI／双浏览器完成。

## 1. 实际完成

- adapter envelope 升级为 format **2**：`runId`、`stage`、`provisioning`（实际 seed、双方 identities）、`lobby`（step、双方 selection/eggs/ready）、`nativeCheckpoint`、`intents`；不再从未持久化的 fixture 重造局势。
- `captureCheckpoint` 只捕获传入候选，不写“已提交”缓存；投影／测量使用 `restoreCheckpoint` 设置的已提交 checkpoint。
- `validateCheckpoint` 校验格式、runId、双方 identity 范围、stage 与 `nativeCheckpoint` 关系、lobby 形状、starter 物种（Worker `catalogs`）和蛋状态（Worker `native-validate-eggs`）；损坏／旧版本 envelope 拒绝。
- 真实 lobby：`createInitialContext` 不再默认生成双方固定队伍；`describeDecision` 返回 `lobby` incremental；双方通过 `submitAction` 提交 `{kind:'starter-ready', starters:[3], eggs:[], ready}`，未双方 ready 前不创建原战斗。
- 双方 ready 后以各自 `starters` 和 `eggs` 调 `native-open-to-input`，并在 Worker 内按 owner 切换 trainer identity 构造；不再让 B 共用 A 的 identity。原构造、闪光等仍由原类执行。
- 投影新增 `stage` 与 personal `eggs`；lobby snapshot 的 shared 只含 decision 与双方 ready，personal 只含本人选择／蛋。
- `normalizeIntents` 从 `pokemon.fields.id` 读取序列化 ID；owner 只在该精灵确有 owner 时填写，seen 的 `recipient` 明确为 `null`，不猜 M6 接收者；intent 带稳定 id、type、payload、status。
- `FormalRoomStore` 实际读写 envelope 的往返测试；未改 server/data 生产目录。

## 2. 实际验证

```powershell
node --test --test-concurrency=1 tests/coop-original-resume-vs02.test.mjs
```

- **4/4 通过**，约 1.8s。覆盖：lobby 选队创建真实战斗、双方队伍来自各自选择；非法 starter／蛋在选择前拒绝；FormalRoomStore 保存／加载／拒绝旧版本；新 adapter 从持久化 battle envelope 恢复后投影与不中断一致。
- `npm run typecheck` 退出 0；`npm run build` 退出 0（约 1m7s，既有 chunk 警告）。
- `npm run build:coop-runtime` 退出 0（新增 `native-validate-eggs`、per-seat identity）。

未完成或未验证：

- 没有真实 server＋adapter 关闭、同目录重启、resume token、旧 receipt 重发与“只结算一次”的双 WS 验收。
- 旧 `tests/coop-original-bridge-vs01.test.mjs` 在本机当前环境整套运行时出现挂起（单个测试可过），尚未定位；本批没有把它写成通过，也没有删除／skip。
- 尚未运行本批完整串行回归。

## 3. 明确未实现（第一段剩余 + 第二／三段）

- 第一段剩余：真实 server 重启续局、receipt 重放、真实 `StarterSelectUiHandler`／原收藏入口、真实个人蛋镜像接线。
- 第二段：`/coop-play.html`、原 BattleScene／UI handler 的 CoopInputPort、IndexedDB 席位／outbox、浏览器端原模型应用、展示队列与动画隔离、断线恢复界面。
- 第三段：双浏览器原画面连续战斗／整备／下一战、普通升级／学招／替补绑定、正式发布入口、双设备验收。
- 事件 scope 仍按当前类型／pokemonId 规则，不是完整生产白名单；非空永久 grants 继续拒绝，M6 未接。

## 4. 结论

**VS-02 第一段仅完成 lobby／持久化 envelope 的可审查子集；第二、三段未开始，整体未验收。** 不回写旧 920/920，不宣称原 UI 或双浏览器可玩。


## 5. 维护者修订（原交付后）

原 4/4 与挂起记录保留为历史。维护者已复现并修复 Worker 主动关闭后的重建泄漏，补 envelope 和房间归属校验、v6 未知蛋语义与投影纯度；真实重启／receipt 重放／写盘失败用例现已完成，详见 [验收记录](mvp-vs-02-review-2026-10-18.md)。原 lobby 种子第一回合触发异常状态／特性展示未支持阶段，已直接复用原类补接并做连续／恢复差分。

纠正本记录第 1 节两处描述：默认 createOriginalCoopAdapter() 仍走固定 VS-01 夹具，只有 fixture.lobby 显式启用 lobby，尚无真实个人 provider；restoreCheckpoint 在 formal 候选校验中也会被调用，故其缓存仅为 diagnosticCheckpoint，不代表已经落盘。当前正式入口仍默认 ADAPTER_UNAVAILABLE。

下一批按 VS-02B 接真实个人初始化和原 UI 双端首战，未验收原 UI／完整 MVP。
