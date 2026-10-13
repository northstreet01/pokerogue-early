# 新窗口开发交接

更新：2026-10-13。本文件用于打开新窗口后的上下文恢复，不代表已创建新聊天或启动下一阶段。

## 最新交接（2026-10-13）

用户已重新授权继续有界 Pokemon/Battle 检查点切片。起点 `cc1dd5de`；本轮补跨精灵共享标签引用，roster payload v2，135 项回归及类型检查通过。本批随 `fix: preserve shared Pokemon tags across checkpoints` 提交，远程状态以 Git 核验为准，完整 M2 未验收。读取 [最新范围及证据](shared-tag-checkpoints-m2-2026-10-13.md)，先检查工作区，保留本轮改动。后文暂停和等待答复均为历史记录。

## 历史暂停点（2026-10-13）

用户明确要求“先停止，保存目前进度”，开发已暂停，不自动继续下一阶段。

- 最新代码提交为 `9f295062`，已推送 main；130 项自动测试、类型检查和构建通过，M2 仍未整模块验收。
- 用户刚确认：地图分支双方选择一致后前进，可修改选择；战后各自独立整备，双方准备后进入下一战。
- 本次恢复后只进行了只读检查；收到暂停指令前未新增运行时代码。当前保存仅更新需求及交接文档。
- 再次获准继续时，先核对 Git 状态，再补完整待续 Phase、进化等停点，以及上述地图/整备规则的状态与恢复测试。不再重复询问已确认的两项规则。
- 下文“等待地图/整备答复”等表述是历史记录，以本节与 SPEC 第 8 节为准。

## 工作目录与起点

- 只在 `E:\pokeregue\pokerogue-early` 开发；远程 `https://github.com/northstreet01/pokerogue-early.git`，分支 `main`。
- M1 与 M2 各批至 `c50d5cba` 已推送；M3 首批提交号读取最新 Git。接手先查 Git 状态和最新提交，不假定工作区无后续修改。
- `E:\pokeregue\pokerogue` 是另一份含用户未上传工作的新版目录，不能重置、清理或批量覆盖。需要移植扩展时只读参考并记录来源。
- 接手先读 `git status --short`、`git log -5 --oneline`；不要假定用户之后没有修改，不做强制拉取、reset 或清理。
- 发布排除服务器房间数据、恢复凭据、个人备份、环境秘密、node_modules、构建和临时审计输出。不要读取真实房间文件来生成公开测试夹具。

## 阅读顺序

1. [SPEC](../SPEC.md)：批准玩法、永久收藏边界、真实进度、验收与未决问题。
2. [联机架构与接口](coop-architecture-2026-10-13.md)：权威边界、消息、状态/恢复接口、安全停点。
3. [模块计划](coop-development-plan.md)：M1–M8 依赖、验收和双端测试安排。
4. [B1](original-battle-integration-2026-10-13.md) 与 [B2](original-state-checkpoints-2026-10-13.md)：已提取的原版规则、状态组件和缺口。
5. [语言适配](upstream-localization-2026-10-13.md)、[实验页说明](../COOP.md)：保留现有扩展与理解实验边界。

## 已完成与未完成

已存在 Node/WebSocket 房间、去重/确认/持久化基础，本地档案与备份，B1 局部纯规则，B2 效果/RNG 状态组件，首批上游中英语言适配。M1 已新增正式契约、适配入口和 12 项协议测试，连同原有 63 项共 75 项通过；详见 [M1 记录](coop-contract-m1-2026-10-13.md)。

**原游戏尚未接入完整合作战斗。** `/` 是原单人；`/coop.html` 是隔离实验页。`server/coop-service.mjs` 仍导入 `src/coop/engine.mjs`，不能把这套有限规则当原版运行器。Pokemon/队伍切片及其实际模型 ACK 已有测试，完整场景、全部随机流、决策状态、原 UI 联机与原版合作收藏仍待实现。

正式 `/coop/v1/ws` 已在开发/生产服务挂载，默认无原版适配器，开局返回 `ADAPTER_UNAVAILABLE`。`src/battle-core/coop-contract.mjs` 与类型声明定义正式消息/适配接口；`coop-client.mjs` 从应用后的模型提取并确认。M1 计数器测试仅证明协议；M2 新增原 Pokemon 类的独立双端恢复测试，尚未接入生产原游戏客户端。

## 下一项可执行任务：M2

当前未完成整个模块。基于 `7cace491` 的本轮改动已补 payload v3 的待目标/强制替补/学招、AsyncLocalStorage 房间随机源与八张奖励池表，130 项自动测试通过。先读 [最新记录](decision-random-checkpoints-m2-2026-10-13.md)。`pendingEffects` 仍只接受空列表，下一步完整待续 Phase、进化等安全停点；不能报 M2 已完成。地图/整备问题已发出，等待用户答复；不要自行决定。下文全部是前批历史。

最新 M3 第四批：排队动作准备/Encore 分离并回接单人，网络校验强制要求 Encore 规则提供者，111 项测试通过，见 [第四批记录](forced-command-m3-2026-10-13.md)。下一步强制动作与待目标选择的完整决策上下文；原准备函数已提取，不重复开发。完整回合与其他 M2 停点仍待补。后文为历史记录。

