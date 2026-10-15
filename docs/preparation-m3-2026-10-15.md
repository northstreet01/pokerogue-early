# M3 原奖励菜单、个人整备入口与合作诱饵排除

日期：2026-10-15。HEAD `5c9f3e34`，此前全部未提交修改保留；本批未提交／未推送，仅在 early 开发，未操作另一份 pokerogue。缓存 origin/main 与 HEAD 均为此提交，不据此声称实时远端同步。

## 实际完成

无到期蛋分支从原 EggLapse 后的共享 SelectModifier 队列，接入两个所属席各自的原 SelectModifierPhase.start。每个个人实例只 start 一次，直接执行原重置 wave seed、完整道具池阈值重建、奖励抽取、个人道具数量加成和重抽价格，保存已生成的个人奖励／原商店选项及两个原 reward-select 待续实例，交给现有 M2 preparation 状态协调。第二席或异步任务失败时，第一席已抽取的结果和 RNG／池表均不发布。

本批可执行的个人整备意图是确认跳过奖励、准备、取消准备。全部复用 M2 applySafeDecisionAction；任一玩家尚未处理奖励，不能准备；一席准备后另一席仍可独立操作。双方准备后只清理本批两个个人菜单待续，保留原未开始的 NewBattle 队列，保存 continuing／next-battle。没有生成下一战或伪造 wait-actions。

选道具、购物、重抽、转移、备用替换与学招／进化子决策的原效果接续仍未接入本批 driver，网络校验在接收前明确拒绝，不使用旧 M2 测试 hook 或吞掉已经收下的意图。此范围不是完整奖励效果、整备或下一战验收。入口队首必须是初次原 SelectModifier；ModifierReward／GameOverModifierReward／敌方 buff 等自动奖励和特殊战后分支仍待接，不能静默跳过。到期蛋的原 Hatch／hatch-commit 不可被本入口越过。

## 已批准的合作差异

用户于本轮明确：合作始终双打，应从奖励池删除双打遭遇率药水。合作菜单在阈值构建前将 LURE／SUPER_LURE／MAX_LURE（诱饵／超级诱饵／最大诱饵）权重置为零，进入原 ignored indexes；保留原池下标，原抽取函数无需另写或抽到后重抽。三种物品不会出现在合作奖励结果中。

原 SelectModifier 新增 getExcludedModifierIds 方法，单人默认空数组；阈值函数新增默认空的排除参数。合作场景绑定明确排除清单并在检查点前撤去临时函数，不保存闭包，也不全局删除目录、改动单人默认奖励或清理已有个人道具。原 shop 目录没有这三种诱饵，不另写商店表。

## 复用与边界

| 原来源 | 本批复用 | 必要适配／未覆盖 |
| --- | --- | --- |
| early phases.ts SelectModifierPhase（基点 5c9f3e34） | 整个 start、getRerollCost、getPoolType、getModifierTypeOptions | 仅阈值调用新增排除清单 hook；一个共享阶段派为两个个人原实例。渲染 UI 捕获已生成选项后成为安全停点，恢复不重跑 start。奖励效果回调尚未恢复执行 |
| modifier/modifier-type.ts | 原完整 modifierPool、regenerateModifierPoolThresholds、getPlayerModifierTypeOptions、getNewModifierTypeOption、原 shop 工厂及 ModifierTypeOption 成本取整 | 全部稀有度和原权重／去重／生成器参与执行；只加已批准的三种诱饵排除。测试的 Pokemon、可用 TM 和展示名称依赖仍为既有夹具，不能据此验收全部物种／道具组合 |
| battle-scene.ts、modifier.ts | 原 resetSeed、getWaveMoneyAmount、find／get／applyModifiers | 绑定当前个人 party／modifiers，传入原波次和房间 RNG；两席分别执行原 resetSeed，不擅自发明席位随机偏移，因此相同输入可能得到相同菜单。重抽时个人随机流仍须后续明确接续 |
| M1/M2 decision v6／v7、Phase v1、type codec、preparation 协调、候选和规则任务观察器 | 保存已抽选项／价格／scope、资源隔离、ready 标志、增量提交、失败保留旧状态 | 不新增另一套准备协议或菜单状态；本批仍带蛋 v7，不变更消息 envelope。奖励 upgradeCount 只影响原展示，本批未接原 UI，不据此验收该展示元数据恢复 |
| 既有个人 Egg 私有测试视图、正式 WS 服务、实际应用模型消费者 | 本人原模型恢复、私有资源、双端确认和故障重启 | 个人菜单只在本人 personal.preparation 中发送，shared 保留双方标志而不含双方奖励／shop 选项；本人原类型可恢复并重投影同一视图。原合作 UI／生产私有视图未接 |

