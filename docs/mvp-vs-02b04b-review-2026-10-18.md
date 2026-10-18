# VS-02B-04B 维护者修复与验收（2026-10-18）

基线 `cd9a5f30a2ed02109c7260826dd3f083e7b95c5c`，修复分支 `review/vs02b04b-render-input-fix`。原交付是 partial，本记录不覆盖其失败历史。实时远端 main 与本地 main 均为 `871c5f18`，开工 HEAD 比它多 11 个提交；未合并、未推送。SPEC 与提示词仅本地保留，不纳入提交。

## 本批定位与修复

1. codec 恢复的是原规则实例，缺少 Phaser Container 的事件、变换和子对象列表。新增 `CoopBattlePresentation`，使用真实 Phaser Container，然后恢复原 PlayerPokemon／EnemyPokemon 原型；本人数据来自原 codec 的独立副本。复用原 `generateName/init/initBattleInfo/loadAssets/setFieldPosition/updateInfo/destroy`。不运行原 Pokemon 构造器，不向核验模型附加渲染状态，不重新计算 HP、能力或规则随机数。
2. 队友／敌人仅使用服务器公开字段，不构造其私有完整战斗状态；maxHp 用公开 getter，不再捏造其五项战斗能力。公开代理的 exp/levelExp 为隐藏经验条所用的展示占位，不能作规则输入。当前公共投影尚无完整状态、太晶与融合外观，不能据此宣告复杂机制画面正确。
3. shared 增加原 arena biome 与纯展示 terrainColorRatio。复用原背景与地台贴图／容器，不启动浏览器 Encounter，不调用会抽装饰随机数的 ArenaBase.setBiome，暂不重建随机装饰。
4. 不压缩全局场上槽位，不把 seat 1 或本人后备移到 seat 0。按 field ID 找本人原模型；场外本人队员仍保留于 consumer 的个人模型，未伪造队友后备。每个新快照释放旧精灵容器／血条／tween，不叠加占位 sprite。
5. 原 Command/Fight 需要的 getPokemon/getFieldIndex/handleCommand/checkFightOverride/cancel 统一由 CoopPlayPhase 提供。收到同 revision 的 syncStatus，双方已 ACK、本人未提交且为 requiredSeat 时才打开原 Command。原 Command UI 新增可选拦截端口，BALL/POKEMON/RUN 暂停在合作阶段，不进入单人菜单或本地规则。
6. 目标直接来自服务器 decision.options，原 TargetSelect 接可选目标位置列表；单人调用保留原 getMoveTargets。客户端不调用会抽取 RANDOM_NEAR_ENEMY 的规则 helper。目标取消不发送，旧 revision／epoch 回调失效；自动目标保留服务端 null 语义。
7. actionId 仍先写现有 IndexedDB outbox，再发正式 submitAction；写入失败保留可重试菜单，接受回执／submitted 状态阻止重复行动。旧 decision 的 durable receipt 只清 outbox，不锁新菜单。规则／写盘故障明确显示暂停和手动重新同步，不用新 actionId 重复结算。
8. 展示应用在 consumer 的 applySnapshot 内等待；画面失败不 ACK、不开放输入，成功后仍重提取原个人模型核验。重复 revision 仅复用成功展示，恢复 epoch 改变会重新绑定。
9. 双端首回合真实命中了此前未覆盖的 StatChange 遮罩路径：Worker 报 `this.getAt is not a function`。在原 `StatChangePhase.start` 遮罩动画前接既有 presentation port，原能力公式、Mist／特性、消息和 end 闭包完整保留；无端口的单人继续原遮罩动画。不是重写能力公式、吞异常或跳过规则阶段。

## 实际验证

- 最终 typecheck：退出 0。
- 最终生产 build：退出 0，55.22 秒，仅既有混合导入／大包警告。
- 原 StatChange 冻结规则差分＋页面端口：25/25，退出 0；包括两席、倍增／封顶／随机能力项、显示失败不 ACK、旧回执、旧目标回调、写盘失败、个人 actor、submitted 与 blocked 门控。
- 新增真实 Worker Growl 用例：原 continuous 与逐 StatChange JSON 重启恢复的 checkpoint／events 完全一致，保留输入与 RNG。
- 完整串行回归：**970/970，通过，退出 0**，正常 `1..970` 收尾；fail/cancelled/skipped/todo 均为 0，960395.7328ms（约 16 分钟）。实际执行 HEAD 为 cd9a5f30，修复为未提交工作树；源码／测试 blob 已记录并核对与暂存区一致，未用历史数量推算。
- 空白／提交范围检查通过，本批新增行的指定凭据模式扫描无命中；只限本批范围与所列模式，不是全历史或绝对隐私保证。
- 初次新增端口测试发现旧 VM 测试依赖缺少新 import，以及测试覆写只读方法失败，已补真实 presentation port 模块注册并用可配置 descriptor 注入。失败 TAP 保留于 ignored build，本记录不把初次失败改写为通过。

## 浏览器证据与边界

使用 computer-use 技能，经工具控制 Chrome 与独立存储的 IAB；这是同一机器的两个独立浏览器，不是两台设备。运行正式静态 build 与 opt-in profile adapter，独立 ignored 数据目录；没有改用户已有存档。

- 原 StarterSelect：一席妙蛙种子，一席小火龙，原确认框与个人资料提交真实入场。
- 两端显示四个原精灵资源／原血条／原 Command/Fight/Target。本人名称空白已用原 generateName 修复；背景与地台已恢复。
- 原首回合两席攻击意图真实落盘。修复 StatChange 后，同目录重启服务并恢复原房间，推进到 revision 3／回合 2；两席各仅扣 1 PP，inputs 清空。
- 两端刷新可从个人 IndexedDB 恢复对应席位、原模型与 34/35 PP。目标取消后 revision、inputs、PP 不变；未接换人菜单被拦截。
- 第二次共同 FIGHT 已完成，两端共同收到 revision 4／回合 3 的 preparation 快照，inputs 清空；小火龙累计扣 2 PP，妙蛙种子累计扣 1 PP（第二回合其行动前敌方已倒下，未额外消费）。两端均显示战后安全停点。最终截图在 ignored `build/vs02b04b-review/battle-after-two-rounds.png`，未提交。
- 本批浏览器实际覆盖创建／加入、原独立选队、双端原画面与目标选择、两回合、服务端同目录恢复、双端刷新与取消。尚未接整备 UI，所以没有宣称战后继续第二战或第二设备。

Vite 启动后 HTTP 请求超时，改用仓库原 `server/start.mjs` 正式静态服务后浏览器可正常连接。没有改代理、浏览器安全设置，也没有将超时写成双浏览器成功。

完整命令：`node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs`。完整 TAP、退出码、执行元数据及浏览器摘要均在 ignored `build/vs02b04b-review/`，不提交。测试使用真实 Worker 和双 WS，未 skip 或放宽旧断言。

## 仍未完成／下一批

这只验收普通战斗显示与 FIGHT 接缝，不代表 MVP 上线或完整 M3/M4/M5。客户端当前显示已结算快照，没有逐事件原招式动画／文本队列；公开状态与复杂外观仍需扩展。原整备菜单、升级／学招／替补等交互尚未全部绑定。捕获、主动换人、个人本局备用／战后换队是用户要求的 MVP 必需项，必须继续实现，不能永久写成 MVP 排除项。孵化／永久收藏事务仍后置，非空蛋库存保持原样。下一批先补这些原局内输入端口与事件展示／失败重同步，再做普通首战→整备→下一战的双浏览器连续游玩及第二设备验收。
