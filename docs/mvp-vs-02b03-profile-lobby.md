# VS-02B-03：本人原资料与共享 14 点正式入局

维护者更新：下文保留原交付 profile v1 与 953/953 历史。当前 profile 已升级 v2，附最小 unlocks 供服务端核对；修复候选身份缓存、format 3 的 stage／seed 校验与版本降级，以及准备后改选绕过。当前验证和迁移边界见 [维护者验收](mvp-vs-02b03-review-2026-10-18.md)。SPEC 与任务提示词仍只本地保留。

日期：2026-10-18。基线：`122b1828285b48f09629e3b6fd86bd8def2d0421`。本批 A／B 两段均完成代码与定向验证；页面、真实档案读盘、IndexedDB 和原 UI 不在本片。

## A. 原资料最小桥与原成本

### 复用来源

- 原 `GameData.dexData[speciesId]` 的 `ivs`、`caughtAttr`、`natureAttr`、`caughtCount`、`hatchedCount`。
- 原 `GameData.starterEggMoveData[rootSpeciesId]` 的蛋招解锁位。
- 原 `GameData.eggs` 的原 owned egg codec 镜像。
- 已完成 v2 `captureStarterSelection(starter, ivs, eggMoves)` 与 `originalOwnedEggStateCodec`。
- 原 `GameData.getSpeciesStarterValue` 计算成本；不重写折扣公式。

### 最小 JSON

```json
{
  "version": 1,
  "trainer": { "trainerId": 11, "secretId": 22 },
  "starters": ["每席 1–6 个 v2 选队描述"],
  "costs": [{ "speciesId": 1, "caughtCount": 25, "hatchedCount": 0 }],
  "eggs": ["原 owned egg 最小字段"]
}
```

- 身份、选择、IV／nature／eggMoves、成本计数和蛋镜像才进入 JSON；不上传整份历史收藏、session、恢复凭据。
- 缺 dex 记录、缺蛋招记录、非法 IV／nature／eggMoves、未解锁属性／性格、重复同席物种、未知字段、v1 选择、非法蛋库存均明确拒绝；不默认 31 IV、空蛋、已解锁或 0 成本。
- `moveset: null` 保留原默认配招；`eggMoves` 是根物种解锁位，不是待孵化蛋库存；v6 未知蛋库存不补空。
- 每席独立资料；两席可同物种，同席不能重复。

### Worker 成本

- `validate-profile`：仅对最小 JSON 做校验与成本计算，返回每只 `{speciesId, cost}` 和 `total`，保留分数成本。
- `normalize-profile`：返回规范化 profile 与价格，供正式 lobby 使用。
- 直接调用原 `GameData.prototype.getSpeciesStarterValue`；无 RNG／资料／payload／本局模型副作用。
- 信任边界：这是无认证的本地资料导入；结构校验不等于真实账号所有权或防作弊。

## B. 正式 lobby → selected Worker → 持久续局

### 适配器格式

- 新 `fixture.profileLobby` 模式使用 adapter checkpoint **format 3**；旧 v2 三数字 lobby／旧已开战 checkpoint 保留并可恢复。
- lobby 状态：`{mode:'profile-v1', step, budget:{personal:10,shared:14}, players:[{profile,priced,ready}]}`。
- 动作：`{kind:'profile-ready', profile, ready}`；服务端从连接席位导出 seat，不信任 payload owner/seat；同席后续资料必须保持同一 trainer identity，不能偷换。
- 校验：profile 由 Worker 规范化与计价；个人 total ≤10；双方当前候选合计 ≤14；超限稳定返回 `PERSONAL_BUDGET_EXCEEDED`／`SHARED_BUDGET_EXCEEDED`，不自动删精灵、不吞已接受选择。
- 双方 ready 后固定 seat0→seat1 顺序，以持久化 seed、双方 profile identity、完整 selections 和 eggState 调用 `native-open-selected-to-input`；不退回 speciesId 数字入口。
- 公共投影只含 ready 与共享已用／剩余点数；个人完整 profile、价格和蛋只在本人 personal；非空蛋不丢。
- 旧三数字 lobby 仍作为内部 fixture 保留；不把缺失完整选择／资料伪造迁移到 format 3。

### 实际验证

- A：`tests/battle-core-profile-entry.test.mjs` **3/3 通过**，约 9.1s。覆盖 capture/validate/restore、独立原 getter 成本对照、个人折扣差异、分数成本、1/6 只、非空蛋、非法字段／版本／计数／蛋库存、Worker 纯校验与 RNG 不变。
- B：`tests/coop-profile-lobby-vs02b03.test.mjs` **3/3 通过**，约 12.6s。覆盖两个真实 WS 客户端 + 真实 adapter/Worker/正式 service：
  - 个人超 10、合计超 14 均在缓冲前拒绝；修正后不同长度 3＋2 选队进入真实首战，双方客户端原模型 apply→captureAppliedState→consumer ACK，随后双方 FIGHT 推进到新 revision。
  - 同 identity 数值、1＋6 只不同长度真实验证。
  - 一席 ready 后关闭 server＋adapter，从同目录 FormalRoomStore 重启、resume token 新 epoch；旧 actionId＋完整消息重放只返回旧 receipt、不重复建战；双方 ready 建战后再次重启，恢复同席位和队伍。
- 旧 lobby／恢复回归仍通过（定向 15/15，含 worker 生命周期与旧 v2 恢复）。
- `npm run typecheck` 退出 0；`npm run build` 退出 0（约 1m54s，既有警告）。

### 未完成／边界

- 未接页面、真实本人存档自动读取、原 StarterSelect UI、IndexedDB outbox、原战斗 UI、双浏览器或第二设备。
- `captureProfile` 是调用方对已加载原 GameData 的显式导入；没有可信账号认证，不能把结构校验当作所有权证明。
- 未实现捕获、主动换人、本局备用和战后换队；孵化／永久授予／M6 未接，蛋只镜像不消费。
- 旧 v2 三数字 lobby 不迁移到完整 profile；旧已开战 checkpoint 仅按原格式恢复。
- 同 identity 数值允许，owner 始终由席位绑定；两席收藏／资源独立。
- 未知 Phase 仍由既有安全失败路径处理；不宣称任意 seed／全部机制兼容。

## 完整回归

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
```

- 执行时 HEAD：`f67f6e1de7c07b99a1fd5010a99c7408c9ad4823`（A commit；B 代码/测试为未提交工作树）。
- A 测试 blob：`5d5b562cf9f210f2011ac82c0c2f039203beadbe`；B 测试 blob：`a4c5d9305415a80165d54bfba004b519e807f5ac`。
- 退出码：**0**；TAP `1..953`，tests **953**，pass **953**，fail 0，cancelled 0，skipped 0，todo 0，1501366.3253ms（约 25m1s）。
- 日志：`build/vs02b03/full.tap`（UTF-16LE，`FF FE` BOM）；退出码 `build/vs02b03/full-exit.txt`；元数据 `build/vs02b03/execution-meta.txt`。
- 不沿用旧 946/943/939 数量；本批新增 A 3 项、B 3 项后为 953。
