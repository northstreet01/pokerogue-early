# VS-02B-18维护者验收：原树果与常规持久道具

2026-10-23，用户明确“开始推进”，随后要求复用、参考原版。仅在early实施，未创建/联系agent，未合并/推送。本片A/B代码和自动验收通过；最终源码/测试cff4152b完整单次串行1244/1244、退出0、2244186.8359ms（约37分24秒），fail/cancelled/skipped/todo均0。**真实双浏览器未执行**，见[手测清单](vs02b18-manual-acceptance.md)。不标全道具、完整M3/MVP或七项用户实测全部完成。

## 起点、提交与复用

开工只读核对17文档HEAD4e80302299557b7bda3da17c4dcf3aeb8294a0c3、源码/测试ca524be6、feature/vs02b17-preparation-shop，tracked干净、单worktree；实际main/origin/main与只读实时远端均86798227ca995c4ff40043b99a0c6846ed177154，未发现同项目其他活跃开发。另开本地分支feature/vs02b18-persistent-berry，未从main丢失14–17成果。

- A：ba623de2313299378a453df776ebcf4d8f3d6218，原Berry/Heal执行入口、普通持久机制准入/个人过滤、原更新异步观察及私有投影。
- B：d6c3e9094659de3821fdc0c87ab83eab86fdab5c，真实原modifier客户端模型、原Party过滤与本人层数显示、WS和UI链路验收。
- 899e594bad99ac6837f06d8baef76dce1c31f710：原Party/Summary handler同样使用并恢复临时本人道具显示库存。
- 生产源码f31c5f141e74fdea4425ea075531ccb6ce06dbc8：修正临时原显示端口的TS私有属性访问声明，编译后规则逻辑不变。
- 最终源码/测试冻结cff4152b0640ee30939b8ed225ce27257c6787ce：仅更新旧P12真实奖励测试为成功领取/恢复/隔离断言，src/server/scripts及构建入口与f31c5f14完全相同。

复用完整原BerryPhase、PokemonHealPhase、TurnEnd、BerryModifier/效果/特性/随机、SelectModifier回调、addModifier/updateModifiers/updatePartyForModifiers、原calculateStats及filter/上限/满层默认替代；未改原公式、概率、原奖励/商店工厂或单人规则。复用既有codec、个人视图、modifier-scope、任务观察器、正式adapter/store、模型apply→capture→ACK和IDB outbox；旧M3 VM冻结参考仅用于测试，生产没有导入tests/helpers或源码提取driver。

## A：自然阻断及后续效果

自然默认收藏seed learning-natural-2、A呆火鳄/杰尼龟、B新叶喵/杰尼龟，首战胜利→原整备跳过并完成→战前保持→第二战双方首个普通攻击target2，改动前真实Worker复现UNSUPPORTED_NATIVE_ENTRY_PHASE，red退出1。未改攻击/HP/敌方生成、未删树果或跳阶段。原阶段准入后，该自然敌方树果实际消耗，逐原阶段JSON恢复与连续运行的原状态/RNG/队列内容一致，能到下一合法输入，包含原强制替补；此自然树果不预设一定是治疗型。阶段局部phaseId分配在连续/重开binding间可不同，比较保留原阶段类型/字段/作用域、顺序及全部规则状态，单独排除该临时编号。

机制准入依据已验证原modifier精确prototype，不用产品catalogId白名单，也不放开全部PersistentModifier。支持全局经验/治疗/经验共享/额外奖励/金钱倍率/果袋，个人经验、基础能力维生素、属性攻击、性格、树果和临时能力；同机制原生成变体按原参数运行。代表工厂EXP_CHARM/HEALING_CHARM/EXP_SHARE/GOLDEN_POKEBALL/AMULET_COIN/LUCKY_EGG/BASE_STAT_BOOSTER/ATTACK_TYPE_BOOSTER/BERRY/TEMP_STAT_BOOSTER/SOUL_DEW/BERRY_POUCH。满层全局沿原tier默认替代，提示作为本人私有显示事件，不污染战斗队列；held cap、维生素IV上限及原目标过滤不重写。

