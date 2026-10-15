# M3 无倒下回合队列到下一行动输入停点

日期：2026-10-15。起点 HEAD `5c9f3e34`，保留上一批 Damage／StatChange／续击及文档的全部未提交修改；本批也未提交、未推送。只修改 early，未访问或修改另一份 `E:\pokeregue\pokerogue`。本批按用户要求复用原规则和现有运行器，未重写回合规则或新增一套调度器。

后续同日已把双方新 FIGHT 输入经原 Command／Target／Enemy 接回既有队列，形成普通无倒下连续回合，见 [后续记录](command-cycle-m3-2026-10-15.md)。本页 239 项及“下一回合输入执行仍缺”保留为本切片完成时的历史边界。

## 复用与必要适配

| 来源 | 本批复用 | 适配与边界 |
| --- | --- | --- |
| `5c9f3e34:src/phases.ts` | 直接执行原 TurnStartPhase、TurnInitPhase、MessagePhase，及原 FieldPhase.getOrder | 新夹具冻结三个 Phase 的方法；原排序已由此前冻结差分验证，不新增排序规则 |
| 原 BattleScene.shiftPhase/populatePhaseQueue 与 `src/battle-core/phase-queue.mjs` | 原 selectNextPhase 顺序、prepend/splice、队列耗尽后追加 TurnInit 的 helper | 包装为现有 descriptor；保留 nextCommandPhaseQueue。未复制或手写各行动的执行顺序 |
| 原 TurnInitPhase.start | addParticipant、resetTurnData，按原场上顺序排入 CommandPhase／EnemyCommandPhase／TurnStartPhase | 在首个玩家 CommandPhase 尚未开始时暴露已有 wait-actions 停点，原后续队列保持未执行 |
| 当前 MovePhase／MoveEffect／Damage／StatChange／MoveEnd／TurnEnd | 复用 `nativeMoveDriver`、`postDamageDriver`、`cleanupDriver` 与现有异步任务观察 | 每次只执行一个原 Phase；保留原入队、命中／伤害／PP／能力阶段／连击／收尾逻辑 |
| `src/battle-core/rule-phase-runner.mjs` | 既有独立候选、任务清零、完成校验及 codec 最终校验 | 只增加可选同步 `finishBoundary`：规则任务全部结束后，让可信适配器完成原队列边界并返回下一 decision。无 hook 的旧 driver 保持原行为 |
| `fight-command.mjs`、原 `getMoveTargets`、decision v6 | 下次输入的拥有者、精灵、招式可用性与合法目标；保留命令／历史／Phase targets 引用 | 测试菜单只枚举本批三种确定性目标招式，不使用 test-continue 伪行动。随机目标及完整生产合法行动提供者仍待后续 |
| 现有正式 WS 服务、safeAdapter 投影、applied-decision-clients | 原持久化／ACK／重连／输入去重和双端实际模型提取 | 沿用同一真实 WS harness，未新建房间或确认系统 |

上一批 `post-damage-model.mjs` 尚未提交，本批直接调用它；未将同样的渲染服务再实现一遍。此前项目大厅、展示回放及 Host 权威流程不在本批规则适配范围，early 已具备原规则／队列／检查点／双端基础，因此无需迁移，M4/M5 复用候选保持。

## 实际执行链与输入边界

入口为本轮命令已收齐的原 TurnStartPhase。原速度／优先级顺序排出双方与敌方 FIGHT，后续原 MovePhase 自行排入效果和 MoveEnd；效果自行排入 Damage、StatChange 或后续命中。全部行动后执行原 TurnEnd，Battle.incrementTurn 只调用一次、命令清空；队列耗尽复用原 populatePhaseQueue，执行原 TurnInit，重置 turnData。

下一停点为 wait-actions。两个玩家 CommandPhase、EnemyCommandPhase 和 TurnStartPhase 都保留为未开始队列，current／standby 均为空；不启动原浏览器 Command UI，不代替玩家选行动。下一次自动推进在此拒绝，必须按决策收集新输入。

共享 runner 的 finishBoundary 必须为同步可信适配；异步函数、Promise 结果、错误 decisionId、替换 continuation、非法最终模型均拒绝，旧上下文不变。最终 decision 仍经原 codec 严格校验，版本保持 v6，没有增加新持久化字段。

## 验证与范围

新增 15 项：10 项单端回合差分／失败边界，5 项真实 WS 恢复／写盘失败。定向验证通过：

- 两个拥有者 × Tackle／Growl／Double Slap，原连续活模型与逐 Phase JSON 保存恢复比较每步完整 checkpoint、事件和 RNG；包含敌方声明的真实 FIGHT 命令。
- 原 TurnEnd 后禁用结束消息先执行，再进入 TurnInit；不因为队列还有 Message 就提前开放输入。
- 最终双方存活、每个行动 PP 仅消费一次、回合只加一、旧命令全清空、Battle RNG 状态按原方法重置、各精灵 turnCount 只加一，turnData 的原默认 undefined 值保持。
- 最终队列严格为两个玩家 CommandPhase、EnemyCommandPhase、TurnStartPhase；合法下次 FIGHT 可校验，跨席动作被拒绝，生成选项和校验不消费 RNG／PP。
- 输入停点适配抛错、非法决策／HP、异步 hook、错误 ID 或替换队列，原 HP／PP／队列／RNG 保留。
- Faint 明确不执行，不插入单人胜利／替补／经验规则；FINAL_BOSS 也不在本批 driver 支持范围。
- 双端从各自实际模型提取投影，经过伤害／续击或能力阶段／TurnEnd／TurnInit 的重启，与原连续执行每步一致；下次输入的一方行动先落盘，重启后保留，重发不重扣 PP／RNG。
- TurnStart、TurnEnd、TurnInit 结果写盘失败，房间与持久层保留原检查点，恢复后只推进一次并到同一下次输入。

最终完整串行回归 **239/239**、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。构建生成 `dist/index.html` 与 `dist/coop.html`，仅既有混合导入／大包警告。全量命令与前批保持同一入口；临时日志在系统临时目录，构建输出未纳入提交。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

本批测试场景使用受控种类／能力值和三种招式，HP 能力值调高仅为构造无倒下夹具。无持有物、无天气／场地／异常到期或复杂特性。敌方本轮命令在入口显式给定，不据此声称本批接通完整敌方 AI。下一回合的两个新输入收齐后继续执行尚待命令采集适配；本批止于下一次输入开放及单方输入持久化。

WS 仅使用合成房间、内存持久层和本机随机端口，不占用 8020，不读取真实房间／存档。未进行浏览器视觉或真实双机验收。

## 仍未完成

本批完成的是适配测试链路内的无倒下原回合到下一输入停点，不是完整 M3 验收。生产无渲染场景与完整合法行动／目标提供者仍未安装，正式 `/coop/v1/ws` 默认保持 ADAPTER_UNAVAILABLE；`/`、`/coop.html` 原行为保持，未限制产品精灵种类／世代。

后续复用当前队列和采集切片继续：新回合命令采集及强制动作／敌方决策；Faint 的回合末替补、合作胜利边界；非 FIGHT 和复杂机制；最后完整生产 driver。经验／蛋券归属及敌我同回合全倒下仍按 SPEC 未确认项处理，不自行定案。原合作 UI 与永久收藏继续属于 M4–M6。
