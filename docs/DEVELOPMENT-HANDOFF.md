# 新窗口开发交接

更新：2026-10-13。本次只整理文档，不启动开发、不创建新聊天。新窗口先恢复上下文，再按用户指令继续。

## 当前停在哪里

- 本地 main 最新代码：`8b5a3716`（跨精灵共享标签检查点修复）。开始整理时工作区干净。
- 上一代码批：`9f295062`（交互决策、房间随机源及奖励池状态）；其后 `cc1dd5de` 保存暂停点与已批准规则。
- 本次只读核对远程 main 仍为 `9f295062`。`cc1dd5de`、`8b5a3716` 尚未推送；本次文档整理提交也仅保存在本地。后续必须重新核对 Git，不能假定远程已同步。
- 最新批的既有验证记录：135/135 自动测试、类型检查、生产构建通过。本次文档整理未重跑代码测试，仅检查文档差异、链接及一致性。
- **M2 仍部分完成，CHECKPOINT-01 未验收。原游戏完整合作战斗尚不可用。**

## 工作目录与保护边界

- 只在 `E:\pokeregue\pokerogue-early` 开发；远程 `https://github.com/northstreet01/pokerogue-early.git`，分支 `main`。
- `E:\pokeregue\pokerogue` 是另一份含用户未上传工作的目录，不能重置、清理或批量覆盖；移植扩展时只读参考并记录来源。
- 接手先读 `git status --short`、`git log -5 --oneline` 和远程同步状态。禁止强制拉取、reset、清理用户修改。
- 发布排除房间数据、恢复凭据、个人备份、环境秘密、node_modules、构建和临时审计输出；不得读取真实房间生成公开测试夹具。

## 已确认玩法，不要重复询问

- 地图分支：双方选择一致后前进，达成一致前可修改各自选择。
- 战后整备：各自独立整备，双方准备后进入下一战。
- 以上两项已写入 SPEC，但正式运行时和恢复流程尚未实现。
- 经验归属、蛋/券归属、敌我同回合全部倒下的判定等仍见 SPEC 第 8 节；不把实验引擎行为当作批准规则。

## 代码现状

| 范围 | 已有内容 | 仍缺 |
|---|---|---|
| M1 | 正式协议、校验、服务/客户端适配接口、真实 WS 双客户端测试入口；契约层已验收 | 原运行器与游戏 UI 接入不能算作 M1 已完成内容 |
| M2 | Pokemon/Battle/Arena、Trainer、57 类 Modifier、生成型道具类型、个人资源、随机流和奖励池；待行动/目标/替补/学招决策 | 完整待续 Phase、进化、地图、整备、结束及选队完成等停点装配；完整原场景续行 |
| M2 最新修复 | roster v2 的 tagGroups 保留跨精灵共享标签及 primer 引用；错误候选不污染原模型/输入/房间 | 未覆盖所有跨精灵可变对象共享，也未执行完整接棒 Phase |
| M3 | 原行动排序、敌方命令、FIGHT、排队动作/Encore，以及目标/学招/替补局部分支已提取回接 | Move/MoveEffect、完整回合、全量 AI/特性、完整非 FIGHT 执行 |
| M4–M8 | 实验联机、本地存档和协议恢复有基础 | 正式原 UI、整备、收藏、完整恢复、真实双机长期验收 |

版本分别为：通用 M1 envelope 版本不变，decision payload v3，roster payload v2。旧版不兼容检查点明确拒绝，不猜测恢复或覆盖旧保存。

`pendingEffects` 仍只接受空列表。局部交互状态可恢复，不代表携带任意 Phase 队列的完整原场景可恢复。

`/` 是原单人，`/coop.html` 是隔离实验页。`server/coop-service.mjs` 仍调用有限实验引擎。正式 `/coop/v1/ws` 默认没有原版适配器，开局返回 `ADAPTER_UNAVAILABLE`；测试适配器不能接到生产冒充运行器。

## 阅读顺序

1. [SPEC](../SPEC.md)：批准玩法、局外收藏边界和验收。
2. [架构](coop-architecture-2026-10-13.md)、[模块计划](coop-development-plan.md)：权威边界、协议与模块依赖。
3. [最新共享标签修复](shared-tag-checkpoints-m2-2026-10-13.md)：`8b5a3716` 的范围、135 项验证及限制。
4. [交互与随机状态](decision-random-checkpoints-m2-2026-10-13.md)：`9f295062` 的 payload v3、房间随机源、奖励池与未完成清单。
5. 按需读 [Pokemon](original-pokemon-checkpoints-m2-2026-10-13.md)、[等待行动](wait-action-checkpoints-m2-2026-10-13.md)、[Trainer](trainer-checkpoints-m2-2026-10-13.md)、[Modifier](modifier-checkpoints-m2-2026-10-13.md)、[强制动作](forced-command-m3-2026-10-13.md)。这些是历史批次记录，测试数量不能当当前总数。
6. [语言适配](upstream-localization-2026-10-13.md)、[实验页说明](../COOP.md)：保留已有扩展与原内容。

## 再次开发时的下一步

1. 不重复已有 Pokemon/Battle 切片。先列原 Phase 的 prepend/deferred/standby 与交互后续处理，设计显式可恢复状态；不得直接 JSON 化函数或 UI 回调。
2. 补完整待续序列与进化等停点；按已批准规则补地图一致选择、独立整备与双方准备状态，记录修改选择、重连、单方准备和重启场景。
3. 每个切片同时做原版未中断/恢复继续差分和真实 WS 两端模型恢复/提取确认；保留单方输入、重发、写盘失败及损坏模型的故障矩阵。
4. 注意原 `getMoveTargets` 的随机目标分支会消耗 Battle RNG，不能直接用作无副作用的网络校验提供者。现有受控测试提供者不是全招式合法性验收。
5. 区分接口、检查点、原运行器、UI、浏览器与真实双机的完成状态。整个模块未完成时不得因局部测试通过而勾选验收。

## 检查与服务

~~~powershell
Set-Location E:\pokeregue\pokerogue-early
git status --short
git log -5 --oneline
git rev-list --left-right --count HEAD...origin/main
npm run typecheck
node --test tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run build
~~~

按变更范围执行；文档变更仅检查差异、链接和一致性。开发/生产服务默认 8020，先查已有进程，不占端口或停掉用户游戏。测试用临时端口、隔离档案和合成房间。仅上传 dist 不足以运行 Node 联机。

## 可直接发送给新窗口

> 请先读取 E:\pokeregue\pokerogue-early\docs\DEVELOPMENT-HANDOFF.md，并核对 Git 状态、最近提交与远程同步情况。最新代码提交 8b5a3716，既有验证记录 135 项测试、类型检查和构建通过，完整 M2 仍未验收。地图规则已确定为双方选择一致后前进、可修改选择；战后各自独立整备、双方准备后进入下一战，不要重复询问。本次先恢复上下文并说明下一步，不自行启动开发；我明确要求继续后，再补完整 Phase 待续序列和剩余安全停点，保持原版规则、独立收藏和真实 WS 双端恢复测试，不修改另一份 pokerogue 目录。
