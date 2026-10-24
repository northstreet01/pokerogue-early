# VS22S 后续推进与原捕获表现维护记录

本批由用户授权打通后续战斗并补捕获动画，优先复用early。仅early，未合并、推送或部署；源码/测试冻结d986351002782c00b9d67c77fe0d1f75e53ab83c，553个blob与最终工作区零差异。独立118文件完整串行1332/1332通过、退出0，2016340.3928ms，fail/cancelled/skipped/todo均0。最终类型、Worker和生产构建均退出0（生产1m43s）。基线工程c07b90d7、源码/测试b2476d1e；旧1314及22R20不作为本批证据。真实双浏览器仍待验。

## 本批规则

- 双方所有个人队伍都按原Faint流程倒下后，结束冒险并返回Home；原复活种子仍先执行，不根据尚未完成倒下结算的临时零HP提前结束。
- Boss券双方各一份原版权益。用户明确扭蛋后置：这里只保存每席`voucher-pending`事实，不接抽取、不增加可消费券余额、不因永久收藏未接而卡住冒险。
- 待领取记录包含原voucher ID、类型、数量、owner及`original-unlock-or-repeat`核销方式。记录ID包含波次与席位，未来以runId和记录ID共同去重。后续永久事务按本人原解锁记录判断首次奖励/重复VOUCHER，原子核销并去重。服务器现阶段不能冒充已经写入个人系统存档。
- 不改原伤害、Boss清段强化、路线池、RNG、升级、进化或捕获判定公式。共享有限商店和个人钱包沿既有批准规则。

## 实施内容

Worker给原EnemyPokemon的Boss血条提供纯显示端口，检查点保留原bossSegments/bossSegmentIndex，客户端用原BattleInfo重建分段。原LevelCap/WeatherEffect阶段纳入支持范围。原里程碑固定奖励由VictoryPhase原queueAftermath声明，再以两个个人原ModifierReward阶段结算，不手写波次奖励公式。

下一战事务执行原SelectBiome、PartyHeal、SwitchBiome、NewBiomeEncounter及原返回/训练家显示，地图生成与遭遇创建同一个原子候选。个人HP/状态/PP重置与原PartyHeal独立参考执行比较，其余金钱、球、道具、蛋及个人字段一致性检查保留。无Map道具时走原随机路线；共同Map选择政策未扩展。

原部分训练家`useSameSeedForAllMembers`会在成员生成时主动进入同一种子范围，可能生成相同ID。第12波帕奇利兹与电飞鼠就出现此情况，严格roster拒绝DUPLICATE_ID。诊断记录原genPartyMember的两次seed作用域和ID随机流一致，属于原生成语义，并非房间流串用。联机仅在原构造结束、seen/持有物引用产生前分配未使用标识；保留原生成的IV、性别、闪光、性格、技能及流状态，不额外抽随机数、不放宽唯一性校验。之后实际通过第12波。

另一个自然种子在第2波异常状态触发setFrameRate误调用Phaser动画库，已将此纯显示方法接入Worker显示端口；原trySetStatus及状态规则继续执行。

原AttemptCapturePhase视觉方法命名提取，与单人共用扔球、吸入、落球弹跳、摇晃、捕获星星及挣脱序列。单人start仍按原顺序扣球、算阈值并调用原检查；服务端记录实际检查结果，公开事件先播完整动画再显示原成功/失败及离场。客户端只消费已提交trace，不再次判定或扣球；取消负责清理补间、临时物体、声音及迟到回调。星星粒子采用独立视觉随机，不能污染或调用权威RNG。

## 已发生的探测与失败

所有数据在ignored `build/vs02b22s`；真实用户房间未修改，不提交个人房间/资料/令牌。

- natural-a至f依次暴露里程碑奖励未放行、声明奖励临时phase重复end、地图校验重置范围、状态undefined元数据以及第12波重复ID。原始失败日志保留。
- natural-g保留修复ID后的首条路线第12波正常战败，另一种子第8波正常战败；steady-1第2波的动画帧率错误另保存调用栈。
- natural-h默认原资料、IV10、合法预算选队，仅正常攻击/换人/有限商店/学招/进化，进入第17波后驱动漏处理整备内学招而报INVALID_LEARN_ACTION。补驱动后从同一原检查点继续；resumed-i在20波原进化菜单因驱动未处理无options结构而停止，resumed-j缺pokemonId被拒绝；没有修改产品以绕过这两个必要选择。
- resumed-k正确提交原进化选择，完成20→21，进入25波原劲敌并正常全灭，error为null。此路线证明10/11/12/20/21及25入场，不代表55或全内容已验证。
- capture-a为14/15，原星星视觉随机在strict host下报UNSEEDED_RULE_RANDOM；已提供独立视觉粒子随机后，capture-b为15/15退出0、7873.5222ms。
- trainer-a为10/10退出0、67281.8275ms，包括原Boss每席待领取接口、恢复后不重复发事实、不改变玩家资源。
- progression-a联合131项中130通过、1失败，退出1、195463.9238ms。新增断言误认双野怪都至少两段；原Encounter按BST平衡把一只降为一段，20波训练家Boss也不等同野怪分段。修正为核对原两类Boss实际语义，未修改原规则/冻结fixture；独立重跑进行中。捕获/返回Home等通过不能拼接成整轮通过。
- progression-b为5/6退出1：21换图注入点是原进化选择，测试夹具误标battle，正确被INVALID_CHECKPOINT拒绝。改为保留自然envelope的stage/provisioning/intents，独立progression-c为6/6退出0、130024.918ms，包括11/21的双WS磁盘失败、重启、模型ACK及重发去重。
- 追加原训练家独立构造属性对照后，progression-d为6/7退出1，诊断入口误传两只而旧fixture入口要求三只；未修改产品准入。修正诊断夹具后progression-e为7/7退出0、130066.6102ms。再给独立参考构造补显示分配端口，原属性对照诊断通过，冻结代码交由完整回归确认。
- 最终类型typecheck-final、Worker runtime-final、生产build-final均退出0。独立118文件完整串行回归于2026-10-24T08:20:43.177Z启动，08:54:19.714Z结束，full-final为唯一最终完整日志，1332/1332退出0，未拼接历史定向或失败结果。

## 最终验收结论

本批原规则、检查点恢复、双WS/模型ACK、磁盘失败及输入去重自动验收通过。553个源码/测试/资源/配置blob在完整回归后再次与冻结提交核对，零差异；分支feature/vs02b21-22-original-completion，main、origin/main与收尾实时远端main仍86798227ca995c4ff40043b99a0c6846ed177154。源码、原始TAP、真实退出、构建、运行时SHA256与Git证据在ignored build/vs02b22s/final-source-blobs.json和final-evidence.json中；没有提交真实房间、资料或令牌。

自然路线可实证正常推进至第25波劲敌，尚未打赢25；该局因正常全灭结束，不能承诺55或所有种子。真实浏览器、声音和画面观感未执行，仍由用户按[手测清单](vs02b22s-manual-acceptance.md)复测；不宣称全道具、M6、扭蛋、所有特殊遭遇或终局已通。

下一开发范围仍为原TM、进化道具与暂停进化恢复，完整本地任务书仅备；本批完成后停止扩展，等待用户实测或下一授权。
