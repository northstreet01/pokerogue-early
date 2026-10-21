# VS-02B-11 维护者独立复验

日期：2026-10-21。交付基线 `6512434e`，父链为 `2c66bd32 → 985d4e86 → e568e4e8 → 8c36350b → 51ee4ea1 → 6512434e`。开始时实际分支 `feature/vs02b11-learn-move`，工作区干净，只有一个 Git worktree。可见任务清单没有其他活跃的同项目开发任务；未创建或联系其他 agent。

本次修复在独立本地分支 `review/vs02b11-learn-fix`。代码修复 `05af3938`，测试文件整理 `1d4b9bb7`，随后补学招投影隔离 `f429331d3d4df8c9a960ae771c14b7459e406a4e`；后者为最终源码／测试验证基点。没有合并或推送。main、origin/main 与实时远端 main 均核对为 `86798227ca995c4ff40043b99a0c6846ed177154`。首次远端查询因本机 7897 代理失效失败；禁用代理的沙箱查询又因 DNS 线程失败；沙箱外只读直连查询成功，未 fetch 或修改远端配置。

## 结论与范围

- **A 整批部分通过**。已独立验证真实生产 Worker 学招自动分支、双席替换／放弃、原 EXP→LevelUp→LearnMove、JSON／Worker 恢复；正式双 WS＋FormalRoomStore 的替换／放弃候选写盘失败重试、同目录重启、去重、冲突和房间隔离通过，替换的新招实际进入下一次 FIGHT 并消耗一次 PP。
- **尚未关闭 A 的自然触发门**：EXP 用例的经验量与队列、满四招的初始学招停点均为明确标记的合成夹具；不能冒充正常选队、自然胜利经验、满四招选择、新招战斗的连续生产冒险。自然探索日志遇到 `UNSUPPORTED_NATIVE_ENTRY_PHASE`／`UNSUPPORTED_FORCED_COMMAND`，未取得成功链，不能归为通过。
- **B 部分通过**：原 Confirm／Summary 接线和显示生命周期的自动控制器回归通过，浏览器由用户执行，本轮未执行，不能称双浏览器通过。
- 未扩进化、其它整备奖励、购物／重抽、M6、孵化、地图、部署；不宣称完整 M3／M5／M6／MVP。

## 独立发现及直接修复

1. `progressionContext` 原先把 `phases.capture(...)` 返回的整个描述对象与席位数字比较，所有合法选择都会失败。现读取 `.scope`，并核对原 phase 的个人队伍下标、稳定 pokemonId 与 moveId；执行入口同样先验证保存的 phase。
2. 连续运行器用“谁存在同一队伍下标”推导学招归属，双方均有 index 0 时总会选席位 0。现取既有 `bindPhase` 保存的实际 scope，正确处理席位 1。
3. 手工暂停 LearnMove 前未将已选出的 phase 从持久化队列同步移除，恢复后“放弃学习”又弹同一选择。现 `binding.sync()` 后才保存 currentPhase，不重复保留原队列项。
4. 自动学招原路径需要 UI.getHandler 和浏览器动画资源。通过既有 `presentOnHost` 展示端口隔离动画资源初始化／加载；原 `setMove`、提示回调、form-change hook、phase end 保留。单人没有该端口时仍走原动画资源路径。既有冻结原分支对照未变。
5. 原 PartyMemberPokemonPhase 在后备位置使用 `fieldIndex=-1`，旧 codec 无条件拒绝。只对有合法 partyMemberIndex 的队伍阶段保留原 -1；Command／场位阶段仍要求真实场位，既有所有权检查保留。
6. B 原先直接给无显示资源的 codec 模型套 scene，未初始化／加载原 Summary 所需精灵；回调跨 await、同快照旧菜单、取消和资源清理也不完整。现复用 `makeTeamPokemon`／`createCoopPokemonDisplay`、init/loadAssets、延迟销毁和已有菜单 epoch。新增原二次放弃确认／返回重选，校验服务器 slot/null，逐步阻止旧回调；原验证模型不修改。提交提示改为等待服务器确认，写盘失败重新打开菜单。

复用路径：`src/phases.ts` 原 LearnMovePhase／forgetMove／setMove，`learn-command.mjs`、`progression-choice-runner.mjs`、原 phase codec、正式 adapter／Worker、`SummaryUiMode.LEARN_MOVE`、原 Confirm、既有 outbox／receipt／ACK 及显示副本工厂。另修复 learn-move 的 personal.decision.learn 曾投影给非所属席位：现在只向 required owner 提供载荷，伙伴仅收到公共决策种类及 requiredSeats，选项仍为 null；新增双方投影隔离断言。`f429331d` native 学招 8/8、退出0（4580.117ms）。没有自写学招／PP 公式、客户端本地 setMove 或重新启动已暂停的权威 LearnMove。

## 自动验证与证据

证据仅本地 ignored `build/vs02b11-review/`，不提交日志或真实存档。

