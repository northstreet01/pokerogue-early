# M3 原战前换人确认、选择与恢复

日期：2026-10-16。继续上一批 NewBattle 的未提交工作；开工实际 `main / HEAD / 缓存 origin/main` 均为 `3ce98d72`，实时 `git ls-remote` 也为该提交。工作区保留上一批 11 个变更文件，未重置或清理。本批同样尚未提交／推送，仅在 early 开发。

## 实际完成

适配测试链路已支持普通同区域野生双打遭遇后，双方各自存在可用后备时的原 `CheckSwitch → Switch → SwitchSummon → PostSummon → TurnInit`。每席可以接受或拒绝换人；接受后可以选择自己的存活后备，或在原队伍菜单取消。两席依原队列分别处理，第一席的选择不会代替第二席。任一方有后备、双方均有后备、双方拒绝、单方菜单取消及另一方仍换人均有差分案例。

保存点明确区分两个交互：`switch-confirm` 保存原 CheckSwitch 已显示确认的问题；`switch-select` 保存原非 modal、doReturn=true 的 Switch 已显示队伍菜单。恢复只调用对应原回调，不重新 start 已开始的 Phase、不重显旧问题、不提前交换队伍。原倒下替补 `wait-switch` 仍要求上场者已倒下，不把存活者换人塞入其契约。

接受真实后备后，直接复用原 `preSummon` 的召回／移除来源标签／离场特性分派、原 `switchAndSummon` 的个人队伍交换，以及现有 `switch-swap → summon-initialize → summon-finish` 入场边界和原 PostSummon。玩家召回后的场上位置暂为 null，伙伴保持原位置；新精灵随后占据本席位置，不压位伙伴。两席处理完进入原下一战真实 FIGHT 输入，单端还能完成首个真实回合并验证 PP 只扣一次。

最后一席拒绝或取消时，可能没有剩余阶段；使用已有 `finishRoundBoundary / populatePhaseQueue` 补入原 TurnInit，再由原 TurnInit 排入 Command。没有手工伪造下一次行动菜单，也没有另写队伍交换或入场规则。

## 复用与适配

| 来源／身份 | 本批复用 | 必要差异与限制 |
| --- | --- | --- |
| early `src/phases.ts` CheckSwitchPhase／SwitchPhase；基点 3ce98d72 | 原接受／拒绝回调、原个人队伍回调、原 slot 校验／取消排队与结束 | 只把原局部回调命名提取为 `createSwitchConfirmCallbacks` 和 `createSwitchSelectCallback`；单人 start 与恢复共用同一方法。冻结本批前源码检查回调体，既有提取前原版 Switch 差分也保留 |
| `switch-command.mjs`、decision／phase continuation codec、rule-phase-runner | 既有稳定实例 ID、个人 roster、原类与 scope、独立候选、同步停点声明 | 新增两个明确交互 kind／remaining；复用现有 v6/v7 envelope，不迁移旧数据。决策严格绑定当前原类、所属席、原 fieldIndex／flags 和本人可选实例；不放宽 forced-switch 的倒下要求 |
| 新 `pre-battle-switch-runner.mjs` | 现有候选／输入校验／任务清零／先保存后发布契约 | 仅恢复可信原回调，验证只新增预期原 Switch／SwitchSummon。保护队伍、跨席可变别名、场地、RNG、金钱／球／道具、蛋、伙伴队列及待续效果；回调不能偷偷推进交换或改资源 |
| 已有 `replacement-model.mjs / native-switch-model.mjs`、原 Summon／SwitchSummon／PostSummon | 原召回、个人队伍交换、lastPokemon、初始化／onEnd／来源清理、原特性／场地分派 | 只增加明确 `preBattleReturn` 测试选项和相应阶段约束；默认倒下替补仍 doReturn=false。本席个人规则用 local slot=0／battlerCount=1，检查点和 Phase scope 保留全局 seat；场上索引恢复为本席，不借用伙伴队员 |
| 上一批 NewBattle／原 Encounter、现有 cycle／round driver、M1 正式 WS 与客户端实际模型投影 | 原创建与遭遇同候选、下一真实输入／真实回合、增量回执／ACK／重启和失败回滚 | 新组合测试 driver 显式开启有后备分支；旧窄 driver 默认范围保留。未挂生产，正式 `/coop/v1/ws` 默认 ADAPTER_UNAVAILABLE；`/` 与 `/coop.html` 保持入口 |

