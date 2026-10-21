# VS-02B-10续接：原版六只上限与捕获取舍

## 起点与范围

2026-10-21继续用户明确授权的本批开发。实际起点3f294a7232340576eb24a808e4cc8adc2a05d3d4，feature/vs02b10-reserve-team，工作区干净、唯一worktree；本地main／origin/main及实时远端main均86798227ca995c4ff40043b99a0c6846ed177154；远端断电备份188ae6da5a9d26248306a3256020509b4e425a2c。未联系其它agent，未操作参考目录。本次不把上次推送授权扩大为自动再次推送，不合main。

玩法以用户纠正为准：本人最多保留6只；未满6只直接加入本人party，满员捕获必须选择放弃新捕获或放生本人原规则允许的非前场成员后接纳。没有新的无限reserve。旧库存保留并在整备时逐只显式处理，不能静默清空。

## A：规则、正式事务及旧存档

复用原AttemptCapturePhase.finishCatch／EnemyPokemon.addToParty，原PartyUiHandler.doRelease负责本人道具移除／party删除／销毁／回调；抽出共用native放生端口，显示文案和销毁仍是headless展示端口，不替代规则。满员选择保留原capture-select阶段，不重投球、不重跑捕获RNG。旧备用只在原preparation个人无ready／selection／subdecision及pending growth时处理；复用原场景个人party视图及binding.sync，保留完整原个体、个人资源、原奖励、待续阶段、蛋、RNG和永久收藏pending事实。释放ID进入retiredIds；伙伴队伍不被删除。

旧库存每次只开放本人第一只的保留／放弃选项：不足6只直接入队，满员则选择本人非前场成员放生后入队。未处理完不能ready、进入下一战或再投球；已准备可先走原unready。旧战斗中仍可正常FIGHT至整备处理。保留通用M2旧codec的reserve兼容，不再将其reserve-swap暴露为生产功能；移除本批已废弃的额外reserve-swap runner。旧整备有未完成成长时先保留并拒绝迁移，不吞掉pending growth；成长接入仍另批。

修复满员阶段的capture-pending／dex-ivs恢复：按同一野生来源和owner更新既有pending事实到接纳后的稳定ID，禁止静默覆盖不同owner／来源／非pending事实；放弃个体仍保留原捕获事实和原模型快照，不伪造永久授予。修复dex-ivs已先绑定野生ID后漏更新的问题。原safe decision ID递增提取为共用函数，算法不变。

定向真实Worker14/14、退出0，17145.8971ms（原捕获7项＋本批队伍7项）；正式双WS模块20/20、退出0，59359.2563ms。后者包含普通球单输入重启／候选失败、满员接纳和放弃各自的选择前关服、候选落盘失败、持久输入重试、提交后再关服、去重／异内容冲突／两房间隔离及下一战FIGHT；另有旧版库存迁移相同故障切片、自然倒下强制换人恢复。均为正式adapter／房间Worker／FormalRoomStore和模型apply→capture→ACK，不是浏览器证明。

满员夹具从真实v2六只选队Worker构造，初始Master Ball库存显式合成，只用于确定性成功；正式WS使用该既有初始checkpoint端口，之后所有动作都走正式adapter／Worker，不将该夹具描述为用户原选队或预算验收。普通球原成功／失败回归保留；两席同实例捕获、满员逐阶段全新Worker恢复差分亦通过。旧库存迁移使用明确标记的旧版checkpoint及pending事实夹具。

首轮WS测试2/4失败：一处尚存旧reserve长度断言，改为本人party人数及完整个体；另一处固定断言倒下前场必扣PP，改为合法战前选择存活后备再验证真实出招，并未改HP或弱化出招断言。后续完整模块20/20通过，早期失败日志保留在ignored build/vs02b10-resume。

## B与最终验证

原Confirm／Party RELEASE／只读Summary已接入，旧分页与战后换队按钮已撤掉；代码和最终验证将在下一段提交后补记。当前不以历史44项UI作为新版通过证据。浏览器由用户测试，未执行项目不标通过。

### B实现与定向

满员捕获在原Confirm询问，确认后用本人原Party RELEASE选择成员，可查看原只读Summary；取消选择回询问，最终放生前再用原Confirm确认。原Party新增可选submitReleaseOnly参数：合作页只返回选择，不调用本地doRelease；单人无参数仍走原放生。浏览器只提交服务器option中的releaseId（含0）或放弃，既有IndexedDB先落盘／actionId／receipt／ACK不变。旧库存的不足6只保留／放弃及满员放生复用同一原菜单链，不再有仓库分页或新战后交换功能。

菜单依旧使用原Pokemon显示容器、codec副本及原资源加载，不运行Pokemon构造／规则RNG，不在客户端更改party归属／数量／HP／PP／资源。原摘要仍只读，取消／重复快照／新revision／epoch／加载期间断线／同快照重开菜单会清理副本并失效旧回调。新捕获拒绝或outbox写入失败可重新选择；已用确认不会重复提交。原Party RELEASE实际方法定向证实合作不执行本地删除，而单人仍执行原放生。

新版UI＋输入定向50/50、退出0，13694.434ms，正常1..50，无失败／取消／跳过／todo。该测试使用真实控制器及原Party／Summary输入方法，资源端口无画布；不能当作双浏览器画面验收。最终typecheck／Worker／生产build及完整串行结果另记，尚未执行的浏览器项目继续待用户。

### 完整回归发现的兼容修复

17a10199首轮全套暴露上次9b22a02c新增的强制换人scope检查不兼容既有共享场景runner：原合法modal Switch保存null scope，但fieldIndex仍是唯一owner。未删除owner断言、未改冻结fixture；在phase-state capture／restore把这个旧表示规范化为原fieldIndex，保留当前decision的scope=seat、modal=true、doReturn=false和fieldIndex=seat检查。显式冲突scope仍拒绝，原shared/null表示与显式正确scope执行出同一原换人结果。

修订定向64/64、退出0，41139.7893ms，含原faint／battle-items／phase-state及本批队伍。新增明确冲突scope及两个标志拒绝，旧null恢复等价；首轮全套已主动中止，工具退出1、没有完整TAP收尾，不计任何全套通过。原日志保留full-interrupted-switch-scope.tap，执行HEAD／源码清单另存execution-first文件；修复后从新提交重新执行完整串行。

75ca4d80第二轮全套又定位到既有replacement负例：测试在断言外调用codec.restore构造isModal=false的损坏输入，新的严格检查已在此处拒绝。改为明确断言restore抛INVALID_SWITCH_DECISION，再用内存损坏的live phase验证执行入口也拒绝，且原context不变；没有放宽生产规则或删掉负例。replacement定向10/10、退出0，9539.9491ms。第二轮同样主动中止，工具退出1、无完整TAP收尾，不计全套通过；保留full-interrupted-negative-assertion.tap。此次仅测试／文档变更，75ca4d80的最终类型检查／Worker构建／生产build对应源码不变（build退出0、49.69s），最终全套会从更新后的测试提交重新执行。

收尾原菜单检查补上旧捕获取舍的具体名称／等级和待放生成员名称，均通过原codec副本generateName构建；缺少对应本人个体则拒绝打开选择，不能对不明个体提交。UI＋输入再次50/50、退出0，12855.7464ms。为保证最终完整日志全部对应同一冻结树，中止686df549启动的第三轮并保留full-interrupted-choice-label.tap（工具退出1、无完整收尾，不计通过）；从此文字修订提交重新构建并执行最终全套。
