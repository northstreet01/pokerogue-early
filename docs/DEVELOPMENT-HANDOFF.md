# 新窗口开发交接

更新：2026-10-14。M2 提交 `20cd4a3a` 与 M3 代码提交 `f2377193` 已推送至 `origin/main`；206/206 回归、类型检查和构建通过。交接文档随后单独提交；接手仍须读取实际 Git，不仅凭文档假定工作区／远端状态。

## 当前停在哪里

- 最新 M3 切片直接复用原 MoveEnd／TurnEnd、Battle.incrementTurn 和标签／天气／场地倒计时。新增逐个原 Phase 的独立候选推进，任务失败或无效候选保留旧状态；6 组原连续执行／逐步恢复差分、3 项双端 WS 重启／写盘失败及 2 项候选故障测试通过。累计 **206/206**、类型检查、生产构建通过，已汇总提交为 `f2377193` 并推送，decision 仍为 v6。本批是独立收尾切片，尚未连通 Damage／StatChange／Faint／多段攻击到下一行动停点，完整 M3 仍部分完成。测试 driver 未挂载生产，`/` 与 `/coop.html` 保持原行为。见 [当前记录](turn-end-m3-2026-10-14.md)。以下 195／183／177 项为历史切片。

- 历史伤害切片为 195/195，见 [原伤害／效果记录](move-effect-m3-2026-10-14.md)，现已包含在 `f2377193`；其数量／提交状态／下一步属于当时记录。

- 历史出招切片为 183/183，104 组出招、92 组命中差分及 3 项 WS 证据见 [出招记录](move-action-m3-2026-10-14.md)，现已包含在 `f2377193`，不重复实现。

- M2 批次基点 `8758a080`；当时本地相对 origin/main ahead 3。已提交的 M2 增加原 Phase/队列、可变引用、安全交互停点和正式协调器 incremental/auto 推进模式。
- M2 提交的 177/177 自动测试、类型检查和生产构建通过，范围与命令见 [M2 验收记录](m2-checkpoints-2026-10-14.md)。M2 的完成表示安全停点状态层验收，不表示完整 M3 战斗运行器、原合作 UI 或真实双机已完成。
- 当前 decision payload v6（已提交 M2 基线为 v5）、Pokemon v2、roster v3、original Phase v1；M1 envelope 不变。旧检查点明确拒绝，未静默迁移或覆盖。
- 原 Phase 清单覆盖三个源文件 68 个声明/63 个具体类；待续队列六字段、非空 pendingEffects、进化/形态目录引用及共享对象已支持。已开始的 Phase 必须保存剩余阶段，恢复不能重新 start。
- 安全停点包括选队完成、待行动/目标/替补/学招、进化及取消/暂停、地图、独立整备、整备内个人子决策、待续处理和结束。选队完成允许 Battle=null；不会在恢复时生成敌人或重抽选项。
- `/` 为原单人，`/coop.html` 为隔离实验页。正式 `/coop/v1/ws` 默认仍缺 M3 原运行器并返回 ADAPTER_UNAVAILABLE。测试适配器不能接入生产冒充完整规则。

## 工作目录与保护边界

- 只在 `E:\pokeregue\pokerogue-early` 开发；远程 `https://github.com/northstreet01/pokerogue-early.git`，分支 `main`。
- 不修改 `E:\pokeregue\pokerogue`，不重置、清理或覆盖用户工作。
- 接手先读 `git status --short`、`git log -5 --oneline`、`git rev-list --left-right --count HEAD...origin/main`；本地 origin/main 可能过期，不声称远程已同步。
- 用户于 2026-10-14 明确要求本批提交、推送并更新文档；正常快进推送已成功，不强推或绕过审批拒绝。
- 不提交个人房间、恢复凭据、存档、环境秘密、node_modules、dist 和临时测试输出；不要用真实房间生成公开夹具。

## 已确认玩法

地图双方选择一致后前进，一致前可修改；战后各自独立整备，双方准备后继续。状态协调已实现，原 UI 和完整权威下一战推进仍待后续模块。没有因版本限制精灵种类、世代或内容范围；测试小目录是夹具，不是产品限制。

经验归属、蛋/券归属、敌我同回合全部倒下的判定仍按 SPEC 第 8 节处理；不能把实验引擎规则当作用户批准的规则。

## 阅读顺序

