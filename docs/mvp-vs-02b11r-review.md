# VS-02B-11R 维护者复验：自然学招生产门

日期：2026-10-21。交付 HEAD `73bcdde2`，父链 `fddd7cdc → 71ed757e → 420d9d63 → 73bcdde2`。开始时分支 `feature/vs02b11r-natural-learn`、工作区干净、只有一个 worktree；可见任务清单没有另一个活跃的同项目开发。原交付仅修改一个生产文件，无新增测试。main、origin/main 及实时远端 main 均重新核对为 `86798227ca995c4ff40043b99a0c6846ed177154`，未修改参考项目。

维护者独立分支 `review/vs02b11r-natural-fix`，修复提交 `2dff92bf`；随后补原菜单任意招式行的挣扎选择 `b4e856a3bbc97d5d0fafbe1ad51d05713900b6d9`，后者为最终源码／测试验证基点。未合并、未推送。

## 结论

- **A 的有限自然学招链通过自动生产验收**：正常 v2 选队与原配招校验 → 真实普通 FIGHT／胜利经验 → 原 LevelUp → 满四招 LearnMove → 替换或放弃 → Worker／正式服务恢复 → 下一合法输入 → 新招实际 FIGHT。最终完整串行1068/1068、退出0，范围限本记录的原规则接缝与自然路径。
- **B 部分完成，实际双浏览器未执行，待用户**。原 Confirm／Summary 仍复用维护者基线，新增正式服务可选固定种子和准确手测说明；不能用自动测试当作浏览器通过，也不把测试收藏描述写进真实存档。
- 不代表任意 seed、所有队伍或完整成长兼容。**wave 5 固定训练家仍被明确拒绝**；这是下一片最先要接的真实推进阻断，不是本批已完成项。进化、其它整备、M6、孵化、跨设备／部署仍未验收。

## 直接发现并修复

1. **无可用招式时丢失挣扎入口**：原 `selectFightCommand` 已有挣扎规则，但 native 先过滤所有不可用招式，导致空 FIGHT options。现沿原规则提供所有原招式行的合法 intent，目标使用原 Struggle 的目标计算，执行仍由原 CommandPhase／MovePhase 结算。没有放宽 decision 校验、客户端传入招式 ID 或重写 PP／反伤公式。
2. **SummonMissing 只改下标不等于召唤到前场**：原交付把 partyMemberIndex 指向后备，却没有使原个人队伍前场交换；席位1的原共享下标还可能超出个人队伍长度。现统一规范为本人局部 index 0；需要补位时调用原 `SummonPhase.preSummon`，由原方法选择／交换并完成召唤；没有手写交换。本人全倒时只结束基础 Phase，不执行会为倒下者再排 PostSummon 的 Summon.onEnd。该接缝放进统一 execute，连续执行和逐阶段恢复一致。
3. **已批准的过关恢复未接 native**：复用已有 `recoverVictoryParties` 和原 `modifierTypes.REVIVE().newModifier(...).apply`，仅在原 BattleEnd 已完成且敌人全部倒下时，对全队倒下的席位恢复本人第一只半血；不消耗物品，不调用永久存档。非胜利 BattleEnd 不误触发该恢复。自然单席继续战斗后过关的用例验证此路径。
4. **六只探索的未支持阶段已定位**：是原 `PostTurnStatusEffectPhase`，不是 Evolution。只接此既有原阶段，没有整套放开 allowlist。补连续／新 Worker 逐阶段毒伤一致性验证，伤害与状态公式仍在原 Phase／Pokemon。
5. **展示端口缺失原 API 语义**：damageNumber.add 的省略参数原本生成 undefined，导致逐阶段事件复制 `INVALID_JSON`；现沿原 DamageNumberHandler 的有效伤害／非暴击默认值。hideInfo 保留原 Promise 完成语义，不再返回 undefined。没有改规则计算。
6. **用户可复现入口**：`server/start.mjs` 可选 `COOP_ROOM_SEED`，只作用于新建房间的原 seedFactory，未设置仍使用 randomUUID；不向浏览器投影 seed 或 RNG，不改已有房间恢复数据，不回落默认 fixture。

复用来源：early `src/phases.ts` 的 Summon／SummonMissing、Command／Move／PostTurnStatusEffect／BattleEnd／LevelUp／LearnMove；`fight-command.mjs` 原提取函数；`victory-aftermath-runner.mjs` 已批准恢复；正式 adapter／Worker／FormalRoomStore；原配招、成本校验和原 Confirm／Summary。原冻结 fixture、规则公式和个人 mods 空断言未删除。

## 自然路径与证据范围

`tests/helpers/native-natural-learning.mjs` 从原 selected entry 正常构造：seat0 Azurill、seat1 Snorlax，原初始等级5，固定 seed `learning-natural-2`。初始收藏／身份／IV 是明确的受控测试资料，不是真实用户存档；调用生产 `validate-profile` 验证解锁描述、原初始配招和成本（个人3／5点，共8点）。没有修改战斗检查点中的等级、经验、HP、招式、RNG、资源或队列制造升级。

