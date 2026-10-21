# VS-02B-11R：自然升级学招生产链（部分修复，未关闭）

日期：2026-10-21。起点 `fddd7cdc5fcd2c94c4e1082bb8b8ecd38db81628`（源码／测试基点 `f429331d`），分支 `feature/vs02b11r-natural-learn`；main／实时远端仍 `86798227…`。本批只沿自然升级学招，不扩进化、M6、孵化、购物或部署。

## A 提交 `71ed757e`

### 实际修复

- `SummonMissingPhase` 加入 native 支持；缺员/倒下席位先在本人 party 中找第一个存活个体，再复用原 `SummonMissingPhase`／`SummonPhase` 召唤；没有存活个体才结束该原 phase。没有手写复活、HP 或召回公式。
- `wait-actions` 的 requiredSeats 改为只含当前仍有存活前场的席位；`native-submit` 只核验实际收集到的席位，不再要求已倒下/空场席位提交 FIGHT。
- 保留原 `TurnInitPhase` 创建 Command 的行为；不广泛放开 phase allowlist。

### 自然探索结果

使用明确诊断案例 `learning-natural-1`（Bulbasaur＋Snorlax，正常 v2 选队、普通 FIGHT、正常奖励和下一战；不修改经验／等级／HP／moveset／RNG）：

- 原先 wave 4 的 `SummonMissingPhase` 被 native 拒绝；修复后已能进入原召唤并继续。
- 继续到 wave 3/4 后，Bulbasaur 在升级前倒下；仅 Snorlax 存活时已不再要求席位0输入。
- 随后仍遇到：
  - Snorlax 低 HP 时 `actionDecision` 产生空 fight options，提交被 `INVALID_DECISION` 拒绝；
  - 六只队伍探索到 wave 4 时 `UNSUPPORTED_NATIVE_ENTRY_PHASE`（具体尚未支持阶段仍在定位）。
- **没有取得自然 LevelUp→LearnMove 连续成功路径**，因此没有自然学招的替换/放弃/新招 FIGHT 证据。
- 没有修改 checkpoint 的经验、等级、HP、moveset、RNG、资源或队列来制造触发；诊断脚本在 ignored `build/vs02b11-review/`。

### 自动验证

- 受影响 native 定向：`battle-core-faint`、`battle-core-replacement`、`battle-core-native-runtime`、`battle-core-native-interactions-qa` **75/75 通过**，约 100s。
- `typecheck`、`build:coop-runtime`、生产 build 退出 0（最终 build 约 1m4s，既有警告）。
- 完整串行回归：`1..1059`，pass **1059**，fail／cancelled／skipped／todo 均 0，`1115796.162ms`（约 18m36s）；运行时 HEAD `420d9d63`。detached 进程未捕获 shell 退出码，TAP 无失败，不伪造 exit 0；全套没有自然学招用例。


## B

- B 未新增代码。维护者基线已有原 Confirm/Summary LEARN_MOVE 代码和自动控制器，但没有自然成功路径，也没有双浏览器验收。
- 因此 B **未执行/阻断**，不提供“通过”清单。用户浏览器步骤在自然链修复前不可用。

## 明确剩余边界

- 自然路径中空战斗选项（无可用招式）的合法处理尚未解决；不能通过放宽 decision 校验绕过。
- 自然六只队伍仍有一个未支持的 native phase；需定位具体原 phase。
- 没有自然成功学招、没有正式双 WS 消费自然检查点、没有新招 FIGHT。
- 进化、永久收藏 M6、孵化等仍未做。

本批完成可独立审查的缺员/存活席位接缝，但没有关闭自然学招门，不能宣称 A/B 通过。
