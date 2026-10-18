# 原类生产运行器普通闭环：承载验证批

## 批次与停点

本批接续 [运行时引导批 A](mvp-runtime-bootstrap-2026-10-17.md)，单独记录为批 B。A 解决完整原模块在 Node 加载、构造与隔离；B 验证真实原类队列能否承载一个明确普通分支。两批代码由本次同一进度提交保存；A／B 是实施与验收记录的分批，不是两个独立代码提交。当前未推送。

用户要求本批结束后停下检查验收，并尽快收尾。本批不接 M4/M5 UI，不新增公开入口，不装配正式 adapter。M3 仍部分完成，`/coop/v1/ws` 默认仍 `ADAPTER_UNAVAILABLE`。

开工 main／HEAD／缓存与只读实时 origin/main 同为 `5614776777eb820972c60a73d8986abb4f57836e`，开工工作区干净。收尾实际 Git 与验证结果以本文件末段为准，不沿用历史测试数量。

## 本批实际执行

- 完整 early 原 `NewBattlePhase → BattleScene.newBattle → EncounterPhase` 生成双敌方，再经原 PostSummon／Summon／TurnInit 到真实 FIGHT 输入；创建和遭遇同候选，不保存空敌方的半初始化战斗。
- 原 Command／SelectTarget 收集双方命令，原 EnemyCommand／AI、TurnStart、Move／MoveEffect、Damage、StatChange、MoveEnd／TurnEnd 继续运行；Damage 展示不再次扣血。
- 同一声明分支经原敌方 Faint／Victory／Exp／BattleEnd，再分别执行两位持有人的原 EggLapse，进入两份原 SelectModifier 菜单。
- 双方明确跳过奖励并各自准备后，原 NewBattle／NextEncounter 创建第二战；原战前确认支持拒绝、接受后取消、接受并选个人后备，原召回／交换／入场后均可接收第二战真实 FIGHT 命令。
- 菜单恢复只执行保存阶段的原命名回调，不重新 start 旧菜单。完整原队列、所有权、RNG、池状态仍使用 M2 codec、现有运行器和任务观察器。

自动化普通局使用固定种子、两边各三只原 5 级精灵及显式空蛋库存；这是可复现验证分支，不是种类／世代／队伍容量的产品限制。原目录仍完整加载。

## 复用来源与适配差异

| 原来源／现有模块 | 实际复用与适配 |
| --- | --- |
| `phases.ts`、`battle-scene.ts`、`field/pokemon.ts`、完整 data／modifier | 完整导入并调用原类和原方法，不用 tests/helpers 的源码片段或小目录；不另写伤害、经验或升级公式 |
| `BattleScene.reset` 的个人初始资源段 | 命名提取为 `initializeRunResources`，原 reset 在原位置调用；Node 入口复用原球数／金钱默认值 |
| 原 Phaser 数学 | 随机生成器、Linear、GetEaseFunction、BlendModes 直接来自已安装 Phaser；野生进化选择使用的 easing 是规则依赖，不能伪造 |
| 原 Summon／Faint／动画回调 | 仅替换显示对象、资源加载与音画播放；虚拟时钟仍执行包含规则效果的原回调，并排空已观察任务。未知显示方法或规则阶段拒绝 |
| `original-phase-checkpoints`、`rule-phase-runner`、`fight-command`、`next-battle-runner`、`preparation-runner`、`pre-battle-switch-runner` | 直接复用原类 codec、独立候选与既有边界；两席个人视图共享全局战场索引，个人队伍／资源保持分开 |
| 原 Victory 经验段 | 基础经验计算一次，再在双方个人队伍视图调用原 queueExperience；保留共享实际参战集合和原公式 |
| 原 Encounter 存储调用 | 增加显式 `deferEncounterPersistence` 端口；原浏览器默认返回 null，仍走原保存分支。Node 记录 pending 意图，不调用永久 GameData，不伪造 saveSystem 返回成功；其他未接保存调用明确拒绝 |
| 原收藏／永久统计／真实个人配置 | 尚未接入。当前身份显式提供，GameStats／unlocks 仅为新局承载探针基础；真实配置、统计增量与持久意图的可靠提交待正式 adapter 接入，不能作为完整个人资料验收 |
| 原 UI、此前项目大厅／回放 | 按用户收尾要求本批未迁移；下一批按 SPEC 4.5 只读参考并接原 UI，保留 M1 权威，不迁入旧 Host 结算 |

主要代码为 `src/server/native-entry.ts`；引导、Worker 与编译入口见批 A。`presentation-port.mjs` 只承接原球粒子展示，浏览器未绑定时走原实现。

## 差分发现与修正