| 检查 | 本次结果 |
|---|---|
| native 学招＋既有 level-up／learn-state | 26/26，退出 0，11723.3173ms（投影修复前定向）；投影修复后 native 8/8、退出0、4580.117ms；含合成 EXP 起点和后备 -1，最终版本另由全串行覆盖 |
| 原 UI 控制器全文件 | 49/49，退出 0，6824.9173ms；新增学招 3 项，显示端口是测试端口，不是实际浏览器 |
| 新增正式双 WS／FormalRoomStore 学招 | 2/2，退出 0，13735.9864ms；合成起点，后续正式规则执行和新招 FIGHT 真实 |
| typecheck | 退出 0 |
| build:coop-runtime | 退出 0；最终串行回归也重新构建相同源码 |
| 最终生产 build | 退出 0，51.18s，既有动态导入／chunk 警告 |
| 最终完整串行回归 | **1059/1059，退出0**，`1..1059`，fail/cancelled/skipped/todo均0，1043319.5987ms（约17分23秒）；运行源码／测试HEAD为f429331d |
| 实际双浏览器 | 未执行，待用户；尚无本批自然触发成功的可复用浏览器路径 |

本次最终串行命令为 `node --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`，标准输出／错误合并到 `full-final.tap`，进程结束后直接捕获真实 `$LASTEXITCODE` 到 `full-final-exit.txt`，不是 detached 进程猜测退出码。运行 HEAD 及每个 src/server/tests blob 保存在 `execution-head-final.txt`、`execution-source-blobs-final.txt`。

失败历史保留：最早合成队列漏填原 player／fieldIndex，测试 fixture 被 codec 拒绝，补正确 fixture 后才进入规则；首个真实 Worker 定向 4/6，暴露放弃重复选择，修复队列同步后通过。UI 第一轮 48/49 是故障注入误改 frozen storage 对象，改为替换测试 storage 包装后通过。EXP fixture 初值不够升级及独立冻结分支截取到新增展示声明导致 24/26，按原经验阈值修正 fixture 并把展示声明放回原规则分支后，26/26。正式 WS 首轮 0/2 为沙箱 loopback EACCES，未执行网络断言；沙箱外复跑 2/2。自然探索失败单列，不并入通过数量。开发交付原 1046 项没有新增生产学招用例，且无 shell 退出码，仍只保留其历史含义。

## 剩余工作与用户验收

下一片继续本条链，先取得正常原选队后自然经验触发的生产用例和可复现路径，不直接派发整套进化。现有合成 fixture 保留并明确标记；不要为了过门改等级／经验／HP／奖励或注入 LearnMove 队列。定位阻碍该路径的具体未支持 phase，能局部修复则修复；若涉及完整新机制，停在可解释的失败边界，报告根因，不广泛放开 allowlist 或默认成功。

自然路径通过后，用户浏览器清单为：原选队 → 双方真实战斗 → 自然升级学招 → 满四招原 Confirm／Summary 的取消、重选、替换或二次确认放弃 → 本人权威招式变化／伙伴不变 → 刷新／同目录关闭服务和 Worker 后重启 → 待学招恢复或已选择不重复 → 新招真实 FIGHT → 继续整备／下一战。不得用伪造检查点、运行时改值、隐藏方法调用或跳阶段代替。

用户确认的每人六只、满员原取舍（可放生本人当前前场）、个人蛋和 pending 捕获成果不变。完整下一片任务书仅本地忽略保存，不提交。

自然探索定位补充：learning-natural-1 的 Bulbasaur＋Snorlax 正常战斗路径中，Bulbasaur在升级前倒下；逐原阶段诊断到下一战原 SummonMissingPhase（scope 0、partyMemberIndex 0、fieldIndex 0），被 native-step 以 UNSUPPORTED_RULE_PHASE 拒绝，对应连续运行器 UNSUPPORTED_NATIVE_ENTRY_PHASE。见本地 natural-diagnostic.log。未把该路径写成学招或进化成功，未扩本片为倒下复活／缺员召回整批；下一片先判断真实最短学招路径及这一补位接缝。

完整回归运行历史：1d4b9bb7 首轮 full.tap 在第649项后为补投影隔离主动中止，没有最终TAP计划行，不能算通过；其工具中止退出1不等于规则断言失败。修复f429331d后以 full-final.tap／full-final-exit.txt 重新独立串行运行，不拼接两轮结果。

## 最终收尾核对
最终完整串行属于 f429331d3d4df8c9a960ae771c14b7459e406a4e，不拼接首轮中止日志，也不沿用开发交付1046。最终源码／测试与运行基点一致；其后只更新工程文档。本批相对交接2c66bd32共15个交付／修复／记录文件做凭据模式扫描，标准私钥、GitHub token、API key及AWS access key模式未命中；这是有限扫描，不是绝对隐私保证。空白检查通过；SPEC和AGENT任务书保持ignored，未暂存，未提交数据、构建或日志。收尾再次实时ls-remote核对main仍86798227。A/B整体部分通过；下一片仅关闭自然升级学招生产链，浏览器待用户。