两席分别真实领取/堆叠、纯校验/外席/满层、JSON与新Worker重放、同奖励拒绝、伙伴/队列/蛋/RNG保护；维生素断言真实stats/最大HP及HP差，性格加成用明确标记的合成Adamant条件验证。合成低HP容量隔离原Potion满血钳制，验证已领取治疗加成；金钱奖励增益、下次原奖励数量、实际下一战EXP/合格非参战EXP、普通攻击伤害均有正式native使用断言。队员可能原强制换人，经验比较按稳定pokemonId，不依赖结束时party下标。

合成原工厂奖励和触发条件与上述自然敌方病例分开标识。本人树果由原TurnEnd实际排入BerryPhase，覆盖HP、解状态、能力/随机能力、PP，逐阶段恢复不重复消费或效果；果袋满原层数保留树果，原battle RNG推进、scene RNG保持，JSON重放一致。未知复杂机制接收前拒绝，可改选/跳过。

原更新方法及每个实际Pokemon.updateInfo任务受观察，原updatePartyForModifiers/addModifier的allSettled不能吞掉失败后发布半成品。原子类updateInfo异步拒绝注入保留完整原add/updateParty函数体，另测原updateModifiers/updateParty自身异步拒绝；全部拒绝候选且输入不变。多场景任务全部settle后才抛出失败/解除绑定，保留原个人/敌方归属。

## B：原UI、持久恢复与边界

个人投影使用原captureModifierState，仅本人持久道具，不泄露伙伴库存。真实客户端恢复原实例，captureAppliedState重新捕获实际实例；改层数会改变待ACK内容，非直接回传收到的JSON。大厅resources:null保留，兼容现有空资源阶段。原Party目标过滤绑定独立本人scene/库存/显示队伍；Party/Summary handler持有图标使用同一临时本人库存，取消/转场恢复原场景，不给验证模型绑定scene、不执行本地规则。

展示本人已提交原道具名称、层数、持有者及临时剩余战数；提交前不预发道具/改stats，伙伴只有批准公共信息。沿既有menu/team epoch、revision与退出生命周期，一次选择占用、旧回调和连点不重复提交；原17shop/reroll/完成、14退出、15捕获和16选队均保留。

新真实WS测试分别覆盖两席held领取结果落盘失败、只有已接受输入持久化后停服、新服务恢复一次原效果、相同actionId去重/异内容ACTION_ID_CONFLICT、本人/伙伴私有快照、双模型ACK及后续普通FIGHT；第三项覆盖只一个ACK不能行动及两房间隔离。新两席原ModifierSelect→Party回调→真实IDB/WS/完整原Worker→真实模型ACK→本人层数显示→完成整备/下场FIGHT联测。该UI病例明确注入自然第一整备检查点中的合成原工厂，渲染/资产端口headless；旧16选队、17商店和15捕获仍从真实profile lobby自然进入。

## 验证与失败历史

日志均仅本地ignored build/vs02b18/，没有拼接TAP或把17通过当成本片通过。