最新 M3 第三批：原玩家 FIGHT 分支提取和严格网络意图校验，累计 108 项测试，见 [第三批记录](fight-command-m3-2026-10-13.md)。下一步强制动作与目标决策状态，再推进 Move/MoveEffect 执行；非 FIGHT 行动与完整运行器仍未完成。后文为历史记录。

最新为 M3 第二批：原 EnemyCommand 决策提取与回接，105 项测试通过，见 [第二批记录](enemy-command-m3-2026-10-13.md)。下一步玩家 Command 合法性/目标选择，再推进 Move/MoveEffect；完整 AI 场景绑定和 M2 其他停点仍未完成。后文为历史记录，提交/推送先查 Git。

当前已进入 M3 首批：原行动排序提取并回接单人，合计 103 项测试、类型检查和构建通过，见 [M3 记录](turn-order-m3-2026-10-13.md)。M2 缺口仍须继续补；下一批从原 Command/EnemyCommand 的受控决策入口及 Move/MoveEffect 规则分离推进，不重复 Modifier 全类登记。下面第四批及更早内容为历史记录。

最新：第四批已补 57 个具体 Modifier 类及八种生成型类型恢复，等待行动 payload v2 保留共享类型引用，101 项测试通过，见 [第四批记录](modifier-checkpoints-m2-2026-10-13.md)。用户已授权提交推送并推进 M3；先做原行动排序切片。M2 Phase/全 RNG/其他停点仍未完成，不能把组件全类型等同于完整检查点验收。后文第三批及之前为历史记录。

第三批已补原 Trainer 生产检查点导出与双端恢复，合计 96 项测试通过，见 [第三批记录](trainer-checkpoints-m2-2026-10-13.md)。下一批优先补 Modifier 全类型及生成型 ModifierType 恢复，再补原 Phase 决策映射与全局 RNG；Trainer 全配置队伍生成与完整场景绑定仍未验收。下文第一、二批为历史记录，不代表当前总测试数。

第二批已增加显式 wait-actions 检查点装配（Battle/Arena/个人资源、组件注册、两随机流、已收输入恢复验证），合计 92 项测试通过。先读 [第二批记录](wait-action-checkpoints-m2-2026-10-13.md)。下一步补全生产 Trainer/Modifier 注册、原 Phase 决策映射及全局 RNG 调用改接；不要重复已实现的装配层，也不要误认为全量场景和完整运行器已完成。下段首批记录保留历史范围。

M2 第一批已完成：原 Pokemon 字段/临时效果/共享引用与队伍所有权、场上稳定 ID、双端原模型恢复；整体仍部分完成。当前 84 项测试、类型检查、构建通过。先读 [M2 记录](original-pokemon-checkpoints-m2-2026-10-13.md)，继续 Battle/场景级资源、全随机流与决策停点装配，不重复首批工作。

1. 阅读 M2 首批字段及停点清单，检查已实现的 Pokemon/队伍切片，再补 Battle/场景、modifier、训练家和资源清单。
2. 按切片补齐本局资源、全部随机流及决策上下文；完整校验后一次替换，失败不污染旧状态，不给 getter 赋值。
3. 每个切片同时做原版未中断/恢复继续差分，并接 M1 真实 WS 两端入口；两端实际恢复原模型后独立提取摘要。
4. 保持 `/` 与实验页行为；完成后更新 SPEC/模块证据，再进入 M3 原规则运行器。不得将测试适配器用于正式游戏。

不需要等完整引擎才能开双端，也不以先开两个页面代替单端原规则差分。两类测试同步开展，浏览器 UI 和真实双机验收另行记录。

## 常用检查

```powershell
Set-Location E:\pokeregue\pokerogue-early
git status --short
git log -5 --oneline
npm run typecheck
npm run test:battle-core
npm run test:coop
npm run test:local-save
npm run test:localization
npm run build
```

按变更范围执行检查；文档变更只需检查差异/链接/一致性。开发 `npm run start` 默认 8020；生产 `npm run build` 后 `npm run start:server` 也默认 8020。先检查已有服务，不能占端口或停掉用户正在玩的进程。浏览器试验用隔离档案和临时房间，不覆盖用户收藏；生产只上传 dist 不足以运行 Node 联机。

## 可直接发送给新窗口的任务

> 在 E:\pokeregue\pokerogue-early 继续完成 M2。先检查 Git 状态与提交记录，读 SPEC、模块计划及 docs/decision-random-checkpoints-m2-2026-10-13.md。最新批已补 payload v3 的目标/替补/学招决策、房间随机源及奖励池表，130 项测试通过，但完整 M2 仍未验收。优先补原 Phase 待续序列及进化等停点；地图共同决策与战后整备方式须采用用户对问题卡的答复，若上下文缺失先查明。不要把空 pendingEffects 的局部模型当成完整场景，也不要把受控 RNG/AI 提供者当正式运行器。每个切片继续原版差分及真实 WS 双端恢复，保持原规则、收藏语义和另一目录未上传工作。用户要求完成一个完整模块再作阶段汇报，不能再次以小切片冒充模块完成。
