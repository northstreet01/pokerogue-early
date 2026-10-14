# M3 原出招执行与命中判定切片

后续同日工作区已接原伤害/异步效果，累计 195 项、decision v6，见 [最新切片](move-effect-m3-2026-10-14.md)。本文件保留出招/命中阶段的 183 项记录与当时缺口。

日期：2026-10-14。起点 `20cd4a3a`；开始时仅 SPEC、模块计划和交接文档有上一轮未提交的复用清单修改，已保留。本批只在 early 开发，未提交、未推送。M3 仍部分完成，未完成伤害/效果和完整回合。

## 复用记录

| 来源（起点提交） | 本批实际复用 | 必要差异 |
|---|---|---|
| `src/phases.ts` MovePhase.start / MoveEffectPhase.hitCheck（`20cd4a3a`） | 提取为 `src/battle-core/move-action.mjs` 与 `move-hit-check.mjs`，单人原 Phase 调用同一实现 | 原 `this` 改为显式 phase，原导入/构造器作为可信 rules；super.start 和原调试输出留在原 Phase。没有改公式、分支或调用顺序 |
| `src/field/pokemon.ts`、`src/data/move.ts`、`src/data/ability.ts` | 测试恢复实际 Pokemon/MovePhase/MoveEffectPhase；加载完整原招式与特性目录；使用原 Status、PP、队列、历史、能力 dispatcher、RNG 和命中计算 | Pokemon 物种/能力值采用受控夹具；状态展示和帧率调整采用渲染钩子，形态钩子只记录事件，Modifier 集合为空。完整目录加载不代表全招式/特性执行已验收 |
| M2 `decision-state`、`phase-state`、原队列 | 新 `move-action-runner.mjs` 在独立候选上执行一个尚未开始的原出招，保留真实 MoveEffect/MoveEnd 待续对象与引用 | 必须显式提供可信 driver；拒绝当前/standby 已开始阶段、不支持类型、未结束/异步结果以及末尾非法状态；没有默认完整运行器 |
| `tests/coop-native-switch.test.mjs` 双端恢复代码 | 提取为共享 `tests/helpers/applied-decision-clients.mjs`，原换人测试和新出招测试共同使用 | 两端恢复原类并重新提取视图，ACK 可暂存，供服务重启/旧连接测试；未另造协议或另一套 WS harness |
| M1 正式协调器、客户端消费器和 WS fixture | 复用 auto 确认屏障、先落盘后发布、重启原席位、私有资源与摘要验证 | 正式协调器/消息版本没有为本批另改；测试适配器仅运行一个出招阶段，然后保留效果队列 |

此前项目大厅、事件回放和 Host/Client 流程本批未移植：本批只提取 early 权威规则入口，旧 Host 浏览器结算与当前服务器权威边界不同；大厅/回放候选保留给 M4/M5，不能因为本批未移植便从复用清单移除。未访问或修改另一份 pokerogue，未增加跨目录依赖。

## 执行与保存边界

已提取原出招流程：能否行动、禁用招式、特性绕过/重定向、攻击者目标处理、目标可用性、标签流逝、强制队列、形态检查、睡眠/麻痹/冰冻检查、PP/Pressure、Battle.lastMove、原招式条件及天气/地形取消调用、失败历史、效果入队与 MoveEnd 排队。

命中判定保留原自身目标/连击/隐藏标签/忽略命中分支、招式命中率、重力、命中/闪避能力阶段、特性/临时道具提供者调用和 Battle RNG。即使原方法使用首个目标的闪避特性，也按冻结 early 行为保留；不借提取修改规则。

`advanceQueuedMoveAction` 先通过 M2 codec 捕获/恢复独立候选，再按原队列选择一个未开始描述符。driver 明确声明支持并同步运行至出招结束后，清除当前描述符、生成新 decisionId、再次校验；事件和授予才交给现有正式协调器提交。错误或晚期校验失败保留旧队列、PP、状态和随机流。driver 只能操作候选与事件，不能提前写个人收藏或其他外部副作用。

没有保存正在执行的调用栈或 Promise。driver 必须确认当前规则/效果提供者能够同步到达此边界，异步原特性/招式路径需要后续显式阶段适配；不能靠此包装器保证任意原 Phase 都可执行。

## 实际验证

新增 **6 项测试**，完整回归 **183/183**，类型检查、生产构建及 diff 检查通过：

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

- `early-move-execution-reference.json` 保存 `20cd4a3a` 提取前实际 start/hitCheck 方法，独立转译执行，与回接后原 Phase 比较，避免用新函数自比。
- 104 组出招差分：两个所有权席位、四个 seed，覆盖正常出招、倒下、PP 耗尽、禁用、目标离场、强制 NONE/ignorePP 队列、睡眠阻止/解除、麻痹、冰冻、Pressure 和 Mold Breaker；比较事件、队列、PP/状态/历史/lastMove 以及完整检查点。
- 92 组命中差分：双方席位、命中/闪避阶段、Tackle/Swift/Growl、首击/后续连击；比较结果、事件和精确 Battle 随机状态。没有据此声称覆盖全部命中修改特性、道具或天气。
- 候选执行校验：MoveEffect 的 move 保持 roster 招式对象，targets 保持 Battle 命令数组；缺 driver、不支持阶段、未结束或末尾非法状态均不改旧上下文。
- 3 项真实 WS：两席出招各一项，单端 ACK 后重启、拒绝旧连接 ACK、双方重新应用模型后仅扣一次 PP、提交后再重启不重放；结果写盘失败保留旧队列，恢复后提交与未中断执行相同的事件/状态。
- 使用合成房间、隔离持久层和本机随机端口，没有读取个人存档或占用 8020。构建生成 index.html/coop.html，只有既有 chunk/混合导入警告；未执行浏览器单人操作或真实双机验收。

## 下一切片

继续原 MoveEffectPhase.start 与 Pokemon.apply：先明确目标结算、伤害、保护、命中失败、效果属性、连击及执行后的阶段入队顺序，复用原实现，建立一次伤害/效果的原版差分和同一 WS 重启/写盘失败验证。同步审计新实际执行形成的历史、命令和 Phase 可变引用；有新引用即补 codec，不因现有 M2 测试通过而忽略执行中生成的状态。

随后接 MoveEnd/TurnEnd、进场/形态/完整特性、全量 AI、非 FIGHT 行动和安全交互停点，最终组成完整回合。当前测试 driver 的场景钩子不能作为生产提供者；正式 `/coop/v1/ws` 默认仍 ADAPTER_UNAVAILABLE，`/` 与 `/coop.html` 入口保持，没有精灵种类/世代限制。