- berry-red：1项失败，退出1，原自然Berry准入缺口。
- berry-green-attempt1：1项失败，退出1，测试在已到输入边界又调用continue，修正测试边界门控。
- native-attempt2/3：各27项、24通过3失败、退出1；恢复测试首次暴露局部phaseId分配差异；满层原提示需要准备阶段私有展示端口；合成默认tier未指定时原规则给普通球，明确设合成tier2后检验原Ultra替代，未改生产规则。
- native-effects-attempt4：54项27通过/27失败、退出1，下一战另一处旧空库存guard及合成Potion辅助目标分类遗漏。attempt5：54项47通过/7失败、退出1，合成维生素超默认IV上限/默认中性性格、治疗满HP钳制、自然enemy berry效果预期及scene/battle随机流测试假设错误。没有靠更改原公式或移除实际效果断言通过。
- native-combined-attempt6：89项85通过/4失败、退出1，两个性格用例条件及两个经验用例错误使用战后party下标；按原非中性性格和稳定id修正。effect-diagnose7为4项2通过/2失败、退出1，单独保存原数据证明强制替补交换了次序；native-A最后54/54、退出0、69331.8985ms。
- UI-WS-attempt1：本机WS沙箱EACCES，已记录失败，手动中断直接退出1，无完整TAP收尾。attempt2-owned：夹具昵称超过原24字符协议限制，缩短并增加失败清理；中断退出1，未当完整通过。attempt3-owned：WS三项已通过，但客户端新增modifiers漏保留大厅resources:null，修复后重跑，中断退出1、无完整收尾。
- UI-WS-attempt4-owned：完整114/114、退出0、104429.2759ms（3新WS、8原UI→IDB/WS、103UI）。真实浏览器未执行。该轮之后补Party/Summary库存绑定和一项原updateInfo失败回归，故仍需最终冻结验证。
- typecheck-final第一次退出2，临时显示端口触及原BattleScene私有属性，改为同已有临时party端口的显式类型适配；typecheck-final2退出0。
- target-frozen完整联合211/211、退出0、238917.9503ms：18原冻结persistent对照、35旧native消费、55本批native、103UI。运行中仅修订上述TS访问标注，不改变发出的JS规则；不替代下述冻结完整回归。

Worker与生产构建退出0，生产Vite1m44s；均在f31c5f14生产源码完成，cff4152b仅改一份QA测试，无生产变化，不重复构建。

首次完整尝试full-final-owned基于f31c5f14，观察到306个结果（305通过/1失败）后主动中断，工具实际退出1，无完整TAP计划或总耗时，不能称完整回归。唯一已观察失败是旧P12把自然真实已接普通持久奖励仍预期PREPARATION_EFFECT_UNAVAILABLE。未修改生产代码或真实菜单；改为成功一次领取、原type/stackCount、输入和伙伴/roster/队列/RNG不变、新Worker确定性和重复拒绝，保留原合法skip控制对照。未接机制仍有独立EXP_BALANCE拒绝用例。qa-P12-fix第一次44项43通过/1失败、退出1，测试主进程新加载原目录尚未初始化，补原describeOriginalCatalogs后qa-P12-fix2为44/44、退出0、27306.1579ms。

最终full-second-final-owned在cff4152b冻结后重新从头单次完整串行运行，1..1244、1244通过、退出0、2244186.8359ms（约37分24秒），fail/cancelled/skipped/todo均0；P12及本批55 native/3 WS/新增原UI链均在本次全套通过，未拼接前次305个结果。收尾源码/测试/运行入口blob与本次启动清单比较0差异，源码工作树无变化；本地main/origin/main及收尾只读实时远端main均86798227ca995c4ff40043b99a0c6846ed177154，单worktree。最终只提交工程文档，不修改冻结源码测试，SPEC与所有AGENT/PROMPT继续本地忽略；未合并、未推送。

## 结论与下一片

18关闭自然已复现Berry阻断，并接通上述常规机制的领取及实际使用；不能扩大为全道具、所有合法长局或完整战斗展示通过。复杂成长/全队复活/TM/进化/融合/转移、完整持有物捕获/偷取、敌方概率复活、M6永久提交、特殊遭遇/Boss/地图与跨设备部署仍未接；券和同时全灭政策仍未确认。每人6只/满员原取舍、个人蛋/v6-v7/pending、合作诱饵排除、个人10/共享14及Trainer奖金平分保持。

第1统一入口/局外UI未实施，第2/3/4/6/7仍待真实双浏览器/用户复测，第5展示部分；不因树果/WS自动通过关闭原捕获实测故障。下一独立片19建议统一初始入口及个人收藏/蛋/已有券的原界面查看与返回，完整任务书仅本地准备，用户另行授权才开工，不在本片自动实施。剩余六类是范围分组，不是固定六批或等量工期。