1. [SPEC](../SPEC.md)：需求与当前验收，重点第 5/7/8 节。
   开发前必读第 4.5 节：按模块列出的复用来源、适配边界和每批复用记录要求，落实用户节省重复开发工期的要求。
2. [架构](coop-architecture-2026-10-13.md)、[计划](coop-development-plan.md)：权威边界、接口和 M1–M8 依赖。
3. [M2 当前验收](m2-checkpoints-2026-10-14.md)：字段/引用/安全停点、177 项证据、测试范围和 M3 缺口。
   当前优先读 [M3 原收尾](turn-end-m3-2026-10-14.md)：206 项结果、候选推进／回滚、完整回合缺口。
   再读 [M3 原伤害/效果](move-effect-m3-2026-10-14.md)：195 项结果、v6 引用、异步错误及完整回合缺口。
   再读 [M3 最新工作区](move-action-m3-2026-10-14.md)：183 项结果、实际复用、出招和命中边界、仍缺的伤害/效果。
4. 按需查看历史 [队列/换人收尾](phase-continuation-m2-2026-10-13.md)、[共享标签](shared-tag-checkpoints-m2-2026-10-13.md)、[决策随机流](decision-random-checkpoints-m2-2026-10-13.md)、Pokemon/Trainer/Modifier 记录；旧版本/数量属于当时状态。
5. [语言适配](upstream-localization-2026-10-13.md)、[实验页](../COOP.md)：维护扩展，保持原内容和独立入口。

## 下一步工作安排

M3 还剩五部分：伤害后待续 Phase、完整回合闭环、非 FIGHT 实际执行、复杂机制覆盖、生产服务器运行器。详细范围见 [模块计划](coop-development-plan.md#接下来执行方向)。优先前两部分；原合作 UI 属于 M4／M5，不计入 M3。

先按 [SPEC 第 4.5 节](../SPEC.md#45-复用优先与后续开发约束)检查复用来源：M3 用 early 原规则和当前 M1/M2 基础；M4/M5 用原 UI，并适配此前项目的大厅、行动采集和展示回放；M6 用原收藏与本地事务；M7/M8 扩展现有及旧项目测试案例。此前 `E:\pokeregue\pokerogue` 只读，移植记录来源/差异/验证；不用旧 Host 权威和轻量快照替换当前架构。未复用候选须说明具体原因，不从零重写已有系统。

1. M3：保留已有出招／伤害、独立 MoveEnd／TurnEnd、advanceQueuedRulePhase、v6 codec 和任务观察器；先接 Damage 展示收尾（不能再次扣 HP）、StatChange 和多段续击，再适配 Faint 替补／胜利停点，连成完整回合。复用现有双端 harness，审计新生成引用，不替未确认的经验归属或同回合全倒下规则作决定。
2. 提供无副作用合法目标校验和房间 RNG；接原进场特性/场地、持有物、形态及非 FIGHT 效果；不把测试提供者当生产规则。
3. 每一切片都补原版未中断/恢复差分与真实 WS 双端提取确认；延续输入重发、单方输入重启、写盘失败、损坏模型、旧连接 ACK 和两房间隔离矩阵。
4. M4/M5 接原选队/共同战斗/整备 UI，M6 接永久收藏事务；M7 故障矩阵贯穿，M8 用真实双机和长局验收。

## 检查命令

```powershell
Set-Location E:\pokeregue\pokerogue-early
git status --short
git log -5 --oneline
git rev-list --left-right --count HEAD...origin/main
npm run typecheck
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run build
git diff --check
```

本机 WS 测试使用随机端口。先查现有服务，不占用 8020 或停止用户游戏。生产构建有既有 chunk/混合导入警告。并发回归曾出现测试进程无断言详情退出，相关文件单跑通过；最终验收采用串行完整回归，保留此环境限制。

## 可直接发送给新窗口

> 先读 E:\pokeregue\pokerogue-early\docs\DEVELOPMENT-HANDOFF.md，核对 Git 与远程。M2 已提交，M3 出招／伤害／异步效果及独立 MoveEnd／TurnEnd 汇总为 f2377193 并推送，206/206、类型检查和构建通过。必读 SPEC 复用清单，保留已有代码；下一轮先接 Damage 收尾（不再次扣 HP）、StatChange、多段续击，再适配 Faint 替补／胜利，连接完整回合。扩展原版差分及双端 WS 恢复／故障矩阵；不把测试 driver 接生产，不替未确认玩法作决定，保持 / 与 /coop.html，不限制精灵范围，不修改另一份 pokerogue。
