# M3 原 Damage／StatChange／多段续击检查点切片

日期：2026-10-15；起点 `5c9f3e34`（main，工作区干净）。本批未提交、未推送；实时远端查询因本机代理无法连接失败，只核实本地 origin/main 与 HEAD 一致。

后续同日已复用本切片连接无倒下回合队列到下一行动输入停点，见 [后续记录](round-loop-m3-2026-10-15.md)。本页 224 项与末尾“下一步”保留为本切片完成时的历史状态。

## 实际范围与复用

- 直接调用 `src/phases.ts` 的原 DamagePhase.start/applyDamage/end 和 StatChangePhase.start/getStatChangeMessages，不提取第二套伤害或能力阶段公式，不改原单人执行链。
- Damage 的 HP 变化早已由原 Pokemon.apply → damageAndUpdate/damage 完成。本批执行的是伤害数值展示、闪烁、updateInfo 及结束回调；每步显式断言 HP 不再变化。
- 原 StatChange 保留随机能力阶段、Mist 阻挡、自身目标区别、特性倍数、上下限、消息及回调后应用能力阶段的顺序。覆盖 Simple／Contrary 与 Mist 的指定分支，不声称全特性验收。
- 多段续击直接复用原 MoveEffectPhase.start/end 和已有 `nativeEffectDriver`、任务观察器；逐步运行原 Damage → 下一击 MoveEffect → Damage，直到原计数耗尽，或下一项为 Faint。
- 复用 `advanceQueuedRulePhase`、decision v6 codec、原队列和共享 targets 引用、`bindAction`、`runEffect`、正式服务与 `applied-decision-clients` 双端 harness。本批未发现需新增的检查点字段或引用，payload 不升级。
- `tests/fixtures/early-post-damage-reference.json` 从 `5c9f3e34:src/phases.ts` 冻结原 Damage／StatChange 方法；续击对照继续使用此前 `20cd4a3a` 的 MoveEffect 冻结夹具。对照侧保留同一活模型连续执行，恢复侧每步经过生产 codec 再执行；比较完整检查点、事件及 RNG。
- 此前项目的大厅／回放／Host 分叉不适用于本批权威规则切片；early 已有相应原规则与双端基础，无需再迁一套。`E:\pokeregue\pokerogue` 未访问或修改。

## 适配与明确边界

本批 `post-damage-model.mjs` 的 driver **只在 tests 内**。替代项仅为场景渲染服务：声音／数值展示记录事件，tileSprite／mask／sprite 为无规则效果对象，tween／timer 回调在显式队列中排空，updateInfo 返回可观察 Promise。fixedInt 仅提供展示时长占位。没有保存回调、计时器或 Promise，也没有把动画时间作为权威规则时钟。

测试模型载入原 StatChange 的完整 battle-stat 函数和 ArenaTag 依赖；通用 VM helper 增加可选 globals，Phase helper 提供渲染用 BitmapMask 构造器，不改变生产代码。规则任务排空、Phase 完成和 codec 最终校验通过才产生候选；失败保留旧 HP／能力阶段／队列／RNG／个人资源。

FaintPhase 与 FINAL_BOSS 的 Damage 特殊收尾明确不在 driver 支持清单中。致死后只执行先入队的 Damage，然后保留原 Faint 等待后续适配，不跳过、不执行单人胜利／替补／经验分配，也不预设敌我同回合全倒下规则。

本批没有把 Damage／续击接到已有 MoveEnd／TurnEnd 和下一次输入，因此完整回合仍未完成。没有新增生产 driver；`/coop/v1/ws` 默认仍 ADAPTER_UNAVAILABLE，`/`、`/coop.html` 与精灵范围保持。

## 验证

新增 18 项：11 项单端差分／候选故障／异步隔离，7 项真实 WS 恢复／写盘失败。定向测试全部通过。

- 两个拥有者的 Damage 恢复；普通／弱效／强效／OTHER／一击必杀展示标记与 critical，覆盖倒置及直接 updateInfo 路径。展示标记夹具不等于一击必杀招式规则验收。
- 两个拥有者各 8 种能力阶段场景：降低、提升、上下限、多个能力阶段、随机能力阶段、不显示消息、已倒下；另测 Simple、Contrary、Mist 的自身／非自身处理。
- 原 Growl 生成的真实 StatChange 执行；Double Slap 的逐击完整检查点／事件差分，以及首击致死时保留 Faint。
- 原 Phase 完成后注入规则任务失败及最终非法 HP，候选全部丢弃；两个场景的延后任务独立等待，不能互相释放。
- 双端在每个 Damage／续击边界重启并重新应用模型和确认；Growl 在能力阶段变化前后重启，不重复降低。
- Damage、StatChange、下一击的结果写盘失败，房间与持久层保留上一检查点；恢复后与原连续执行一致，HP／计数／RNG 不重复消费。
- 致死 Damage 后两端均保留 Faint，重启不触发胜利或经验／替补处理。

WS 仅用本机随机端口、合成房间及内存持久层，不读取真实房间／存档、不占用 8020。沙箱内回环连接被 EACCES 阻止，获准在沙箱外运行后定向 7/7 通过。未进行浏览器视觉或真实双机验收。

最终完整串行回归 **224/224**、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。构建生成 `dist/index.html`、`dist/coop.html`，仅既有混合导入／大包警告。测试日志在系统临时目录，dist 为忽略输出，不纳入提交。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 下一步

先将已验证的出招／伤害／StatChange／续击／MoveEnd／TurnEnd 串成无倒下分支的下一行动闭环，补全程连续／恢复差分与相同双端故障矩阵；再按 SPEC 单独适配 Faint、回合结束替补和胜利停点。生产无渲染场景、非 FIGHT、复杂机制、原合作 UI 与永久收藏事务仍分别按 M3–M6 推进。
