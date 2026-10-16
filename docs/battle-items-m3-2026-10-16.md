# M3 战斗道具的原触发、个人所有权与一次性消费

后续修复／补验：本记录保留战斗道具推进时的实际结果。之后审查在获准监听端口后另复现 v6 测试上下文误用 v7 蛋视图，导致创建房间失败；现已修复，原 10 项 WS 与新增 2 项 v7 双端重启通过。版本测试、完整回归及当前 Git／检查范围以 [最新修复记录](client-projection-fix-m3-2026-10-16.md) 为准，不再把本页旧 EACCES／审批 429 或“WS 待补跑”当作最新状态。

日期：2026-10-16。承接用户确认的上一批 28 个未提交文件与完整串行 596/596 验证；这些是已完成的遭遇道具成果，不是本批重新验收的数字。本批仍未提交／未推送。

## 实际覆盖

- 在已有原 Command／Target／EnemyCommand、TurnStart、Move／MoveEffect／Damage、MoveEnd／TurnEnd 链中显式挂入原 Modifier 方法。双方个人 Pokemon 始终查询本人列表，敌方查询房间敌方列表；原 Phase 的无 Pokemon 参数调用按该 Phase 的持有人定位，无法定位的个人效果明确拒绝，不借用伙伴资源。
- 原属性增伤、临时命中与要害、Shell Bell、Leftovers、Healing Charm、Berry Pouch 实际触发。树果实际覆盖 SITRUS／LUM／LEPPA；原 BerryPhase 扣栈／清 consumed／removeModifier／updateModifiers，原 PokemonHealPhase 回复 HP／显示／updateInfo，全程保留原公式、队列顺序与随机调用。
- 队友与敌人有相同类型物品时按实际实例移除，不按类型或列表位置误删。敌方 BerryPhase 原调用未显式传 enemy 标志，合作桥按对象身份路由到原 enemy removeModifier；没有改写单人 BerryPhase。
- 现有原战前确认／取消、召回／交换／入场及倒下个人替补沿用同一绑定。原交换完成后新上场者保留本人资源，出场者的持有物不会被错误转移；主动战斗换人和 Baton Pass 未因此完成。
- 自然生成敌方道具的普通 NewBattle／遭遇可继续至原真实输入和真实出招；另从原上一回合运行到真实输入，再实际收集双方输入并完成带道具回合。原 Damage 只完成显示，不再次扣血。每个候选完成原异步规则任务后才可提交；更新失败保留原 HP、物品、队列与 RNG。

以上是显式普通分支的组合测试 driver，不是生产无渲染运行器，也不是完整 M3 验收。个人测试接收目录在遭遇批已有目录上增加 LEFTOVERS／SHELL_BELL／BERRY_POUCH；仅三种树果获本批覆盖，其他树果与转移／复活物品等明确拒绝。小精灵目录、种子和波次仅为夹具，不限制产品种类、世代或数量。

## 复用、适配与来源

| 来源 | 直接复用 | 本批必要差异 |
|---|---|---|
| early `src/phases.ts`，基点 `3ce98d72` | 原 Command／EnemyCommand／Move／MoveEffect／Damage／MoveEnd／TurnEnd，原 Berry／PokemonHeal／CommonAnim，原换人各阶段 | 复用现有运行器和阶段 codec，只加临时场景绑定；动画、声音和 UI 回调为显示提供者，不另写效果 |
| early `src/modifier/modifier.ts`、`src/data/berry.ts` | 原 shouldApply／apply、持有者判断、回血、保存树果、树果效果和扣栈流程 | 测试加载原函数；未重新实现回复、伤害、PP 或概率公式 |
| early `src/battle-scene.ts`；已有 experience／aftermath／encounter helper | 原 applyModifier(s)、find/remove/updateModifiers、updatePartyForModifiers、原 Pokemon.calculateStats／updateInfo | 复用已有个人子场景和任务观察器；新增 `src/battle-core/modifier-scope.mjs` 处理共享 Phase 的所有权查询／移除／更新 |
| 已提取 `src/battle-core/move-damage.mjs` | 原伤害／要害公式和随机顺序 | 属性增伤、要害以及伤害金钱的查询提供者由受击者 scene 改为出招者 scene；原单人共享同一 scene，行为不变。伤害金钱的发放本批未接收／验收 |
| 已有 M1/M2／M3 runner、codec、task tracker、双端 WS harness | 候选隔离、阶段剩余步骤、实际模型提取确认、ACK、输入去重、先落盘后发布 | 不另建状态协议、队列或服务，不新增状态版本；v6/v7 语义不变 |
| `tests/fixtures/early-battle-items-reference.json` 及既有冻结夹具 | 从 `git show 3ce98d72:src/phases.ts` 提取 Berry／Heal／CommonAnim；其他阶段使用此前冻结原方法 | 连续参考不重建模型，恢复路径每阶段 JSON 往返。参考伤害仅同步上述三处所有权适配，公式仍来自冻结原方法；另有明确持有人／伙伴负例，不能只靠共用桥的自比较 |

