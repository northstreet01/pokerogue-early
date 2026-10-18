# VS-02B-02：完整 v2 选队描述进入 Worker 首战

维护者更新：以下为原交付固定三只的历史记录；当前 selected 入口已修为各 1–6 只，同席不重复、两席可重合，允许相同训练家数值。用户确认共享 14 点，正式 profile／成本和 lobby 校验尚未接入。修订验证见 [维护者验收](mvp-vs-02b02-review-2026-10-18.md)，946/946 不代表修订版全套已重跑。

日期：2026-10-18。基线：`32c1e2592701bb46636243996e3607efa5f2ff52`（含维护者对 `8da3de5b` 的选队桥修订）。本批只把完整原选队描述接入真实 Worker 首战输入；没有页面、profile 读盘、正式 lobby 或原 UI。

## 1. 复用来源

| 原来源 | 本批用法 |
|---|---|
| `src/coop/original-starter-selection.ts`（维护者 v2） | `restoreStarterSelection` 严格校验 v2；`eggMoves` 是本人根物种蛋招解锁位，不是蛋库存 |
| `src/server/original-runtime.ts` `constructSelectedStarterInstance` | 提取原实例构造核心；construct-starter 与 selected entry 共用，不复制第二份构造 |
| `src/phases.ts` NewBattlePhase／EncounterPhase、`BattleScene.newBattle` | 与数字 species-ID 入口共用同一原入场链 |
| `src/server/native-entry.ts` `openNativeBattle`／`bindNativeScene`／`runNativeUntilBoundary` | 复用 codec、安全停点、入场阶段与 `runOpenedToInput` |
| `src/system/game-data.ts`、`src/field/pokemon.ts` | 原 form getter、原 `PlayerPokemon` 构造、`tryPopulateMoveset`、`capturePokemonState` |
| `originalOwnedEggStateCodec` | 校验并保存双方原 owned egg 库存，不消费 |

## 2. 输入契约

```json
{
  "identities": [
    { "trainerId": 11, "secretId": 22 },
    { "trainerId": 33, "secretId": 44 }
  ],
  "starterSelections": [
    [ { "version": 2, "speciesId": 1, "dexAttr": "149", "nature": 0, "moveset": null,
        "pokerus": false, "ivs": [31,30,29,28,27,26], "eggMoves": 0 }, "...3 个..." ],
    [ "...3 个..." ]
  ],
  "eggState": { "players": [ [ "原 owned egg 描述" ], [] ] }
}
```

- 只接受上述三个字段；未知字段、缺失字段、v1 选择、少/多一只、非法身份、非法蛋库存明确拒绝。
- 两个 identity 必须不同且各在 `0..65535`；构造前按 owner 切换 runtime gameData 的 trainerId／secretId，B 不共用 A。
- `starterSelections` 每席恰好 3 个完整 v2 描述；形态／特性／性别／闪光／性格／IV／配招／pokerus／eggMoves 全部由原构造消费。
- `eggState` 必须显式提供，经原 owned egg codec 校验；`players` 每席必须是数组或原 codec 允许的未知表示，不能用缺省值补空。本批不消费蛋。

## 3. Worker 入口

- `native-open-selected`：校验后构造双方 6 只真实原 `PlayerPokemon`，执行原 `NewBattlePhase`→`EncounterPhase`，返回 checkpoint／events／intents。
- `native-open-selected-to-input`：在 selected open 之后复用 `runOpenedToInput`，执行原 Summon／PostSummon／Toggle／Message／Shiny／TurnInit 到首个真实 `wait-actions`。
- 第一阶段全部描述先验证，再基于 runtime 的 seed／随机基点建立 fork 候选；parent committed random 不变。失败不写 checkpoint、不发布候选。
- 数字 species-ID 的 `native-start`／`native-open-to-input` 严格字段拒绝保持不变；不检测对象猜模式，不自动升级 v1。
- 首个 wait-actions 的 `decision.options` 按席位给出本人参战 id，`roster.field` 前两位为双方 actor；敌方仍是原 Encounter 生成的公开对象。

## 4. 验证

```powershell
node --test --test-concurrency=1 tests/battle-core-selected-entry.test.mjs
```

- **3/3 通过**，约 8.6s。
- 覆盖：双方各 3 只 v2 选择进入真实 wait-actions；owner／field／actor／options；原等级 5；显式形态／第二特性／性格／IV／性别／闪光／pokerus／默认配招／显式配招／合法解锁蛋招；PP 初始为 0 消耗；非空个人蛋库存；连续 selected 与原 selected-open→run-to-boundary 的 checkpoint／随机／事件差分；新 Worker 从 JSON 恢复；同候选重建一致；非法身份／版本／字段／蛋库存／第二席／最后一只被拒且 RNG 不变，随后合法控制成功。
- 同批 native guards＋native runtime＋starter＋selected：**68/68 通过**，约 56.8s。
- `npm run typecheck` 退出 0；`npm run build` 退出 0（约 1m21s，既有 chunk 警告）。

完整串行回归：见第 6 节。

## 5. 边界

- 仍是内部 Worker 能力，不暴露为生产玩家 RPC；没有可信账号／profile 绑定，选择与 IV／eggMoves／eggState 仍由调用方提供。
- 未接页面、原 StarterSelect、正式按席位 lobby、IndexedDB outbox、原战斗 UI、双浏览器或第二设备。
- 未消费蛋、未写永久收藏；M6 仅保留未消费 intent。
- 只适配原 CLASSIC；融合模式、奖励／成长／特殊机制不在本片。
- 测试样例不是产品物种／形态白名单；未知 Phase 仍由现有安全失败路径处理。

## 6. 完整回归

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
```

- 执行时 HEAD：`32c1e2592701bb46636243996e3607efa5f2ff52`；新增测试 blob：`0f2f6b41d9a6d661e9ce79d727c14bb79e255da9`。
- 退出码：**0**；TAP `1..946`，tests **946**，pass **946**，fail 0，cancelled 0，skipped 0，todo 0，919746.8669ms（约 15m20s）。
- 日志：`build/vs02b02/full2.tap`（UTF-16LE，`FF FE` BOM）；退出码 `build/vs02b02/full2-exit.txt`；元数据 `build/vs02b02/execution-meta.txt`。
- 首次全套在 `tests/coop-move-execution.test.mjs` 发生进程级 `0xC0000409` 崩溃（该文件单独复跑 3/3 通过，业务断言无失败）；按环境瞬态处理后干净重跑得到上表，不把首次统计拼接为通过。
