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
