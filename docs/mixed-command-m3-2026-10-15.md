# M3 混合强制次序与原命令／目标暂停恢复

日期：2026-10-15。HEAD `5c9f3e34`；保留前面三批未提交修改，本批也未提交／未推送。仅在 early 工作，未修改或读取 `E:\pokeregue\pokerogue`。远端当前状态未重新确认。

## 实际完成

前批受限的“前一席需要输入、后一席有排队动作或 Encore”已接入适配测试链路：按原队列启动当前 CommandPhase；真正请求玩家输入时才停在既有 `wait-actions` remaining stage，只等待这一席。收到合法意图后直接执行原 handleCommand，不重跑 start，再依原队列执行后一席的强制动作。

强制招式需要目标时，执行原 SelectTargetPhase 到请求目标的边界，保存为既有 `wait-target` remaining stage；恢复后执行原回调规则并 end，不重新 start。取消目标按原回调把 CommandPhase 排回队首，随后重新请求该席目标，不扣 PP、不推进回合、不交换两席阶段。

## 复用和适配

| 来源 | 复用部分 | 必要适配 |
| --- | --- | --- |
| M2 `phase-continuation.mjs`、`phase-state.mjs` | 已登记的 CommandPhase.wait-actions、SelectTargetPhase.wait-target、完整 current Phase／队列／引用 | 没有新增 remaining、持久字段或版本；使用既有 decision v6、Pokemon v2／roster v3／Phase v1 |
| `decision-state.mjs` | 既有 wait-actions／wait-target 与所有权校验 | 暂停的真实 CommandPhase 可以只等待当前“第一个尚未填命令的席位”；必须匹配已登记 Phase 类型、remaining、场上所属玩家及空命令。目标暂停同时校验 current Phase 的 fieldIndex，不能用任意单席列表绕过原批量决策校验 |
| `rule-phase-runner.mjs` | 独立候选、原 selectNextPhase、规则任务观察、最终 codec 校验 | 增加可信 driver 显式声明的同步 suspendBoundary；只有 completed=false、suspended=true、pendingTasks=0 时才能保存原 current Phase 的等待剩余阶段。默认完成路径不变 |
| `fight-command.mjs` | 前批 advanceCollectedFightCommands 与 resolveFightIntent | 同一候选边界支持已有 wait-target 意图和暂停 current Phase 的恢复；批量模式保留，串行模式可在下一个原 Command／Target 真正请求输入时再次停住 |
| 原 CommandPhase／SelectTargetPhase、prepareQueuedFight／selectEncoreFight、applyTargetSelection | 原 start／handle／end、队首清理、自动动作、目标设置／取消／重新入队 | 继续执行原类；恢复只调用相应剩余部分，不重新 start、不提前计算另一席的命令、不人工调整顺序 |
| 前批 command-cycle-model／round-loop-model 与双端 harness | 原出招、命中、伤害、StatChange、续击、收尾、敌方选择、ACK／落盘／重启 | 测试 driver 增加显式 allowSuspend 模式和一次输入的消费追踪，避免取消后复用旧输入。原批量 driver 的拒绝行为保留为兼容回归，不表示新的串行适配仍缺此功能 |
| 冻结原源码 | `5c9f3e34` 的 Command／Target／Enemy 方法，`7cace491` 提取前的 SelectTarget 回调 | 单端对照保持同一活模型连续执行；恢复侧每步经过生产 codec。目标恢复对照直接编译早期冻结回调体及其原 turnCommand 数据绑定，与生产适配使用的 applyTargetSelection 独立比较 |

此前项目不迁移：early 已有全部对应原命令规则、安全决策层、队列及双端基础；旧 Host 权威流程不能替换当前架构。大厅／回放仍保留为 M4/M5 候选。

## 保存与失败语义

输入停点保留已开始的 original-phase 为 currentPhase，remaining 为 wait-actions 或 wait-target；后续阶段仍在原队列中。没有保存闭包、Promise 或 UI 回调，也不把 Phase 当作尚未开始重新执行。目标回调需要的 command 已在原 Battle codec 中保存，targets 共享引用沿用 v6。

只有原当前阶段完成或形成明确等待、所有登记规则任务清零、候选完整校验通过，才交给正式协调器落盘。暂停、恢复、目标取消或后续自动动作中任何异常／写盘失败，保留上一个 current Phase、remaining、HP／PP／命令／队列／RNG 及已接受输入；重启后重新建立双方确认屏障再继续。

## 验证

新增 15 项：9 项单端原版差分／暂停恢复／故障，6 项真实 WS。定向验证通过：

- queued／Encore × Growl／Tackle 的“手动 0 席 → 强制 1 席”，逐阶段检查点、事件、RNG 与冻结原方法连续执行一致；trace 明确 Command0.start 仅一次，恢复执行 handle，再启动 Command1，次序保持。
- 原无效队首在真正执行 Command1 时才清除；等待 Command0 期间不提前改变另一席队列。
- 双方均手动、双方均强制的原队列；目标需要时只让所属席选择。取消目标回到原 Command 并重新打开目标停点，不重复使用上一条意图。
- 非当前席输入、非法目标、损坏 remaining／current Phase 字段或决策拥有者均拒绝；已开始的 Command／Target 不可伪装为 start。
- 未完成任务、缺少／异步暂停钩子、错误剩余阶段、错误所属席，以及恢复任务拒绝，均不能发布候选。
- 双端在原 Command 暂停和原 Target 暂停处重启，双方恢复实际类并重新提取投影；错误席位提前提交被拒绝，目标取消后再次重启，随后完整运行至下一回合输入。
- Command 暂停写盘失败、Command 恢复写盘失败、Target 恢复写盘失败，精确保留之前的检查点及已接受单席输入；恢复后与原连续执行一致，不重扣 PP 或再次 start。
- 注入已暂停 Command 恢复后的规则任务拒绝，已接受意图仍落盘，current Command 的 remaining 保持原样，修复后重新确认并恢复一次。

最终完整串行回归 **270/270**、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。构建生成 `dist/index.html`、`dist/coop.html`，仅既有混合导入／大包警告。日志保存在系统临时目录，dist 为忽略输出，均不纳入提交。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 边界与下一步

这是可信适配测试链路中的混合次序，不表示完整 M3 或原合作 UI 已验收。普通 FIGHT 批量验证仍保留；新串行模式只在原阶段实际请求输入时开放当前席位，所有本轮命令完成前不进入招式执行，不以包到达先后排序战斗。

仍缺 Faint／回合末替补／胜利、非 FIGHT、完整 Struggle／更多强制招式、复杂特性／持有物／天气／场地／形态／Boss 与生产无渲染场景。下一切片优先沿用原 Faint 及已有替补安全决策；经验归属、蛋券及敌我同回合全倒下未确认规则不得自行决定。

生产 `/coop/v1/ws` 默认保持 ADAPTER_UNAVAILABLE；测试 driver 未接生产。`/`、`/coop.html` 和产品精灵范围保持。WS 仅用本机随机端口、合成房间及内存持久层，不占用 8020，不读取真实房间／存档；未做浏览器视觉或真实双机验收。
