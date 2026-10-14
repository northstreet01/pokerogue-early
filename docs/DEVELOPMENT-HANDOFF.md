# 新窗口开发交接

更新：2026-10-14。M2 已在 main 提交为 `20cd4a3a`，未推送；工作区另有复用清单及 M3 出招／伤害／异步效果和独立 MoveEnd／TurnEnd 切片，206 项验证通过，未提交。本地相对 origin/main ahead 4，未刷新远程；实际状态必须重新读取 Git。

## 当前停在哪里

- 最新 M3 切片直接复用原 MoveEnd／TurnEnd、Battle.incrementTurn 和标签／天气／场地倒计时。新增逐个原 Phase 的独立候选推进，任务失败或无效候选保留旧状态；6 组原连续执行／逐步恢复差分、3 项双端 WS 重启／写盘失败及 2 项候选故障测试通过。累计 **206/206**、类型检查、生产构建通过，尚未提交／推送，decision 仍为 v6。本批是独立收尾切片，尚未连通 Damage／StatChange／Faint／多段攻击到下一行动停点，完整 M3 仍部分完成。测试 driver 未挂载生产，`/` 与 `/coop.html` 保持原行为。见 [当前记录](turn-end-m3-2026-10-14.md)。以下 195／183／177 项为历史切片。

- 最新工作区已连续执行原出招→一次实际伤害，新增场景隔离规则 Promise 观察与失败回滚；decision v6 保存历史/命令 targets 的真实共享引用，v5 拒绝且不重写。195/195 回归、类型检查、构建通过；见 [最新原伤害/效果记录](move-effect-m3-2026-10-14.md)。全量 M3 尚缺后续规则 Phase、TurnEnd 和生产场景服务。以下 183/177 项属于前切片。

- 最新工作区在 `20cd4a3a` 上新增 M3 出招/命中切片，连同此前复用清单修改尚未提交、未推送。183/183 回归、类型检查和构建通过；104 组原出招、92 组命中差分及 3 项 WS 重启/故障证据见 [本批记录](move-action-m3-2026-10-14.md)。保留未提交修改，不重复实现这两个入口；下一切片为 MoveEffectPhase.start/Pokemon.apply 的一次目标伤害/效果。

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
- 用户批准的是完成 M2 后提交；本批不推送。后续推送需明确当前授权并遵守工具审批，不能绕过拒绝。
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

> 请先读取 E:\pokeregue\pokerogue-early\docs\DEVELOPMENT-HANDOFF.md，核对 Git 和当前 main 提交。M2 安全停点状态层已完成并按要求提交，未推送；177 项测试、类型检查和构建证据见 docs/m2-checkpoints-2026-10-14.md。开发前必读 SPEC 第 4.5 节复用清单，每批记录复用来源、差异和验证，不复用须说明原因。下一步从 M3 原 Move/MoveEffect 与一回合权威推进器开始，复用原规则、生产状态 codec 和安全停点，不重复做 M2 字段层；后续 UI 优先适配已有大厅/回放/原界面。保持 / 和 /coop.html，缺完整运行器仍明确拒绝；不限制原精灵内容，另一份 pokerogue 仅只读参考。先恢复上下文，按我的下一条指令决定是否开发。

> 最新补充：工作区已新增 M3 出招/命中切片，与复用清单一起尚未提交；183 项回归、类型检查与构建通过。先读 docs/move-action-m3-2026-10-14.md，保留所有未提交变化，下一步接 MoveEffectPhase.start/Pokemon.apply 的一次目标伤害/效果，不重复提取 MovePhase.start/hitCheck。

> 当前补充（覆盖上一条下一步）：工作区又接原伤害/异步效果，195 项、类型检查和构建通过，仍未提交/推送；先读 docs/move-effect-m3-2026-10-14.md。decision v6 保留新实际执行生成的命令/历史引用；规则任务拒绝不能被 allSettled 隐藏。下一步接待续 MoveEnd/StatChange/Faint/下一击及 TurnEnd，保留所有未提交变化，不重新做已验证切片。

> 最新补充（覆盖此前下一步）：先读 docs/turn-end-m3-2026-10-14.md。原 MoveEnd／TurnEnd 独立切片已验证，206/206、类型检查和构建通过，未提交／推送。保留已有出招／伤害、独立 MoveEnd／TurnEnd、advanceQueuedRulePhase、v6 codec 和任务观察器；先接 Damage 展示收尾（不能再次扣 HP）、StatChange 和多段续击，再适配 Faint 替补／胜利停点，连成完整回合。复用现有双端 harness，审计新生成引用，不替未确认的经验归属或同回合全倒下规则作决定。保留全部未提交修改。