Azurill 初始原四招：Water Gun／Tail Whip／Splash／Helping Hand。双方正常战斗、按实际抽出的本人 Potion 恢复或跳过、准备、战前保持出场者；wave4 原胜利经验自然升到6级，原 LearnMove 给出 Bubble Beam。测试分别替换第0槽与放弃；重启 Worker 后处理原选择，随后双方合法输入，Azurill 的 Bubble Beam（或放弃后的原 Water Gun）实际执行、只扣一次 PP，伙伴使用原 Defense Curl。

正式双 WS 用例使用上述自然战斗生成的原检查点作为明确的测试初始上下文；没有重造其字段。它验证正式 adapter 的选择、候选落盘失败／重试、关闭 HTTP／Worker 后同目录恢复、actionId 重放／冲突、房间隔离、真实原模型 apply/capture／ACK 及后续 FIGHT。**该用例没有通过浏览器从 profile lobby 完成选队**，不能冒充整段双浏览器成功。

另用 `learning-natural-1` 的正常 Bulbasaur＋Snorlax、不领取治疗奖励，真实经历一方全倒、仅存活席位提交 FIGHT、共同过关后原半血恢复至整备。合成的耗尽 PP、后备缺员和毒伤夹具单独标记，不与自然学习来源混淆。

## 验证与失败历史

本地 ignored 证据：`build/vs02b11r-review/`，不提交日志／数据。

| 检查 | 本次结果 |
|---|---|
| native 学招及相关生产回归 | 15/15，退出0，12955.0329ms；含新增7项自然／接缝验证 |
| 学招正式双 WS 定向 | 4/4，退出0，22906.4101ms；2项既有合成＋2项新增自然来源，随后由最终全套再覆盖 |
| typecheck／Worker构建 | 退出0 |
| 最终生产 build | 退出0，Vite报告1m14s（约74秒）；既有动态导入/chunk警告 |
| 最终完整串行 | **1068/1068，退出0**；`1..1068`，fail/cancelled/skipped/todo均0，1067866.5445ms（约17分48秒），运行源码/测试HEAD为b4e856a3 |
| 用户双浏览器 | 未执行；收藏前置条件和路径见手测清单 |

最终串行命令：`node --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`；单次完整输出 `full-final.tap`，直接捕获 `$LASTEXITCODE` 至 `full-final-exit.txt`。运行 HEAD 及 src/server/tests blob 清单为 `execution-head-final.txt`、`execution-source-blobs-final.txt`。

保留失败：原 `learning-natural-1` 六只探索逐阶段定位到 PostTurnStatusEffectPhase；首次选取的 Dunsparce 初始四招包含尚未到等级的 Rollout，被原校验拒绝，未绕过规则，改用原合法 Azurill 配招。自然 seed1 路径在学招前倒下，seed2 才取得成功；二者均保留日志，不合并成一次成功。

新测试最初直接读取编码后的 turnCommands、合成倒下敌人漏填 FAINT 状态而失败，按原 codec 修正测试，不修改冻结参考；毒伤恢复暴露真实 undefined 展示事件并直接修复。单席用例首次在同回合倒下／获胜的较早恢复处停止，现继续到确有独立存活席位行动再验证恢复。耗尽 PP 的初始新夹具遇到野生 Teleport 的独立旧接缝，定向改用明确普通攻击种子，仍验证实际挣扎及所有 PP 不变；不据此宣称野生逃离完整支持。为补全任意原招式行的挣扎选择，`2dff92bf` 上刚启动的首轮 `full.tap` 主动中止，没有最终 TAP 计划行；不能算通过。最终只使用 `b4e856a3` 的 `full-final.tap`。

原开发交付 `build/vs02b11r/full3.tap` 的 1059/1059、1115796.162ms 和 `full3.meta` 的运行 HEAD `420d9d63` 已独立核对，其到 `73bcdde2` 的源码／测试无差异；没有 shell 退出码。`full.tap`／`full2.tap` 是不完整运行，不冒充最终通过。上述1059不属于本次修复后的验证。

## 下一片

先接原 wave5 固定 Youngster 遭遇：原 NewBattle／NextEncounter → Trainer／原敌队 → 双方 FIGHT → 原后备补位／胜利 → 整备 → wave6。不得删改 fixedBattles、伪装野生、关闭原训练家限制或用简单替代规则。wave8对手、道馆／Boss、进化、券归属／时机等不在本片中自行扩展；遇未确认策略保留事实并准确报告。完整任务书仅本地忽略。

## 最终收尾
最终源码/测试为b4e856a3bbc97d5d0fafbe1ad51d05713900b6d9，完整串行1068/1068、退出0（1067866.5445ms），不是开发交付的1059或主动中止运行。其后仅提交工程文档；运行时每个src/server/tests blob与最终提交保持一致。相对fddd7cdc的本批11个交付/修复/工程文件做标准凭据模式扫描，私钥/GitHub token/API key/AWS access key模式均未命中；这只是本批有限扫描，不是绝对隐私保证。空白检查通过，SPEC和AGENT任务书保持ignored，构建/日志/房间/资料未提交。工作在独立评审分支，未合并/未推送，main未动。下一批完整任务书仅本地保留，用户浏览器未执行。
