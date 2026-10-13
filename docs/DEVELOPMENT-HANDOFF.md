# 新窗口开发交接

更新：2026-10-14。用户要求“完成 M2 后提交”。本批完成 M2 安全停点状态层，在 main 提交；未推送。实际提交号、未提交修改及远程同步状态必须重新读取 Git。

## 当前停在哪里

- 开发基点 `8758a080`；此前本地相对 origin/main ahead 3。本批增加原 Phase/队列、可变引用、安全交互停点和正式协调器 incremental/auto 推进模式。
- 最终 177/177 自动测试、类型检查和生产构建通过，范围与命令见 [M2 验收记录](m2-checkpoints-2026-10-14.md)。M2 的完成表示安全停点状态层验收，不表示完整 M3 战斗运行器、原合作 UI 或真实双机已完成。
- decision payload v5、Pokemon v2、roster v3、original Phase v1；M1 envelope 不变。旧检查点明确拒绝，未静默迁移或覆盖。
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
2. [架构](coop-architecture-2026-10-13.md)、[计划](coop-development-plan.md)：权威边界、接口和 M1–M8 依赖。
3. [M2 当前验收](m2-checkpoints-2026-10-14.md)：字段/引用/安全停点、177 项证据、测试范围和 M3 缺口。
4. 按需查看历史 [队列/换人收尾](phase-continuation-m2-2026-10-13.md)、[共享标签](shared-tag-checkpoints-m2-2026-10-13.md)、[决策随机流](decision-random-checkpoints-m2-2026-10-13.md)、Pokemon/Trainer/Modifier 记录；旧版本/数量属于当时状态。
5. [语言适配](upstream-localization-2026-10-13.md)、[实验页](../COOP.md)：维护扩展，保持原内容和独立入口。

## 下一步工作安排

1. M3：接可信权威原推进器与 `src/original-phase-checkpoints.ts`，以 Move/MoveEffect 和一回合闭环为下一有界切片；复用原公式/方法，显式进入/恢复安全停点。
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

> 请先读取 E:\pokeregue\pokerogue-early\docs\DEVELOPMENT-HANDOFF.md，核对 Git 和当前 main 提交。M2 安全停点状态层已完成并按要求提交，未推送；177 项测试、类型检查和构建证据见 docs/m2-checkpoints-2026-10-14.md。下一步从 M3 原 Move/MoveEffect 与一回合权威推进器开始，复用生产状态 codec 和安全停点，不重复做 M2 字段层。保持 / 和 /coop.html，缺完整运行器仍明确拒绝；不限制原精灵内容，不修改另一份 pokerogue。先恢复上下文，按我的下一条指令决定是否开发。
