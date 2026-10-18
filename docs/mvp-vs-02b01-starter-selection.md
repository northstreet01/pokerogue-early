# VS-02B-01：原选队结果 JSON 桥与原构造差分

维护者后续修订：以下 v1 字段与 939/939 是原交付历史。内部选择描述现为 v2，新增必需 eggMoves 解锁位；capture 必须显式传本人该物种解锁记录（含明确 0），旧 v1 不自动补值。修订输入纯度、独立对照与构造资料恢复，见 [维护者验收](mvp-vs-02b01-review-2026-10-18.md)。这不是房间 envelope 或个人蛋库存版本升级。

日期：2026-10-18。基线：`b637e5dd56aceb4907b81c1e65fcb36b04c6a7b8`（发布源码与 `6617871d` 等价）。本批只交付原 Starter 结果的最小 JSON 描述、真实原类 Worker 构造与差分验证；不含页面、WebSocket lobby、真实档案或原 UI。

## 1. 复用来源

| 原来源 | 本批用法 |
|---|---|
| `src/ui/starter-select-ui-handler.ts` 的 `Starter` | 输入字段：`species`、`dexAttr:bigint`、`nature`、可选 `moveset`、`pokerus` |
| `src/phases.ts` `SelectStarterPhase.start` | 构造顺序：`getSpeciesDexAttrProps` → form clamp → gender → 本人 IV → 原等级 → 原 `PlayerPokemon` 构造 → `tryPopulateMoveset` → `pokerus` |
| `src/system/game-data.ts` `getSpeciesDexAttrProps`／`getFormIndex`／`getFormAttr` | 直接调用原方法；用 `Object.create(GameData.prototype)` 仅提供 form 计算，不构造 GameData、不读浏览器设置或存档 |
| `src/battle-scene.ts` `addPlayerPokemon`；`src/field/pokemon.ts` `PlayerPokemon`／`tryPopulateMoveset`／`capturePokemonState` | Worker 里用原 `PlayerPokemon` 构造器与 `tryPopulateMoveset`，不调用 `init()`（显示挂接由提交事件负责） |
| `src/server/original-runtime.ts` 的 `withOriginalRules`／既有 `construct` | 失败回滚随机流；新增 `construct-starter` 操作 |

没有复制伤害、成长、属性、性别、招式、闪光或形态公式，也没有创建 GameData 或改写 dex entry。

## 2. JSON 字段与语义

```json
{
  "version": 1,
  "speciesId": 1,
  "dexAttr": "149",
  "nature": 0,
  "moveset": null,
  "pokerus": false,
  "ivs": [31, 30, 29, 28, 27, 26]
}
```

- `dexAttr`：原 `bigint` 的规范十进制字符串；不接受 `0`、前导零、负数、非十进制或超长值。
- `moveset: null` 表示**未指定**，保留原构造器默认配招；空数组不是“默认”，会被拒绝。显式配招为 1–4 个真实招式 ID。
- `ivs`：该物种本人 dex 记录的 6 项 IV，长度与 0–31 范围严格校验。
- `nature`：0–24；`pokerus`：布尔。
- 未知字段、版本不符、未知物种、非法 dexAttr／form 位、非法 nature／IV／moveset／pokerus 均返回命名错误码。

### dexAttr/form 安全

原交付与任务书关于“无 form 位会无限扫描”的说明不准确：原 getFormIndex 对低于 DEFAULT_FORM 的值直接返回 0，非负有限 bigint 的高位扫描也不能据此断言无限循环。维护者修订先依据原 Starter UI 的选择结构验证单个合法 form 位、互斥标志与目录范围，再直接调用原 getter；这是输入合法性检查，不是修改原解码公式。

## 3. 原构造

`src/server/original-runtime.ts`：

- `constructOriginalSelectedStarter(runtime, dto)`：
  - `restoreStarterSelection` 把 JSON 还原为原 `PokemonSpecies`、`bigint`、moveset ID；
  - `new PlayerPokemon(runtime.scene, species, gameMode.getStartingLevel(), props.abilityIndex, clampedFormIndex, gender, props.shiny, ivs, nature, undefined)`；
  - 仅当 `moveset !== null` 调 `tryPopulateMoveset`，失败即拒绝；`null` 不调用，保留原默认配招；
  - `pokerus` 按原字段设置；
  - 返回 `capturePokemonState` 与原随机状态；失败恢复构造前的 committed random。
- 使用 runtime 的本人 trainer identity；没有另写 identity 或随机公式。
- 新增 Worker 操作 `construct-starter`，挂 `executeRuntimeOperation` 与 host 严格操作表；不是正式玩家 RPC，不进入 native fixture 协议。

## 4. 验证

定向：

```powershell
node --test --test-concurrency=1 tests/battle-core-starter-selection.test.mjs
```

- **4/4 通过**，约 14.8s。
- 覆盖：capture/restore JSON 往返；普通默认配招；非默认性格／IV／闪光；显式 moveset；第二特性；隐藏特性；真实 form 位；genderless；pokerus；Worker 重建后一致；非法描述命名错误码、输入纯度、RNG 不变及后续合法控制。
- 对照路径独立使用原 `GameData.prototype.getSpeciesDexAttrProps`、原 `PlayerPokemon` 构造器与 `tryPopulateMoveset`，不调用被测 `construct-starter` helper。
- 同批 runtime guards＋native runtime：**61/61 通过**，约 73.9s。
- `npm run typecheck` 退出 0；`npm run build` 退出 0（约 1m31s，既有 chunk 警告）。

完整串行回归：见第 6 节（按实际 TAP 填写）。

## 5. 边界

- 未接真实 profile／GameData 读盘；`ivs` 由调用方提供，结构校验不等于防作弊或已解锁证明。
- 未接页面、WebSocket lobby、按席位选择、IndexedDB、原 StarterSelect UI、战斗输入或双浏览器；默认正式 adapter／入口未改。
- 只适配原 CLASSIC 初始语义；融合专用模式、奖励／成长／M6 不在本片。
- 测试中的 species／form/move 只作为真实样例，不是产品白名单。
- `construct-starter` 是 Worker 内部测试操作，不能直接暴露为无需 profile 校验的正式玩家接口。

## 6. 完整回归

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
```

- 执行时 HEAD：`b637e5dd56aceb4907b81c1e65fcb36b04c6a7b8`；新增测试 blob：`319edf1d4a779959df7b78ba3ad86fcfeb00f40b`。
- 退出码：**0**；TAP `1..939`，tests **939**，pass **939**，fail 0，cancelled 0，skipped 0，todo 0，1013817.0709ms（约 16m54s）。
- 日志：`build/vs02b01/full.tap`（UTF-16LE，`FF FE` BOM）；退出码 `build/vs02b01/full-exit.txt`；元数据 `build/vs02b01/execution-meta.txt`。
- 不沿用旧 935/920/912；本批新增 4 项后为 939。
