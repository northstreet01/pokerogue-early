# VS-02B-09：普通捕获进入捕获者本局备用

日期：2026-10-20。基线：`d279311f05c0591a8f84b9e29ddf67fa5f44cf16`（fix/keyboard-mouse-controls）；本地／实时 main 仍 `86798227ca995c4ff40043b99a0c6846ed177154`。本批只做普通野生捕获与本局 reserve，不接战后换队、永久收藏、孵化或购物。

## A：真实 Worker 捕获与 reserve

提交：`bd16dac4`；兼容修复 `8dd281d1`（无 reserve 的旧 snapshot 保持原 model 形状）

### 复用与适配

- wait-actions 增加稳定 `{kind:'ball', pokeballType, targetId}` option；只列本人球库存、当前唯一合法野生目标；不传 partyIndex。
- 纯校验 `validateCaptureIntent`：本人球种、库存、目标仍是唯一活跃野生实例、训练家／END biome／Boss 分段等原限制；不消费 RNG、不改状态。
- 执行走原 `CommandPhase.handleCommand(Command.BALL, ballType)` → `TurnStartPhase` → 原 `AttemptCapturePhase`；继续复用原 `getCaptureThreshold`／`advanceCaptureCheck`（三次 shake）／`EnemyPokemon.addToParty`，没有手写成功率、扣球、经验或退场。
- `AttemptCapturePhase` 的 native 端口补齐：`pokemonInfoContainer`、`addFaintedEnemyScore`、`gameData.setPokemonCaught`（只发 pending intent）、`addPlayerPokemon` 个人 view、`add.sprite`、`tweens.addCounter`、reserve 转换。
- 捕获成功个体使用原 `addToParty` 转换；因原方法把野生 id 复制给新个体，coop 内保留野生 roster 到 Victory 完成会冲突，故在服务端以**非 RNG**方式分配未占用的新稳定 id，保留等级／HP／状态／招式 PP／IV／性格／性别／特性／形态／闪光等原字段，写入捕获者 `group:'reserve'`。不写入 current party、不替换前场、不归伙伴。
- 成功后清掉仍排队且指向已捕获敌人的 `MovePhase`；不手写 HP、经验或敌人退场，Victory／EXP 仍走原 Phase。
- 成功 reserve 仅发本人；`projectNativeSnapshot` 新增 `personal.reserve` 完整 `capturePokemonState`，`createOriginalClientModel` apply→capture 也保留 reserve。伙伴只看到共享 field 中敌人离场。
- M6 永久收藏未接；`setPokemonCaught` 只记录 `capture-pending` intent，不调用 saveSystem、不伪造浏览器授予。

### A 验证

- `tests/battle-core-capture.test.mjs` **3/3 通过**：
  - 合成初始 master ball 的成功捕获：原 3 次判断后进入 reserve，球数扣 1，伙伴球不变，field 移除目标，reserve 完整且 projection 一致。
  - 非法 target／库存／额外字段拒绝且 checkpoint 不变。
  - JSON 恢复前后同一候选结果一致。
- 捕获成功测试使用明确标记的 synthetic master ball 初始状态；普通球的随机失败只作探测，尚未形成独立自动断言。
- **未完成**正式双 WS／FormalRoomStore 捕获的重复 actionId、同 ID 异内容、单方重启、落盘失败重试、同目录重启和房间隔离；这些机制沿用同类事务测试，不等于本链已独立覆盖。
- **未完成**普通球（非 master）成功／失败的稳定随机回归；捕获成功依赖测试 seed/合成初始状态。

## B：BALL 输入与本人备用展示

提交：`722f28e3`

- Command BALL 经 `interceptCommand` 进入 `openCaptureMenu`，只显示服务器 `kind:'ball'` option，按原球名提交 `{kind:'ball',pokeballType,targetId}`；浏览器不扣球、不决定捕获。
- 取消回 Command；无合法目标／球时明确提示；保留 FIGHT、主动换人、整备和键鼠输入。
- 复用 outbox、actionId、receipt、ACK、epoch／revision 门控；失败／拒绝后可重选。
- 顶部增加只读“本局备用”行，显示本人 reserve 的名称和等级；不接 Summary 菜单、不放生／交换／恢复进化，明确区别于战后换队。
- **不是原 Ball UI 的整套复用**：本片是合作页的最小 ball 选择面板，原单机 Ball 菜单仍保留；这是 B 的明确缺口。

## 自动验证

- `npm run typecheck` 退出 0。
- `npm run build:coop-runtime` 退出 0。
- `npm run build` 退出 0（约 1m31s，既有警告）。
- 完整串行回归：`1..1014`，tests **1014**，pass **1014**，fail／cancelled／skipped／todo 均 0，`1594238.4243ms`（约 26m34s）；运行时 HEAD `8dd281d1`。使用 detached 进程运行，TAP 已完整收尾；shell 未捕获退出码，不能伪造 `exit 0`，但 TAP 无失败。

