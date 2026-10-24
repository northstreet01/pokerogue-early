# VS22R 第8波劲敌胜利卡住修复

2026-10-24，用户实际试玩报告：第8波遭遇劲敌，击败最后一只后卡住。基线工程d44ff5f5，源码/测试83ae8614；该旧基线完整1314/1314不覆盖本次修复，也不能否定用户实测故障。仅在early修复，不创建或联系agent、不合并/推送/部署，不实施下一整批23。

## 原因与重放

实际房间仍保存第8波、revision 53、双方已接受的最后行动。维护者复制到ignored build/vs02b22r，使用正式adapter和独立Worker重放，复现UNSUPPORTED_NATIVE_ENTRY_PHASE；逐原阶段执行定位到TrainerVictoryPhase之后的ModifierRewardPhase。最后一次行动的候选未成功提交，原房间和双方输入仍保留。此前浏览器翻译扩展、favicon和AudioContext提示不能解释此故障。

原src/battle.ts固定第8波为RIVAL；原trainer-config为其配置SUPER_EXP_CHARM和EXP_SHARE。原TrainerVictoryPhase完整排入固定奖励，但native白名单漏接ModifierRewardPhase。过去普通训练家奖金及下一战测试没有覆盖带固定奖励的劲敌胜利，这属于实际覆盖缺口，不是Boss或券政策拒绝。

## 修复

接通原ModifierRewardPhase.start/doReward，仍由原newModifier、addModifier、叠层/满层处理及异步更新决定结果。每项固定奖励拆成两个有席位归属的原阶段，各个人队伍获得一次原奖励；逐阶段检查点保存已完成与待处理席位，重启不重放TrainerVictory或给第一席重复加层。奖励消息只向本人投影，异步奖励Promise接入现有任务观察器，失败候选不可提交。

只接当前非Boss训练家配置中确实声明、无需目标的已支持持久奖励。无归属、配置外奖励、特殊子类及券仍明确拒绝，不吞阶段或跳奖励。原奖金总额均分、免费/付费共享限量、个人钱包及自动整备保持既有规则。没有改动单人TrainerVictory或ModifierReward规则体、冻结fixture、真实房间、个人存档或席位令牌。

## 验证与证据

源码/测试b2476d1e013c44df4ec17b81863fe6eb0a64fafc。最终独立联合定向20/20、退出0、135473.6998ms，fail/cancelled/skipped/todo均0；类型检查、Worker和生产构建均退出0。本次为用户实测故障的定向修复，没有自动重跑全套；旧1314/1314仅属于83ae8614，不是本修订完整回归。原始日志与真实退出保存在ignored build/vs02b22r；不把失败轮次或旧1314/1314拼成本次通过。新的回归使用原训练家构造、队伍生成及正常攻击的明确合成低HP夹具，不把该夹具称为自然第8波；实际第8波另用用户房间的隔离副本验证。

首轮新增回归rival-a为4通过/1失败、退出1；失败项是手写modifierType阶段字段遗漏原codec要求的state封装，尚未到所有权校验。修正测试夹具封装，不放宽原codec和拒绝条件。后续联合回归第一轮的真实房间副本测试又发现客户端测试进程未初始化原目录而报unknown species，已补describeOriginalCatalogs；正式Worker已初始化，不据此改产品或跳过模型ACK。失败日志保留。

联合rival-b完整20项中18通过/2失败、退出1、191144.0081ms；两项分别为上述客户端夹具目录未初始化，以及配置外奖励测试误用不存在的MONEY_CHARM工厂。后者改用真实EXP_CHARM，与劲敌配置中的SUPER_EXP_CHARM区分；仍要求准确拒绝配置外奖励，不扩大接收范围。修正后独立联合重跑，不拼接18项。

首轮类型检查退出2，发现新增两个场景端口访问需要沿native既有方式显式声明类型；仅补类型断言，未改执行表达式。失败日志typecheck-first保留。最终Worker产物与20项回归实际使用产物的SHA256另存对照，防止把其他运行时代码的通过结果当最终证据。

## 后续波次与换图核查

用户进一步要求确认后续是否卡停。沿同一实际房间隔离副本，从第9波wait-actions使用合法攻击/必要换人/原共享整备继续推进，未改HP、经验、波次、RNG或绕过规则。第9波实际胜利并完成整备，进入第10波时正式adapter返回ORIGINAL_RUNTIME_FAILED；原始进程内调用定位为TypeError: this.setVisible is not a function，来自NextEncounterPhase.start对Boss调用Pokemon.initBattleInfo、构造EnemyBattleInfo/BattleInfo。错误已保存于ignored continuation-probe.json/log和probe-next-detail.log，不是用户输错或本轮第8波固定奖励再次失败。

| 节点 | 证据与当前结论 |
|---|---|
| 第8波劲敌→共享商店→第9波输入 | 实际存档隔离副本、双WS和模型ACK通过；本次修复范围 |
| 第9波战斗及整备 | 实际副本正常完成，包含原必要换人；不能据此保证所有队伍/种子 |
| 第9→10波 | 实际副本首次后续阻断：服务端Boss血条误调用Phaser渲染；即使只补显示端口，nextNativeBattle仍有明确UNSUPPORTED_NATIVE_ENCOUNTER_BOSS拒绝，Boss规则未验收 |
| 第10→11波换地图 | 静态核查缺口，尚无自然运行通过：原newBattle排Return/ShowTrainer、SelectBiome、NewBiomeEncounter、可能LevelCap及后续PartyHeal；当前next-battle事务只接受NewBattle/NextEncounter和训练家前置收回，未完整接换图 |
| 更后波次 | 未自然走到，不能承诺25/55/95或通关；RIVAL_2原配置合成回归通过不等于自然第25波验收 |

首个连续探测驱动误选已完成席位，收到合法PREPARATION_ALREADY_FINISHED；修正为选未ready席位后才得到上述第10波真实错误。该驱动问题与产品故障分开记录，未改变产品整备规则。实际存档不改，所有复制数据和令牌仅在ignored或临时隔离目录。

因此本版本只能实证这条路线完成至第9波，不能将第8波已修或旧完整回归理解为长局已通。其他种子仍可能更早触发未接的特殊阶段；捕获敌方持有物、到期孵化与M6、同时全灭、Boss/特殊遭遇继续是边界。下一优先修复应为第10波Boss及第11波完整换图/恢复事务，而非先扩TM；本轮只确认和记录这些后续缺口，不取消安全校验或自动扩大为整批开发。

实际房间的隔离磁盘副本经正式service、双方真实原模型apply/capture/ACK和双WebSocket恢复，沿保存的两个原行动完成第8波、双方各获一次固定奖励、进入共享商店，双方完成后达到第9波wait-actions；真实房间字节未变。未把用户房间、存档、令牌或私人checkpoint提交到Git。新提交只含生产桥与回归测试；工程收尾另提交。

549个源码/测试/资源/配置blob冻结清单及最终Git、实时远端、检查结果和日志摘要见ignored build/vs02b22r/final-source-blobs.json与final-evidence.json。

## 用户复测

完成修复构建后，关闭旧服务，再在early以COOP_PROFILE_LOBBY=1启动start:server。双方刷新，从首页选择“恢复已有联机”回到原房间；已有双方输入会在恢复核验后重试。应完成原胜利结算、每人各得一次固定经验奖励、进入共享商店，正常完成后进入第9波。真实浏览器音画仍需用户复测，隔离双WS/原模型测试不等于实际画面通过。

TM/进化道具入口、暂停进化重新开启、M6永久收藏事务、Boss/特殊遭遇及部署仍是之前边界，没有混入本次修复。