没有读取或移植另一份 `E:\pokeregue\pokerogue`：early 原方法及既有状态／运行器已足以实现此范围。完整 EnemyPokemon 构造、复杂动画／场景与原合作 UI 不在本批，不将原构造夹具当生产完成。

## 实际验证

本批新增 **42 项用例**：32 单端已通过，10 双端 WS 已编写但因运行环境阻塞尚未验收。

- `node --test --test-concurrency=1 tests/battle-core-battle-items.test.mjs`：**32/32** 通过。
- `node --test --test-concurrency=1 tests/battle-core*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs`：**399/399** 通过，约 311 秒；这是本批实际串行本地结果，不是完整含 WS 回归。
- `npm run typecheck`、`npm run build` 通过；构建仅有既有混合导入／大包警告。空白及变更范围核对见最新交接记录。
- `node --test --test-concurrency=1 tests/coop-battle-items.test.mjs`：10 项均在本机 loopback 连接处 `EACCES`，未执行网络断言。提权重试因审批服务 HTTP 429 未执行；未绕过审批，不能记作 WS 通过或合并计算完整回归通过数。

32 项单端覆盖实际属性增伤、自然种子命中／要害差异、伙伴负例、个人无归属拒绝／解绑；双方及敌方单栈／双栈树果、保存树果、个人增疗、解状态／PP 恢复；完整带道具回合和后续真实输入；双方原倒下替补、自然遭遇延伸、双方原战前交换；待完成更新阻止提交、拒绝更新可重试、未支持效果原子拒绝。逐停点与连续原版比较检查点、HP／PP、道具状态／引用、原队列、事件和 RNG。

10 项 WS 待补跑：双方逐阶段重启与真实行动输入去重（2）；双方／敌方 Berry 与 Heal 结果写盘失败后重启重试（6）；原异步更新失败（1）；两房间隔离和双方 ACK 屏障（1）。对应真实行动序列另有单端差分通过，但不能替代这些网络、落盘及重启断言。

## Git 与边界

开工实查 main／HEAD `3ce98d72`，最近代码汇总 `119b9f5a`；缓存 `origin/main` 与 HEAD ahead／behind 0／0。remote 为 `https://github.com/northstreet01/pokerogue-early.git`。本批只读 `git ls-remote origin refs/heads/main` 因本机代理 `127.0.0.1:7897` 拒连失败，提权检查因审批服务 429 未执行，实时远端无法确认；没有 pull、reset、commit 或 push。已保留上一批所有未提交成果；实际累计范围以最新 git status 为准。

M3 仍部分完成；正式 `/coop/v1/ws` 默认 `ADAPTER_UNAVAILABLE`，测试 driver 未挂生产。`/` 单人与 `/coop.html` 实验入口保持独立。PLAY-13／14／15 不变，券归属／发放时机和敌我同时全部倒下顺序未自行决定。RNG 仍只验证房间既定持久化顺序恢复；个人独立随机流及生产全 RNG 未验收。v6 不补空蛋，带蛋用 v7；孵化停在 hatch-commit，不原子消费蛋或写永久收藏，不越过 M6。

## 下一步

先在可连接本机端口的环境补跑本批 10 项真实 WS 与完整串行回归。随后接原持有物转移／复活等剩余战斗效果，按原队列逐项划定个人与敌方所有权和可恢复停点，继续真实触发、消费、失败与重启差分。其他树果、额外交互道具、特殊遭遇／训练家／Boss、完整原构造、TM／回忆／进化道具／融合、主动换人／捕获／逃跑、复杂机制、生产运行器仍有缺口；原合作 UI 属于 M4/M5，永久收藏事务属于 M6。