测试源码在 VM 中执行，池表的纯对象跨测试 realm 时作 JSON 归一化；不替换原模型／规则。商店原工厂未赋 id，测试适配用可信工厂的原类型／名称匹配来补目录 ID，随后经过已有严格 type codec。没有移植旧 Host 帮队友选择奖励的流程，因为它不符合个人独立整备与服务器权威约定；无需访问另一份 pokerogue 或新建房间／ACK 系统。

## 验证

新增 17 项：10 单端、7 真实双端 WS（tests/coop-original-preparation.test.mjs）。原有 tests/coop-preparation.test.mjs 的四项实验回归完整保留。定向 20 项通过（包含原池表回归）。当前全部测试分段串行合计 **442/442**：435 项主回归（包含完整保留的四项原实验整备测试）通过后，另跑独立命名的 7 项原规则整备 WS，全过；主回归约 441 秒，补充 WS 约 17 秒。`npm run typecheck`、`npm run build`、`git diff --check` 和新文件空白检查通过。构建只有既有混合导入／大包警告，日志留系统临时目录。

- 冻结原 start 对照合作明确排除差异：普通分支、任一席个人全灭后恢复、未到期个人蛋库存；双方菜单、原实例／scope、成本、RNG 与池表逐字段一致。原 start 的 super 与回调保持原类词法。
- 三种诱饵的原池下标全部检查：合作 ignored 中存在且可选阈值中不存在；不传排除清单的原单人阈值仍可选，原池差分测试保留。
- JSON 恢复不抽奖、不扣款；一席跳过／准备／取消准备后另一席状态保持，双方准备只到原 NewBattle 前停点。缺 NewBattle、到期 Hatch、错误资源修改或第二席任务失败拒绝，输入不变。
- 本人私有视图还原真实原 SelectModifier 和可恢复原 type 数据；队友选项不进入 shared 或本人的私有菜单。两端从应用模型重投影确认。
- WS 每个选择前重启、个人全灭、原输入重发、菜单写盘失败、第二席任务失败、准备结果写盘失败后从已持久化输入继续、单 ACK 屏障和两房间隔离。
- 尚未支持的道具效果在网络接收前拒绝，随后仍可提交合法跳过；下一战 ACK 明确停在 NEXT_BATTLE_RUNNER_UNAVAILABLE。

## 下一批

继续原个人奖励／商店效果、重抽和目标回调的可恢复接续，优先可直接调用的原方法；保留本批排除清单，不对未知券归属自行授予。再接原 NewBattle／遭遇与真实行动输入；原 M2 子决策和双方准备复用，不重写。完整孵化与 M6 原子事务、非 FIGHT、复杂机制和生产无渲染运行器仍缺；M3 仍分原四类且部分完成。

正式 `/coop/v1/ws` 默认仍 ADAPTER_UNAVAILABLE，测试 driver 未挂生产；`/` 与 `/coop.html` 保持。全用合成蛋／房间、内存存储及随机 loopback 端口；不访问真实存档／凭据，不占用 8020，不纳入 node_modules／dist／临时输出。原合作 UI 为 M4/M5，永久收藏事务为 M6。

后续统一回归命令（包含独立命名的新 WS 文件）：

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```