没有另建房间／确认／去重／替补系统；此前另一份 pokerogue 未操作，因为 early 原回调和既有 M1/M2/M3 已能直接复用。测试仍使用上一批受控 Pokemon 构造和展示提供者，原完整构造／生产场景未验收。渲染颜色、动画时间和对象展示由既有 hook 处理，不另写规则公式。

## 验证

新增 **32 项**（19 单端、13 真实双端 WS）定向通过；`npm run typecheck`、`npm run build` 和完整串行回归 **574/574**（约 631 秒）通过。构建只有既有混合导入／大包警告。此前 542 项仅是上一批证据。

- 冻结原确认、原提取前 Switch 回调和原 Summon／SwitchSummon／PostSummon 连续执行，与逐决策／逐入场阶段 JSON 恢复后的检查点、队列、事件及 RNG 一致；两席单独或先后换人，拒绝和取消不交换队伍、不改伙伴资源。原回调体只做命名提取。
- 当前决策、原 Phase scope／fieldIndex／remaining、原 modal／doReturn 与本人后备须一致。外席输入、选伙伴／当前场上者、缺失输入、变造选项或字段拒绝，不消费 RNG。v6 不补空蛋，v7 保留个人蛋与既有 hatch-commit 边界。
- 恢复旧确认／旧队伍菜单时故意让 start 抛错，合法恢复仍完成；任务失败、伙伴 HP／金钱或同值可变数组别名注入、擅改伙伴待续队列均不发布候选。
- 双端逐选择、召回后空位、交换／初始化／收尾和 PostSummon 重启，重新从实际原模型提取摘要；输入重发返回原回执，同 ID 异内容拒绝，拒绝／取消也不重复执行。
- 确认／队伍输入结果，以及原 SwitchSummon、switch-swap、summon-initialize／finish 结果写盘失败均保留旧检查点；已接受输入恢复后只执行一次。另测原任务失败修复恢复、单 ACK、旧决策／非法归属及两房间隔离。

测试使用合成房间、受控原目录模型、内存存储和随机 loopback 端口，不访问真实存档／房间／令牌，不占用 8020；日志置于系统临时目录，依赖与 dist 不纳入变更。含上批保留工作，当前累计 22 个变更文件；范围检查未发现存档／房间／依赖／构建产物，`git diff --check` 与新增文件空白检查通过，所列 GitHub／AWS／私钥模式扫描未命中。这仅是本次变更范围与所列模式检查，不是全历史或绝对隐私保证。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 剩余与下一步

下一批优先扩展原敌方持有物生成／更新及个人已有持久道具的遭遇绑定，复用原 generateEnemyModifiers、add／updateModifiers 和既有个人 Modifier 场景，取消上一批“无道具／敌方抽取为零”的测试分支限制，补连续／恢复及双端故障差分。

本批仅补普通战前个人换人；战斗内主动换人、捕获／逃跑、接棒／复杂离场或入场特性全覆盖、形态、闪光展示、特殊遭遇、原完整构造、感染传播和生产无渲染运行器仍有缺口。原合作 UI 属于 M4/M5，永久收藏／消费蛋属于 M6，不能把当前切片写成完整 M3。PLAY-13/14/15 沿既定规则；券归属／时机和敌我同时全倒下最终顺序未决定。RNG 只验证房间既定持久化顺序恢复，个人独立流和生产全 RNG 尚未验收。