## 用户浏览器验收清单（待执行）

1. PowerShell：
   ```powershell
   npm run build:coop-runtime
   npm run build
   $env:COOP_PROFILE_LOBBY='1'
   $env:COOP_DIST='dist'
   $env:COOP_FORMAL_DATA='build/user-vs02b09-rooms'
   $env:COOP_DATA='build/user-vs02b09-legacy'
   $env:PORT='8045'
   node server/start.mjs
   ```
2. 两个独立浏览器/profile 原选队，各至少两只，遵守个人10／共享14点。
3. 进入首战，正常行动到符合 early 规则的单只野生目标；Command→BALL，确认只显示本人球库存与合法目标；取消可回 Command 再选。
4. 投球：失败时球扣一次、敌人留下、双方继续 FIGHT；成功时本人 reserve 出现、伙伴不获得、前场不自动替换。
5. 核对 reserve 的等级／HP／状态／招式 PP／IV／性格／性别／特性／形态／闪光；刷新或同目录重启后不重复个体、不重复扣球。
6. 成功后继续原整备／下一战双方 FIGHT；检查临时 BALL 面板不残留。
7. 用户未执行的项目保持“待用户验收”；注意 B 是合作页最小球面板，不是原 Ball 菜单整套复用。

## 剩余缺口

- 正式双 WS/disk/restart/去重隔离未补；普通球成功/失败随机未稳定自动覆盖。
- 战后换队、完整原 Party reserve 管理、永久收藏 M6、蛋事务未接。
- B 未复用原 BallUiHandler；当前是合作页最小选择面板。
- 捕获成功后经验／Victory 已走原 Phase，但更复杂成长子决策仍需原记录中的缺口。

## 2026-10-21 维护者追加（不覆盖以上原交付历史）

原交付A有伙伴行动被跳过、双投球归属猜测、捕获计分空操作、逐阶段捕获恢复非法检查点及待处理记录归属缺失等问题，维护者已在独立本地评审分支修复；B已替换为原BallUiHandler可选展示／回调端口，并补跨await门控。最终验证与具体范围以 [维护者验收](mvp-vs-02b09-review.md) 为准。原Party／Summary查看仍未接，双浏览器仍待用户；以上“最小网页球面板”和“正式WS未补”描述仅保留为原交付历史。

用户启动时改用空闲端口8046，URL为 `http://127.0.0.1:8046/coop-play.html`；目录建议 `build/user-vs02b09-review-rooms`、`build/user-vs02b09-review-legacy`，保持同目录重启验证。不要占用／关闭原服务。Command→BALL现在应显示原画布球菜单，WASD／方向键移动、Enter或鼠标确认、Esc取消；球数量来自本人权威投影，合法性仍以服务器为准。备用现阶段只能从顶栏查看名称／等级，完整属性有自动恢复证据但没有原Summary人工查看入口，不能要求用户把此项勾成已通过。

### 当前用户测试启动命令

以下是维护者修订版本，不沿用上方原交付的8045端口：

```powershell
Set-Location E:\pokeregue\pokerogue-early
npm run build:coop-runtime
if ($LASTEXITCODE -ne 0) { throw 'Worker构建失败' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '生产构建失败' }
if (Get-NetTCPConnection -LocalPort 8046 -State Listen -ErrorAction SilentlyContinue) {
  throw '8046已占用，请另选空闲端口并相应修改URL，不关闭原服务'
}
$env:COOP_PROFILE_LOBBY='1'
$env:COOP_DIST='dist'
$env:COOP_FORMAL_DATA='build/user-vs02b09-review-rooms'
$env:COOP_DATA='build/user-vs02b09-review-legacy'
$env:PORT='8046'
node server/start.mjs
```

两个独立浏览器／profile打开 `http://127.0.0.1:8046/coop-play.html`。正常选队、战斗形成单只合法野生目标；原BALL菜单取消／重选、投球失败后双方继续FIGHT、成功只归本人备用、刷新／同目录关服重启不重扣／重获，再整备进入下一战双方FIGHT。浏览器不强制成功，不改值或跳阶段，未达到成功分支就准确反馈已到步骤。当前备用完整属性没有原Summary入口，留待下一批，不要求用户通过隐藏方法核对。

维护者最后追加显示修订：codec不保留展示name，备用行现调用原Pokemon.generateName重建名称；UI定向34/34、退出0。此为规则修复da167bc4完整1022/1022之后的小修，未再次全套，最终构建和提交以维护者记录为准。Summary与浏览器仍待完成。
