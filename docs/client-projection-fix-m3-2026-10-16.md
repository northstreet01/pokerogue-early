# M3 战斗道具 WS 投影的 v6/v7 修复与补验

日期：2026-10-16。承接上一轮战斗道具推进，先只读审查实际代码与 Git：main／HEAD／缓存及实时 origin/main 均为 `3ce98d72`，ahead／behind 0／0；审查时共有 42 个未提交变更文件。保持此前成果，不重置／清理，不操作另一份 pokerogue；本批仍未提交／未推送。

## 复现与修复

此前 10 项新增 WS 最初受 loopback EACCES／审批服务 429 阻塞。此次获准监听随机本机端口后，10 项均在创建房间等待 welcome 时超时；进一步直接调用投影，得到 `TypeError: Cannot read properties of undefined (reading 'players')`。根因是 `itemRoundContext / itemInputContext` 产生不带 eggState 的合法 v6，而测试 adapter 复用的 `projectPreparation → projectEggSnapshot` 假定总有 v7 个人蛋库存。这个适配错误与此前环境阻塞是两件事，不能仅把当前失败归因于端口权限。

直接扩展既有 `tests/helpers/egg-lapse-clients.mjs` 的投影／恢复，不重建客户端、协议或状态 codec：

- v6 只投影原战斗模型与本人资源，不增加 eggCounts／eggs／hatches；恢复返回原 v6 context，不创建 eggState。
- v7 延用原私人蛋／孵化队列投影，恢复本人的原 Egg／Phase 模型；队友仍只公开数量／队列位置。显式空库存 v7 仍为 v7，不因库存为空而降为 v6。
- 视图必须完整表达是否具有蛋状态；缺少或混入部分蛋元数据明确拒绝。v6 不通过补空库存冒充 v7。
- 原物品触发、伤害／回血／PP／概率、原 Phase 和原 codec 均未改；只修复测试适配器的版本分支。正式 WS 仍无默认生产 driver。

| 复用来源 | 本批使用 | 必要差异／未复用原因 |
| --- | --- | --- |
| 既有 egg-lapse-clients、preparation-model | 私人资源投影、快照消费者、原客户端模型恢复与摘要重提取 | 加入无蛋状态 v6 路径，保持既有 v7 路径；不新增协议版本 |
| M2 decision／modifier／egg／phase codec | 原类恢复、资源与字段验证 | 不修改原版本迁移语义，不在恢复时调用生成器或规则 |
| 战斗道具连续原规则参考、M1 formal WS harness | 原真实行动与消费、双方 ACK、逐阶段重启、回执去重与失败重试 | 现有两席逐阶段用例分别验证 v6 和带本人蛋的 v7；不另造网络或落盘框架 |
| early 原规则与其他 pokerogue | 保留上一轮所有原规则调用 | 此次错误在当前测试视图，原规则无需再提取；未访问另一份项目，也未重写规则 |

## 验证与状态

本批新增 9 项用例：7 项单端版本／资源／私有性／不完整元数据验证，2 项 v7 双端逐阶段重启与输入去重。战斗道具定向 **51 项通过**（39 单端、12 WS；50 项联合运行＋补充空库存边界 1 项），类型检查和生产构建通过；构建仅有既有混合导入／大包警告。本批完整串行回归 **647/647** 通过（约 895 秒），类型检查与生产构建通过。

```powershell
node --test --test-concurrency=1 tests/battle-core-battle-items.test.mjs tests/coop-battle-items.test.mjs
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

修复前审查重跑：新增单端 32/32、相关旧行动／伤害／回合测试 37/37、类型检查与空白检查通过，新增 WS 0/10，不能写成完整回归通过。上一轮 399 项本地、前序 596 项完整回归和构建结果均保留为历史，不充当本批证据。

测试使用合成房间／原模型、随机 loopback 端口及既有内存存储，不访问真实存档、房间或令牌，不占用 8020。日志放系统临时目录，不纳入 Git。含全部前序成果，当前累计 44 个变更文件；空白及新增文件空白检查通过，未发现存档／房间／依赖／构建产物／临时输出纳入变更，所列 GitHub／AWS／私钥模式扫描未命中。范围与凭据模式检查仅覆盖当前变更，不是全历史或绝对隐私保证。全部修改未提交／未推送。

## 下一步与边界

本批完成补验后，下一批复用原持有物转移／复活等剩余战斗效果，先核对个人与敌方所有权、原队列及消费／恢复停点，再做原版连续／恢复和双端故障差分。其他树果、额外交互、特殊遭遇／训练家／Boss、完整构造、复杂奖励、非 FIGHT 和生产无渲染运行器仍缺。M3 仍部分完成，正式 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE；`/` 与 `/coop.html` 独立，PLAY-13／14／15、未确认券／同时全倒下规则、房间既定顺序 RNG 与 hatch-commit／M6 边界保持。

本次只读定位了下一批原方法：`HeldItemTransferModifier.apply` 从实际对手选道具，调用 `BattleScene.tryTransferHeldItemModifier` 并异步排消息；后者负责防偷特性、克隆／改持有人、堆叠／移除／更新，须复用并观察完整 Promise 链，不能把同步 apply 返回值当完成标记。复活入口是原 Faint.start 的 `PokemonInstantReviveModifier / EnemyInstantReviveChanceModifier`，再排 `PokemonHealPhase(revive=true)`；需核对扣栈、倒下分支与待回复停点，不能在致死前自行恢复 HP。这里仅记录复用候选，尚未新增这些效果的完成声明。