手动闭环后，自动差分发现已选中、已离开队列的个人 ExpPhase 恢复时丢失 scope：两席个人索引同为 0，导致第二席经验错发第一席。现已优先绑定检查点 scope，并覆盖实际持续执行与逐阶段恢复比较。

同时修正个人视图误用私有队伍作为全局战场的适配问题。战前确认动作保留稳定 pokemonId；交换与入场仍执行原方法，仅在原单人局部索引与合作全局席位间适配。

## 验证与验收边界

新增 11 项原类 Worker 自动化：完整入场逐阶段重启、连续原队列与恢复队列全状态／事件差分、原菜单恢复与显式跳过／准备、战前拒绝／取消／双方个人换人、真实下一战命令、校验纯度与越权拒绝、确定性候选重试、双 Worker 隔离、v6 不补蛋库存、双方原蛋推进一次、未知阶段拒绝和保存意图边界。

比较保留 HP／PP／经验／等级／原队列内容／所有权／随机状态／池表／菜单，只规范化调度生成的 decisionId 与 phaseId；其余模型和事件要求一致。蛋测试只推进原持有人计数，不消费蛋、不写收藏。

复现本批定向验收：

```powershell
node --test --test-concurrency=1 tests/battle-core-native-runtime.test.mjs tests/battle-core-runtime-bootstrap.test.mjs tests/battle-core-phase-state.test.mjs
npm run typecheck
npm run build
git diff --check
```

最终定向验收 **32/32 通过**（B 新增 11＋A 新增 12＋原阶段状态 9，约 47 秒）；类型检查通过，浏览器生产构建通过（约 58 秒，既有混合导入／大包警告）。空白检查通过；累计 23 个变更文件的范围检查及指定凭据模式未命中，未纳入存档／房间／依赖／构建产物／临时输出。结论仅限当前范围和扫描模式，不作全历史或绝对隐私保证。**当前 B 代码未完成全串行回归。** A 代码曾通过 710/710，B 又增加原阶段与端口后该数量只属于 A 检查时点；不能称当前工作区完整回归通过。

## 未验收与下一批

本批是生产构建中的原类运行器“受控普通分支承载验证”，不是生产联机 MVP 放行。现阶段尤其缺：

1. 正式 adapter、生产私有投影／客户端实际模型恢复、持久意图的同候选存储；该新 Worker 版本尚未补双端 WS 重启、协调层输入去重、写盘失败与隔离矩阵。Worker 确定性重试不替代 WS 去重。
2. 当前整备只接真实菜单和显式 skip／ready／unready；既有奖励／购物／重抽／持久物／糖果成长切片尚未全部迁入此生产绑定。下一遭遇明确拒绝个人已持道具，不能默认抹掉或忽略道具效果。
3. 原 LevelUp 已在执行分发表中，但当前普通局没有触发；学招／进化等子决策、个人强制替补／个人全灭恢复、到期蛋孵化、特殊遭遇／换区／训练家／Boss、非 FIGHT 与复杂机制仍未验收。未知阶段明确失败，不能绕过。
4. 原身份／个人内容加载仍需正式绑定；券及同时全倒下顺序保持未定。RNG 仍仅验证房间既定持久化顺序，不代表个人独立流／全生产 RNG 验收。
5. M4/M5 原 UI、双浏览器连续游玩和真实跨设备连接尚未开始本批验收；M6 永久收藏事务保持原边界。

**恢复开发时先补当前代码全串行回归和生产绑定的必要缺口／正式 WS 故障矩阵，再接 M4/M5 原 UI。** 不重做已通过的原类加载；不回到以全机制补齐为 UI 前置。按用户指示，本批验收记录完成后停止，等待后续指令。

## 收尾核对

main／HEAD 仍为 `56147767`，相对缓存 origin/main 为 0／0；实时远端已在本轮开工时只读核对，收尾不把缓存比较冒充再次联网核对。A／B 修改由本次同一进度提交保存，未推送；实际提交号见新窗口交接。定向验收、类型检查、浏览器构建均已结束；当前 B 全串行回归与生产 WS 故障矩阵待补。按用户要求在此停止。

## 2026-10-17 提交前补验

用户要求提交当前进度。原运行器定向 32 项再次通过；既有 `tests/coop-formal.test.mjs` 在允许本机临时连接的环境下 **12/12** 通过。初次受限合跑的 WS 连接未成功建立、进程未正常收尾，已仅清理该次测试的两个已识别进程；单独重跑通过，不把初次合跑写成完整通过。上述分项合计 44 项证据不等于完整串行回归，也不等于新 Worker 双端 WS 承载／故障矩阵完成。生产代码本轮未继续扩展。
