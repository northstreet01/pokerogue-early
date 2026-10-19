# VS-02B-08：战斗内主动换人（A 原生链，B UI 待用户验收）

日期：2026-10-19。基线：`6ff2fc4adc576033df896cb14d6aa9c525662e88`（review/vs02b07-ui-text-fix）；本地／实时 main 仍为 `86798227ca995c4ff40043b99a0c6846ed177154`。本批只接战斗内普通 `SEND_OUT`，不扩捕获、战后换队、购物／重抽／成长。

## A：真实 Worker 主动换人

提交：`0ddbd323`

### 复用与适配

- 原 `CommandPhase.handleCommand(Command.POKEMON, cursor, false)` 设置原 `turnCommands`；不手写队伍交换、出场者、PP、HP 或回合顺序。
- 原 `TurnStartPhase` 创建 `SwitchSummonPhase`；每个席位用其个人 Party view（一个前场、本人后备）执行原 swap/summon；`sync()` 仍从个人 party 数组重建 `roster.field` 和 entries。
- 复用 `decision-state` 的 4 槽权威 field、个人 owner、codec、`advanceCollectedFightCommands`、`resolveFightIntent`、原 `TrappedTag`／`CheckTrappedAbAttr`／`applyCheckTrappedAbAttrs`。
- `actionDecision` 在 wait-actions 的每席 options 追加 `{kind:'switch',pokemonId}`，只列本人存活、index>0、未在场后备；不发送 partyIndex。
- 纯校验与执行共用 `validateActiveSwitch`：owner、本人 party、index>0、存活、非当前场、原束缚特性/标签；旧 decision 由既有 codec／ACK 门控。
- 当前只支持普通 `POKEMON` 无 Baton Pass；action 严格仅 `{kind:'switch',pokemonId}`，其它字段／baton 分支在 codec 前拒绝。
- 双方同轮换人时，`native-submit` 在收集输入后立即执行原 `TurnStart`＋各席 `SwitchSummon`／`PostSummon`，避免根 party 游标在第二席失效；没有换人的纯 FIGHT 保持原阶段边界。
- 未增加 `ShowPartyExpBarPhase` 支持：主动换人后下一回合若直接击倒敌人，仍可能遇到这个既有的原生经验条阶段缺口；本批 WS 测试用状态招式避免把它误当换人成功。该缺口如实保留。

### A 验证

- `tests/battle-core-active-switch.test.mjs`：**4/4 通过**（约 1.96s）：
  - 真实 Worker 主动换人成功；换人者 PP 不变、伙伴场位不变、回合前进。
  - 双方同轮换人；下一 wait-actions 仍要求两席。
  - 伙伴／当前出场者／未知 id 拒绝且 checkpoint 不变。
  - JSON 恢复后同候选结果一致。
- `tests/coop-original-bridge-vs01.test.mjs` 新增真实双 WS／正式 adapter／FormalRoomStore 测试：**1/1 通过**（约 12.7s）；两席同时主动换人 → revision+1 → 下一轮两席真实 FIGHT → 新 revision。
- 既有换人定向（pre-battle／forced／repair）**23/23 通过**（约 83.3s）。
- 未单独补主动换人的“落盘失败后重试／同目录关服重启／重复 actionId／房间隔离”测试；这些机制复用已有 reward／switch 事务测试，但**不能据此写成主动换人已独立覆盖**。
- `npm run typecheck` 退出 0；`npm run build:coop-runtime` 退出 0；`npm run build` 退出 0（约 1m44s，既有警告）。

## B：原 Command → 本人 Party UI

提交：`8ffcd9d9`

- `CommandUiHandler` 的 `POKEMON` 经既有 `interceptCommand` 进入 `CoopPlayPhase.openActiveSwitchParty()`；不再落到原单机全队 Party。
- 使用原 `PartyUiHandler`、原光标／取消／过滤；临时 `scene.party` 为本人 codec 副本（`restorePokemonState(capturePokemonState(...))`），`currentBattle.double=false`、`getBattlerCount=()=>1`，退出恢复公开双打展示。
- 服务器 switch options 映射为允许 Set；点击本人合法后备只提交 `{kind:'switch',pokemonId}`。浏览器不交换、不结算。
- 取消（slot 6／越界）回原 Command；拒绝回执、断线、clear、新 snapshot、过期 epoch 都释放临时视图并重新开对应菜单。
- 复用 outbox 先写盘、actionId、receipt／ACK、`isPersonalInputCurrent` 门控；旧回调不能提交。
- FIGHT／Target 和整备 Potion Party 路径保留；主动换人临时视图与 Potion 视图分别清理。

**B 未执行真实浏览器验收**：没有完成“打开 POKEMON → 取消 → 重选 → 本席场位变化 → 伙伴 FIGHT → 刷新／重启 → 继续 FIGHT”。不能写成通过。

## 用户浏览器验收清单（待用户执行）

1. PowerShell：
   ```powershell
   npm run build:coop-runtime
   npm run build
   $env:COOP_PROFILE_LOBBY='1'
   $env:COOP_DIST='dist'
   $env:COOP_FORMAL_DATA='build/user-vs02b08-rooms'
   $env:COOP_DATA='build/user-vs02b08-legacy'
   $env:PORT='8044'
   node server/start.mjs
   ```
2. 两个独立浏览器/profile 打开 `http://127.0.0.1:8044/coop-play.html`；各选至少 2 只，遵守个人 10／共享 14 点。
3. 首战进入 Command，选 POKEMON；确认原 Party 只显示本人队伍。按取消，应回 Command；再打开并选择合法后备。
4. 确认本人前场变为所选后备，伙伴前场不变；确认换人没有额外消耗招式 PP。
5. 同轮让伙伴 FIGHT；下一轮双方 FIGHT，确认能继续，不出现“旧决策／ACK”错误。
6. 刷新一端或同目录关服重启，确认场位、后备、资源和伙伴状态没有重复变化。
7. 记录实际窗口、中文／英文、旧 revision 拒绝、临时 Party 视图是否残留；未实际执行的项目继续标“待用户验收”。

## 剩余缺口

- 主动换人只支持普通 SEND_OUT；Baton Pass、捕获、本局备用、战后换队未接。
- 原 `ShowPartyExpBarPhase` 仍未纳入 native 支持；战斗胜利后的经验条阶段是既有缺口，可能在主动换人后的下一回合暴露。
- 主动换人的磁盘失败重试／重启／重复 actionId／房间隔离没有独立新测试；沿用同一事务链，但不能替代。
- B UI 未真实浏览器验收；Potion 原 Party 交互和 VS-02B-07 视觉仍是用户待测项。
- 完整串行回归结果见下方待补。

## 完整回归

- 运行时 HEAD：`8ffcd9d9f4346deaea268888fbbf6cc2112ef3d4`（A `0ddbd323` + B `8ffcd9d9`）；随后只追加本文档提交 `3da1d43f`，没有源码／测试差异。
- TAP `1..1000`，tests **1000**，pass **1000**，fail／cancelled／skipped／todo 均 0，退出码 **0**，`1595758.506ms`（约 26m36s）。
- 日志／退出码／元数据：ignored `build/vs02b08/full-final.tap`、`full-final-exit.txt`、`execution-meta-final.txt`。
- 最终源码／测试 blob（HEAD `3da1d43f`）：active switch 测试 `46ee98024e070318f84b7ff8b55a1406dcc14ea8`，native-entry `01fae98915f00b4dcedf405e120a22aa4dfad8c5`，play-phase `a13b42a924924132c26c34c687440c7f6d361806`。
- 未运行浏览器验收；B 段仍待用户。
