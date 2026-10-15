# M3 个人替补入场到下一行动输入

日期：2026-10-15。HEAD 仍 `5c9f3e34`，保留前五批修改；本批也未提交／未推送。只在 early 开发，未操作 `E:\pokeregue\pokerogue`。远端实时状态未核对。

## 实际完成

前批的原 SwitchPhase.wait-switch 已接合法个人替补意图：在独立候选中校验所属席、稳定 Pokemon ID 和原个人队伍索引，恢复原菜单回调规则并结束已开始的 Switch，不重新 start。随后按原 prepend 队列运行原 SwitchSummon.start／preSummon／switchAndSummon，保留个人队伍交换、旧实例引用和场上位置。

沿用 M2 的 summon-initialize／summon-finish：入场展示的逻辑边界分别执行原 resetSummonData 和原 end／onEnd／queuePostSummon。原 PostSummon 的场地陷阱与特性分派、原 TurnInit 和原 Command 随后执行，到下一真实 FIGHT 输入。没有插入 test-continue，没有提前跳过第二席替补；双方依次替补时，两次选择与入场均遵循原队列。

已验证双方替补后再完成一个真实 FIGHT 回合，经过玩家命令、目标、敌方 AI、伤害与收尾，回到下一输入。原 PostSummon 撒菱伤害也已覆盖：非致死时不重复扣血，致死时执行原 Damage／玩家 Faint 后再次选择剩余个人替补。

## 复用来源与必要差异

| 来源 | 已复用 | 适配差异 |
| --- | --- | --- |
| M2 `switch-command.mjs` | createForcedSwitchDecision／resolveForcedSwitchIntent、原 selectSwitchSummon | 网络仍提交稳定实例 ID。原个人队伍只有一个本地场上槽，回调按 local fieldIndex=0／battlerCount=1 处理；全局所属席保存在当前 Switch、队列 Phase scope 和 roster.field，不压位另一玩家 |
| 新 `forced-switch-runner.mjs` | 现有候选／codec／纯校验／任务清零／失败回退契约 | 只接已暂停的单席、modal=true／doReturn=false 原 Switch；要求完整输入，验证后调用可信 resumeSwitch。原回调完成且无任务时，清 current 并保留原新排入的 SwitchSummon。此模块不实现换人规则或队伍交换 |
| `rule-phase-runner.mjs` 与 M2 remaining | 独立候选、真实 Phase、原 selectNextPhase、既有阶段白名单 | 对 continuing/switch 的当前阶段要求显式 driver.resume；绝不落入 execute/start。暂停仍由同步 suspendBoundary 声明，继续保留 current Phase，codec 校验类型与剩余阶段；默认无 current 的原 effects 路径保留 |
| `tests/helpers/native-switch-model.mjs` | 前批已有的原 preSummon／switchAndSummon／onEnd，以及展示逻辑边界 | 增加 managed 模式复用于组合 driver：调用原 start／end、登记规则任务，完成后由公共运行器处理决策和 current；旧独立测试的继续选项保留作兼容验证，组合 driver 不使用它。排队改用原 prepend／push helper 并保留所属席 scope |
| 原 SwitchSummon／Summon／PostSummon | 真正队伍交换、旧实例保存、初始化、结束、原陷阱和特性分派 | 复用已有无渲染展示 hook；入场初始化与收尾分开保存，不持久化动画、闭包或 Promise。受控 form hook 仍不执行复杂形态变化；shiny／接棒／主动换人不在本批范围 |
| 前批 Faint／cycle／round driver 和同一双端 harness | 玩家倒下、个人全灭、原命令／目标／AI／效果／收尾、ACK／持久化／恢复 | 仅组合并补替补输入与中间阶段；没有复制战斗调度。夹具的个人备用 Pokemon 清除默认测试状态，使普通无状态新回合与声明范围一致；没有修改产品状态规则 |
| 冻结原源码 | `5c9f3e34` 的 Summon／SwitchSummon／PostSummon 方法；`7cace491` 原 Switch 回调；`8758a080` 提取前的 Switch.onEnd | 连续对照直接编译原回调体及提取前的收尾体，恢复侧使用 selectSwitchSummon／finishSwitchSummon 与生产 codec。两边只共享明确的展示边界和所属席映射，不用新 helper 自己当独立规则基准 |

M2 已有的完整队列、场上引用、原 Phase scope、lastPokemon 和 personal roster 直接复用；decision 仍 v6，Pokemon v2／roster v3／Phase v1，无新增持久字段。此前项目未迁移，因为 early 原换人规则、M2 状态和现有双端测试均已具备；旧 Host 运行流程不适用于当前权威架构。

## 验证

新增 19 项：10 项单端、9 项真实 WS。最终完整串行回归 **305/305**、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。构建仅有既有混合导入／大包警告；日志保存在系统临时目录，dist 为忽略输出，均不纳入提交。

- 两席 × 单方／双方替补，从选择、交换、初始化、收尾、PostSummon 到下一 Command，每步 JSON 保存恢复的模型、队列、事件和 RNG 与连续原方法一致。
- 被选队员成为所属席 index=0，旧队员交换到原槽；另一席不被搬动。原初始化／收尾重置召唤数据，原 TurnInit 登记新参战成员；旧队员的 FAINT 状态保持。
- 双方替补后完成一个真实新回合，不生成测试继续动作；新场上精灵按原规则使用一次 PP。
- 原撒菱非致死入场和致死后再次替补，检查 HP、队列、事件和回合不被提前推进。
- 错席、过期／倒下／非个人实例、额外字段、缺少输入、非法 current 阶段拒绝；未完成任务、替换 continuation 或非法候选不发布。
- 当前入场阶段缺少 resume 则拒绝；提供 resume 时 execute 不被调用。篡改阶段所属席被拒绝，回调、交换、初始化、收尾、入场任务失败保留原检查点。
- 双端每个原阶段均重启服务并恢复实际模型；单方替补、双方替补后完整新回合均检查两席投影和事件。错席／倒下实例／过期输入不能执行。
- 替补回调、队伍交换、初始化、收尾、PostSummon 五处写盘失败，保留旧模型、已接受输入或准确 remaining；重启重新 ACK 后只推进一次。另测入场收尾任务拒绝，不能发布已部分清理的候选。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 仍缺与下一批

本批是普通无修饰器、非闪光、非接棒、已声明状态和陷阱案例的可信适配测试链路。没有验收完整特性、所有陷阱／持有物、主动 POKEMON／BALL／RUN、复杂形态或 Boss。原 PostSummon 分派已运行，但它不是全特性覆盖的证明。

敌方 Faint／Victory 与经验授予仍未接；敌我同回合全倒下的顺序、经验参与归属、蛋券归属不得自行决定。下一批优先核对敌方 Faint 的可独立结算部分和安全胜利边界，再按 SPEC 推进。双方全灭仍仅验证安全 ended 决策，不代表 GameOver 后续事务已完整实现。

生产无渲染场景、全量合法行动／目标提供者、完整 RNG 绑定与正式 WS 接入仍缺。生产 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE，测试 driver 不挂生产。M3／FAINT-01／TARGET-01 等不整体验收；`/`、`/coop.html` 和产品精灵范围保持，没有浏览器视觉／真实双机验收。

双端测试使用合成房间、内存存储和本机随机端口，不占 8020，不读取真实房间／恢复令牌／存档；日志为系统临时输出，dist 忽略，均不纳入提交。
