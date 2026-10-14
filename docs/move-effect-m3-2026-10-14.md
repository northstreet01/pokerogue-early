# M3 原伤害与异步效果边界切片

后续已完成原 MoveEnd／TurnEnd 独立收尾切片，当前 206 项结果及下一步以 [最新记录](turn-end-m3-2026-10-14.md) 为准；本页 195 项和末尾安排保留为历史。

日期：2026-10-14。继续 `20cd4a3a` 上未提交的出招/命中切片和复用文档，不覆盖上一轮修改。本批未提交、未推送，只有 early 目录发生改动。完整 M3 仍未完成。

## 复用与实际变化

| 来源 | 已复用/适配 | 状态 |
|---|---|---|
| 原 `Pokemon.apply`（`20cd4a3a`） | 提取 `src/battle-core/move-damage.mjs`，原 Pokemon.apply 调用相同公式/顺序/可信类型与属性提供者 | 物理/特殊、属性倍率、STAB、暴击、随机伤害、灼烧、固定伤害、状态/免疫、实际 damageAndUpdate/damage 和记录均沿用原代码 |
| 原 MoveEffectPhase.start/end | 直接执行原类，冻结提取前 start/end 作独立对照；保留命中、保护、属性调用、连击计数、历史和后续 Phase | 没有另写伤害引擎，也没有把伤害/倒下/能力阶段/后续命中 Phase 替换为空结算 |
| 原招式/特性属性调度器 | 原 allSettled/属性顺序仍保留；在已注册候选场景中观察规则 Promise | 新 `rule-task-tracker.mjs` 按 scene 的 WeakMap 隔离工作，记录被 allSettled 吞掉的拒绝；等待原局部链完成后拒绝整个候选。未注册单人场景返回原 Promise 对象 |
| M2 codec/原队列 | 新 `move-effect-runner.mjs` 在独立候选上 await 一个未开始的原效果边界、任务耗尽及最终校验 | 必须显式提供可信 driver；不支持阶段、未完成工作、规则失败和晚期非法状态均不替换旧状态 |
| M2 可变引用 | 原效果执行实测产生历史 targets 与 Battle command targets 的共享对象；新增 `command-target-state.mjs` | 覆盖 commands 的 targets/move.targets/args.targets 与 Pokemon 显式规则路径；校验内容、路径、重复、规范顺序和原 roster 别名，不只复制相同数组值 |
| 既有双端 harness | 继续使用 formal WS fixture、applied-decision-clients、正式服务/消费器、auto ACK 屏障及持久化 | 新测试连续跑原出招→实际伤害，并在两阶段之间重启；没有新建另一套协议或客户端状态确认 |

原源码来源记录在 `early-move-effect-reference.json`，基线为 `20cd4a3a`；MoveEffect.start/end 本批仍按原方法执行。此前项目大厅/回放仍待 M4/M5 适配，本批不迁入其 Host 权威或轻量快照；另一份 pokerogue 未访问/修改。

## 候选和异步失败

在 M2 检查点恢复独立候选后，选择下一个原 MoveEffect；driver 绑定候选 scene、执行原 Phase、等待结束和所有已观察的规则任务。Phase.end 不等于可以立刻提交，因为原回调链可能还有返回的特性/招式 Promise。只有 completed、pendingTasks=0、最终模型校验通过，才返回新 decisionId、事件和授予给正式协调器落盘。

观察器不保存 Promise、回调或 WeakMap，不交换全局随机源。原属性返回的 Promise 及调度器返回值均被观察；拒绝被记为本次执行失败，即使原 allSettled 后继续了局部处理，也只能继续修改隔离候选，最终会丢弃。注册、排空及解除绑定由可信 driver 负责，不能将真实收藏副作用提前放进这些回调。

driver 仍须明确支持当前规则/场景服务；任意 UI/modal、外部未登记任务、永久收藏事务和全部机制尚未接入。测试 driver 的动画回调同步化，完整 M3 生产 driver 尚未安装。不能以这个边界包装器宣称任意原 Phase 已可在服务器执行。

## 检查点版本

decision payload **v6** 新增 `commandTargetGroups`。实际原效果会让 `battleSummonData.moveHistory[*].targets` 与当前命令数组共享；此前 v5 恢复会丢失这一新实际执行产生的引用，已有回归复现并修复。Pokemon v2、roster v3、original Phase v1、M1 envelope 保持。

旧 v5 检查点明确 VERSION_MISMATCH，不静默迁移或覆盖。损坏 alias 的 ID/路径、重复节点、不同内容及与 roster 自有别名冲突均拒绝；失败时原模型与输入不变。命令字段先经过原显式数据校验，再遍历共享引用，避免通过 getter 读取非法模型。

## 验证

本批新增 **12 项测试**，累计 **195/195**，类型检查、生产构建与 diff 检查通过：

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

- 48 组原 Pokemon.apply 对照：双方席位、Tackle/Ember/Sonic Boom/Growl、Normal/Grass/Ghost、防御方属性、灼烧；比较 HitResult、事件、实际 HP、伤害/受击记录、随机状态和完整 checkpoint。
- 8 组原异步效果 start/end 差分，另测保护、受控命中失败、目标离场、倒下和 Double Slap 首击；比较实际 Damage/Faint/StatChange/下一击 Phase 及计数，保留它们待后续执行。
- 原历史 targets 与命令共享身份保存/恢复、损坏字段拒绝、v5 拒绝；未完成任务/缺 driver/晚期模型错误/执行抛错保留旧状态。
- 两房间候选交错：Phase.end 后有返回任务时不能提早完成，一房间任务结束不能释放另一房间；未注册单人 Promise 身份不变，候选结束解除观察器。
- 注入真正 MoveEffectAttr 的 Promise 拒绝并先改候选 HP：不能被 allSettled 隐藏，原上下文不变。
- 4 项真实 WS：双方出招→伤害、效果前重启/重新应用和确认、提交后重启不重扣 PP/HP；伤害写盘失败保留已花 PP、未命中 HP/RNG/队列；真实属性拒绝返回 RUNNER_FAILED 并保持命中前保存，恢复后结算一次。

测试载入完整原招式和特性目录，但只执行上述受控案例；物种/能力值仍为小型夹具，Modifier 集合为空，无天气/地形/Boss 夹具。形态、成就及最高伤害统计使用隔离场景钩子/临时对象，不证明 M6 永久统计或图鉴事务已完成。渲染表现钩子不影响原规则结果，未跑浏览器或真实双机。

WS 仅使用本机随机端口和合成持久层，没有读取真实房间或个人存档，没有占用 8020。构建生成 index.html/coop.html，只有既有大 chunk/混合导入警告。生产默认正式服务仍 ADAPTER_UNAVAILABLE，精灵范围未缩减。

## 下一步

处理保留下来的原规则 Phase：MoveEnd、StatChange、Faint、Damage 展示与下一击，然后接 TurnEnd/回合递增和异常/场地结束处理，组成一回合闭环；继续使用相同单端差分和双端恢复入口。扩充真实特性、道具、天气/地形、Boss、目标变化和非 FIGHT 分支；每次实际执行出现新可变引用或安全停点，补 codec 和故障回归。完整权威原 scene 服务、原 UI、永久收藏与真实双机仍按 M3–M8 接入，不安装测试 driver 冒充生产运行器。
