# M3 合作经验排队与实际授予

日期：2026-10-15。HEAD `5c9f3e34`，保留此前全部未提交修改；本批未提交／未推送。只在 early 开发，未操作 `E:\pokeregue\pokerogue`；远端实时状态未核对。

## 实际完成

按用户已批准的 PLAY-13，适配测试链路已复用原 Victory 的经验段：基础经验只取一次，双方共享原 playerParticipantIds，再分别绑定个人 party 与 modifiers，沿原公式处理参与分配、Exp. Share、Exp. Balance、多参战加成、Pokerus、Lucky Egg、Soothe Bell 和取整。原参战记录／倒下移除及 HP／等级上限条件保持。

随后真实执行原 ExpPhase／ShowPartyExpBarPhase／HidePartyExpBarPhase 和 Pokemon.addExp，修改各自队员的经验／相对经验，保留原友好度变化。两名普通参战者各获 32 点；单方道具不会变成另一方的效果，单方全队倒下时只对原条件允许的存活队员计算。

发生升级时，原 addExp 提升等级并排入原所属席 LevelUpPhase；本批在该安全边界拒绝继续，不跳过能力值重算、学招或进化。无升级案例在经验完成后停于原 Victory 的明确待收尾阶段；统计、战后奖励、蛋／券、下一战及永久授予尚未执行。

## 原规则复用及适配

| 来源 | 复用部分 | 必要适配 |
| --- | --- | --- |
| VictoryPhase.start（`5c9f3e34`） | 原经验段完整提取为 `victory-experience.mjs`，原类新增 queueExperience 并由原 start 调用 | 单人仍按原顺序统计 → 经验 → 战后排队 → end。合作候选只显式调用原经验剩余段，不能调用整段 start，避免未批准的后续副作用 |
| 原经验公式与 Battle.playerParticipantIds | 原分配、个人加成、友好度、上限、加权及取整 | PLAY-13：共享同一参战集合及一次基础经验，按席位绑定各自原 party／modifiers；Exp. Balance 在个人队伍内部运行。没有给每席复制完整基础经验，没有重写均分公式 |
| 新 `victory-experience-runner.mjs` | 既有独立候选、原 selectNextPhase、规则任务观察器和最终 codec 校验 | 只接未开始的原敌方 Victory，且驱动必须显式支持其经验段；全部完成／任务清零才保存。中途错误、非法候选或双方全灭保持旧状态 |
| M2 原 Phase、队列六字段、scope、decision v6 | 原 Victory 实例、原经验／升级 Phase、个人 partyMemberIndex 与共享引用 | remaining 白名单新增 `victory-aftermath`，只属于 VictoryPhase。经验排队成功后将同一 Victory 改为该阶段，放回原主队列前端；原 unshift 的 EXP 阶段先执行，之后才允许将来显式恢复收尾。未知阶段继续拒绝；无新增持久字段，版本仍 v6／Phase v1 |
| 原 Exp／ShowPartyExpBar／HidePartyExpBar、Pokemon.addExp | 原个人全队经验加成、最终取整、EXP 累加、等级上限和 LevelUp 排队 | 原个人索引以 scope 绑定所属席，按原队列运行。测试仅替换展示回调、经验条 Promise 和展示延时；原经验曲线和规则方法均执行 |
| 原 BattleScene 的 findModifier／applyModifier／applyModifiers 与原道具类 | 原过滤、shouldApply、apply、先后次序与实际道具效果 | 场景 modifiers 指向当前个人资源；使用完整原 NumberHolder 类型以保持实际 instanceof 检查，不伪造加成数值 |
| 既有绑定与前批敌方 Faint／双端 harness | 原模型、待 Victory 队列、任务观察、ACK／落盘／重启 | 保留倒下敌人的位置实例供 Victory 查找，同时用原 isFainted(true) 状态绑定逻辑容器离场判定。个人资源恢复和共享 EXP 投影仍各自核验 |
| 冻结原方法 | `5c9f3e34` 原 Victory 经验体、原 EXP 方法及场景道具应用方法 | 连续对照直接编译冻结经验体，不调用新 helper 当基准；恢复侧每步过生产 codec。另对比完整单人 Victory.start 的统计与后续队列，验证提取未改原单人顺序 |

此前已有 Exp／LevelUp／Learn／Evolution 状态与安全阶段继续作为来源，本批未复制或替换它们。未迁移旧项目 Host 流程，因为 early 原类和 M1/M2／双端基础已具备。

## 新剩余阶段的精确定义

`victory-aftermath` 表示：原经验段已经计算并完成排队／友好度处理，经验相关原 Phase 位于它前面；该 Victory 的击败统计和战后排队尚未执行。恢复不能重新调用 Victory.start，也不能再计算经验。

若前面的 EXP 引发原 LevelUp，先保留该原阶段与其所属席；本批不支持 LevelUp 执行，因此会明确停住。后续必须复用原 LevelUp、学招／进化安全停点，再恢复这一个 Victory 的剩余部分。当前测试 driver 在 LevelUp 或 victory-aftermath 的下一次 ACK 会拒绝不支持的运行，不伪装成战斗结束。

## 验证

新增 19 项：11 项单端、8 项真实 WS。最终完整串行回归 **340/340**、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。构建只有既有混合导入／大包警告；日志在系统临时目录，dist 为忽略输出，不纳入提交。

- 普通分配、单方 Exp. Share、各自道具／Pokerus、单方全队倒下：原连续执行与逐阶段 JSON 恢复的模型／队列／事件／RNG 一致。
- 个人 Exp. Balance、多参战加成和其他加成组合保持原公式；HP／等级上限、无参战者、友好度封顶与成就 hook 均保留原条件。
- 实际 addExp 升级到原 LevelUp 停点，scope 属于原个人队伍，不隐式执行后续或丢失剩余 Victory。
- 经验只排队一次；EXP 阶段完成后保留原后续行动在 victory-aftermath 之后，重复调用不会重算。
- 计算到第二席时失败、实际 EXP 修改后任务失败、非法候选、未清任务、损坏 remaining 及同时全灭均不能发布候选。
- 完整单人 Victory.start 对照冻结原实现：击败统计、经验排队和 BattleEnd／Egg／奖励／下一战队列一致。
- 双端逐阶段重启，恢复各自道具与共享 XP；普通、道具／后备经验、单方倒下及升级停点均核对两席模型与投影。
- 经验排队、场上 EXP 授予、后备经验条三处写盘失败，以及 EXP 应用任务拒绝：保留原 XP／友好度／资源／队列／RNG，修复重启后只推进一次。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 后续范围

优先复用原 LevelUp 的能力值重算、学招／进化及 M2 原安全阶段，接回已排队经验的完整后续；然后处理 victory-aftermath 的统计与战后闭环。PLAY-07 的胜后恢复、原 BattleEnd、独立整备和下一战仍未因此完成。蛋／券归属及敌我同时全灭的最终顺序仍未确认。

本批只有已声明普通野生战斗／道具／无复杂胜后特性的受控案例；没有全量特性、形态、Boss、主动换人／捕获／逃跑或全部经验组合验收。统计和永久成就授予只保留 hook／剩余工作，未执行永久事务。

生产无渲染场景、全量合法意图及完整 RNG 绑定仍缺；正式 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE，测试 driver 未挂生产。M3／GAME-01 等不整体验收，`/`、`/coop.html` 入口及产品精灵范围保持。WS 仅用合成房间、内存存储与本机随机端口，不占 8020、不读取真实令牌／存档；dist 与临时日志不纳入提交，未做浏览器视觉或真实双机验收。
