# 新窗口开发交接

2026-10-23 VS-02B-17最新覆盖：用户明确继续下一批，已实施原个人金钱、常用道具购买/重抽和原页完成整备。A5c0529cb7a71130af1223f9f66271d11ed62998c，Bfe8c22a7457d4cebb1777bb4a246f06cee61a143，奖金WS断言修订/最终源码测试ca524be6a8ae42368cd883bb1b7c5c1cc257f670，分支feature/vs02b17-preparation-shop。复用完整原SelectModifier回调/商店工厂/addModifier/filter/任务观察器及正式store/ACK/outbox；HP/复活/状态/PP恢复/PP提升、球和金钱奖励已接，两席原工厂效果/原两行shop/连续买抽/故障重启和原UI自然链定向158/158、退出0、170788.9582ms。仅新selected冒险用原getStartingMoney初始化，旧0余额恢复不补发；原Trainer奖金仍+55/+55。原ModifierSelect内完成/取消准备，处理奖励后可继续购物，必要选择和旧回调/退出隔离保留。typecheck/Worker/生产构建均0，Vite58.30秒；最终源码/测试ca524be6单次完整串行1178/1178、退出0、1580679.2504ms（约26分20秒），fail/cancelled/skipped/todo均0，首次1177/1178的旧奖金余额预期失败完整保留，未拼接日志。见[17维护记录](mvp-vs-02b17-review.md)。真实双浏览器未执行，见[手测](vs02b17-manual-acceptance.md)。诊断发现自然第二战较弱普通攻击可触发敌方BerryPhase，当前仍明确未接并安全停止候选；较强攻击路线通过不覆盖这个缺口。下一独立片18优先原树果/常规持久道具生产链，仅准备本地完整任务书，不自动实施。一般复杂成长、统一入口/局外UI、全战斗展示、M6、特殊遭遇、跨设备仍待接。未创建/联系agent、未合并/未推送；下方“17未实施”为历史，用户第2/6/7真实确认与第5展示边界保留。

2026-10-23 VS-02B-16：用户要求继续实施实时选队。A34c28d81复用原profile校验/计价和正式房间持久化，新增可为空的profile-draft、每席单份预算和仅所选物种/形态/成本公共投影；最终ready仍1–6只且须匹配已接受草稿，已ready须先原队伍unready再改选，兼容无草稿的format3。Bc7495a34接原Starter增删/详情与恢复、未发送草稿合并/原outbox不变、限次过期重试和具体拒绝反馈；后台更新不关闭原菜单，确认/取消/重开按菜单epoch和原转场串行。最终源码c7495a3471357bd492956df4ae5fd53fea1f66f9，联合114/114退出0（65178.933ms），typecheck/Worker/生产构建退出0（Vite1m3s），完整串行1133/1133、退出0，1190092.7004ms（约19分50秒），fail/cancelled/skipped/todo均0。双席原回调→真实IDB/双WS/原模型ACK→selected Worker→双方FIGHT自动通过，真实双浏览器未执行，第2项待用户确认。详见[16维护记录](mvp-vs-02b16-review.md)与[手测](vs02b16-manual-acceptance.md)。分支feature/vs02b16-live-draft；未合并/未推送。用户已询问道具/商店/局外UI：下一独立片17优先个人金钱、常用道具购买/重抽及页内完成整备，只备完整任务书未实施；一般持久道具/复杂成长和局外统一入口/收藏/蛋/券UI仍独立待接。14/15及展示的真实双端缺证据继续保留。

2026-10-23 VS-02B-15：用户启动捕获故障修复，补充“选球后报错/无反应/卡住”，原错误文字不记得。A7209e794新增原phase结果观察/按席位投影及原Command/Ball→真实IDB/双WS/profile selected Worker/模型ACK联测；B3bd44da5修复同快照旧球回调、转场异常无恢复、重复ready打断提交，并复用原消息端口显示捕获成功/失败/取消。旧代码3项UI红测失败已修；联合89/89、退出0（40862.7838ms），typecheck/Worker/生产build退出0（53.95秒），本版完整串行1117/1117、退出0（1504204.0389ms，约25分04秒，fail/cancelled/skipped/todo均0）。仅修复已复现的同类问题，不认定就是用户原故障全部根因；真实双浏览器未执行，第6项待用户复测。完整记录[mvp-vs-02b15-review.md](mvp-vs-02b15-review.md)，[手测](vs02b15-manual-acceptance.md)。分支fix/vs02b15-capture-ui，源码/测试3bd44da53b20e1d04e27b09ab9458c28b2d92767；保留14退出/13展示取消与6只取舍/pending，不扩持有物捕获/M6/实时选队。未合并/未推送；下一批16实时选队，若用户仍报捕获错误先按新具体错误继续本故障。

2026-10-23 VS-02B-14：用户授权维护者直接实施退出链。A会话/持久恢复隔离提交7c436e00，B独立DOM退出/现有首页重开提示提交b7cc4f83；分支feature/vs02b14-safe-exit。复用原IndexedDB/outbox/consumer和展示取消，退出不等网络，IDB最多等500ms；保留旧房/伙伴/个人档案/蛋/pending，不撤销已提交行动。主动暂停阻断唯一旧席位回退，旧写盘/回调/连接不激活旧房或给新局发动作；失败首页明确未确认保存并提供fresh入口。B最终UI74/74退出0，A真实WS组合77/77退出0（此前沙箱73/77的EACCES失败日志保留）；最终typecheck/Worker/生产build均0，build50.84秒，完整串行1109/1109、退出0，1154703.4648ms（约19分15秒），无失败/取消/跳过/todo，源码/测试blob与运行记录0差异。真实双浏览器未执行，七项第7仅自动证据，不关闭捕获/实时选队。详见[mvp-vs-02b14-review.md](mvp-vs-02b14-review.md)和[手测清单](vs02b14-manual-acceptance.md)。未合并/未推送；下一片只定位捕获真实UI故障，不实施下一批。旧13记录保留为历史。

2026-10-23最终验证：源码/测试ace41bb6，完整串行1092/1092、退出0，2130421.0305ms，无失败/取消/跳过/todo；UI定向58/58、typecheck/Worker/生产build退出0（Vite1m35s）。受限EACCES中断历史单独保留，最终结果为允许本地连接后的独立完整运行。展示仍部分通过、浏览器待用户；main与实时远端仍86798227，未合并/未推送。

2026-10-23 VS-02B-13维护者复验：交付0055439d实际推进权威事件回放/最小Trainer descriptor/背景别名/显示名，不能算用户七项整改全部完成。源码修复2b66d130/ace41bb6（最终）：修正Common动画字段，取消旧加载/回放及原动画tween，消息完整显示、经验条收起、失败恢复最终HP、取消fade、Trainer刷新位置和迟到资源保护。最终UI定向58/58退出0；最终完整验证见[维护者复验](mvp-vs-02b13-review.md)。展示整体部分通过，双浏览器未执行，回合前HP/致死对象/双Trainer完整展示仍缺。下一片优先用户明确的退出回首页/重开，完整任务书本地AGENT-VS-02B-14-EXIT-PROMPT.md；捕获故障和实时选队另片，未开工，不合并/不推送。

2026-10-21 用户本地试玩反馈：仅登记优化整改，未开工。包括统一单人/联机入口、公共选队实时同步与共享14点并发反馈、战后整备页内完成按钮、原个人金钱显示、同步回合动画/血条/升级展示，以及当前捕获不可用、同步卡住时缺少强制退出回首页重开入口。全部待定位/开发/复验；不能用历史自动测试覆盖用户故障。后续优先补独立于同步成功的退出/重开入口，并关闭捕获与选队同步，原13任务书保留但需按反馈重排，不直接派发。详见[用户反馈与整改清单](coop-user-feedback-2026-10-21.md)。

2026-10-21 VS-02B-12R维护者：用户已确认训练家原版总奖金双方平分；源码f0bbc07d复用原MoneyReward逐席scope结算，原总额110→55/55，保留券策略保护。直接修复最后后备被消耗后的重复PostSummon、自然学招正式停点、原下一遭遇旧Trainer清理，补原Breeder/Clerk后备/DOUBLE/逐阶段恢复和正式倒下/补位/奖金事务。最终定向native9/9、正式WS4/4、typecheck/Worker/build通过；完整串行1082/1082、退出0，1141266.2153ms，无失败/取消/跳过/todo，结果见[复验](mvp-vs-02b12r-review.md)。普通核心可自然胜利→个人整备→原下一遭遇FIGHT；B原Trainer展示/对话未接齐、浏览器未执行，整体仍部分，下一批13只补该原UI生产链。旧“奖金归属未批准”已由用户本次决定覆盖；不是完整Trainer/Boss/MVP通过，未合并/未推送。

2026-10-21 VS-02B-12R：A通过到训练家倒下后的下一合法输入（通用fixed TRAINER准入、统一双打、原逐敌Victory/后备SwitchSummon），默认收藏自然wave5真实倒下测试3/3；B只到原TrainerVictory后MoneyReward的明确奖金归属边界，未写任何金钱，未做个人整备/wave6。完整1072/1072、退出0，typecheck/Worker/build通过；浏览器未执行。详见[本批记录](mvp-vs-02b12r-trainer-lifecycle.md)。

2026-10-21 用户纠正后续拆分：开发按机制划分，波次由原版自然分配。下一批12R改为“普通训练家通用生命周期”，A统一遭遇准入/合作双打及敌方倒下/原后备，B通用胜利/个人整备/原版自然下一战；第5波→第6波仅作默认收藏自然回归案例。替换临时wave===5支持判断，不扩成逐波白名单；特殊剧情/Boss/地图/成长未接时按具体机制停点，不跳过也不盲目开放。旧记录中的“只接某波”后续安排由本条覆盖，历史验收范围仍保留。完整任务书仅本地docs/AGENT-VS-02B-12R-PROMPT.md。本次只修改安排，不改生产代码、不增加功能完成声明。

本轮最终验证（VS-02B-12维护者，源码59c2bb25）：完整串行1071/1071、退出0，1086494.5792ms（约18分6秒），无失败/取消/跳过/todo；typecheck/Worker/生产build通过，生产build52.34秒。只验收默认收藏到wave5入口及有限非击倒回合，敌方倒下和胜利到6仍缺，A部分/B未开始/浏览器未执行。最终文档提交不改变测试源码。

2026-10-21 VS-02B-12维护者复验：交付A部分/B未开始属实。直接修复Trainer恢复后场景绑定、遭遇显示回调及pbTray端口、前置阶段零授予/队列核验、个人资源组件规范化和原训练家召回/遭遇池重置核验；源码59c2bb25。已从原默认收藏（呆火鳄+杰尼龟／新叶喵+杰尼龟，IV10默认配招，共12点）自然进入wave5到双方合法输入，有限非击倒FIGHT/原敌方AI可继续，native2/2、正式双WS1/1及typecheck通过。正常攻击首次敌方倒下仍被UNSUPPORTED_COOP_ENEMY_FAINT阻断，胜利/整备/wave6未接，A整体仍部分、B未开始，浏览器未执行。最终构建/完整回归见[维护者复验](mvp-vs-02b12-review.md)，不沿用历史1068；[手测边界](vs02b12-manual-acceptance.md)。下一片12R只补原Trainer敌方倒下/后备补位和胜利到6，不能只删WILD guard；任务书本地忽略。独立评审分支，未合并/未推送。

2026-10-21 VS-02B-12：wave5固定训练家入口部分接入（只放行wave5、原Trainer/NewBattle/NextEncounter/ShowTrainer，训练家显示端口）；自然路径已构造训练家但NextEncounter异步闭包仍报INCOMPLETE_NATIVE_PHASE，没有wave5战斗/胜利/整备/wave6。next-battle 22/22、typecheck/Worker/build通过；完整回归未跑，B未开始。详见[本批记录](mvp-vs-02b12-wave5.md)。

2026-10-21 VS-02B-11R维护者复验：自然学招有限自动生产链通过验收（原合法Azurill四招＋Snorlax，正常战斗wave4升6→泡沫光线替换/放弃→恢复→新招真实FIGHT），正式双WS从自然检查点验证写盘失败/重启/去重/隔离。直接修复挣扎选项、原缺员召唤/个人下标、原过关半血恢复、PostTurnStatusEffect及展示事件默认值。native15/15、学招WS4/4、typecheck/Worker/build通过；最终完整串行1068/1068、退出0（1067866.5445ms，无失败/取消/跳过），生产build约74秒。B原UI浏览器待用户，合法资料前置条件见[手测清单](vs02b11r-manual-acceptance.md)。源码/测试b4e856a3，独立评审分支未合并/未推送；[维护者复验](mvp-vs-02b11r-review.md)。下一片只接当前硬阻断原wave5 Youngster→wave6，不删除固定遭遇、不扩大整套训练家/进化/M6。

2026-10-21 VS-02B-11R 自然学招：修复 SummonMissingPhase 与存活席位 requiredSeats，让倒下/空场席位不再被要求提交；诊断案例已越过原召唤，但仍未自然触发 LevelUp→LearnMove，后续有空 fight options 的 INVALID_DECISION 和未支持 native phase 阻断。受影响 native 定向75/75、typecheck／Worker／build通过，完整串行1059/1059无失败（但无自然学招用例）；没有自然成功、正式双 WS 或浏览器。详见[本批记录](mvp-vs-02b11r-natural-learn.md)。

2026-10-21 VS-02B-11 维护者复验：独立修复 phase scope 比较／席位1错绑、暂停队列重复、Worker 自动学招显示端口、原后备 fieldIndex=-1、学招私有投影隔离、Confirm/Summary 显示生命周期与二次放弃／重选。真实 Worker＋既有学招26/26、原UI控制器49/49、正式双WS／FormalRoomStore学招故障恢复2/2通过；后者从明确合成学招起点开始，新招实际FIGHT通过。普通战斗自然触发链仍未关闭，浏览器待用户，A/B整体部分通过，不扩进化。最终完整串行1059/1059、退出0（1043319.5987ms，无失败／取消／跳过），typecheck／Worker／生产build均0（build51.18s）。源码／测试基点f429331d，独立评审分支未合并／未推送；详见[维护者复验](mvp-vs-02b11-review.md)。

2026-10-21 VS-02B-11 升级学招：A 代码接入原 LearnMovePhase 的 known／empty／满四招暂停、native progression 与 adapter 路由；B 接原 Confirm／SummaryUiMode.LEARN_MOVE 显示副本和 outbox 提交。既有 level-up／learn driver 18/18、typecheck／Worker／生产build通过，完整串行1046/1046无失败（但无新增生产学招用例）；仍**没有**真实自然升级生产 Worker、正式双 WS／重启／去重、原学招 UI 自动交互或双浏览器证据。A/B 均只能算可审查代码子集。详见[本批记录](mvp-vs-02b11-learn-move.md)。

2026-10-21 VS-02B-10续接完成代码与自动验收：每人最多6只，未满捕获直接入本人party，满员原Confirm／Party RELEASE取舍，包含本人当前前场；释放前场后由原SummonPhase.preSummon在下一战选择存活成员并初始化。旧reserve整备逐只显式处理，禁止新增无限仓库和未处理即ready，原战前选择保留。修复pending捕获事实ID／owner和旧强制Switch null scope规范化，保留严格owner／modal／返回检查。最终代码7e1ad8c3完整串行1046/1046、退出0（1028503.5465ms，无失败／取消／跳过），typecheck／Worker／生产build均0。A有限切片通过；B代码／自动通过、双浏览器待用户，整体部分通过。见[续接验收](mvp-vs-02b10-resume-review.md)及[手测清单](vs02b10-manual-acceptance.md)。下一批仅普通升级学招生产链，不扩进化／商店／M6；完整任务书仅本地。分支feature/vs02b10-reserve-team，未合main／未推送，断电备份不是本次完成版。

2026-10-21 VS-02B-10断电收尾：用户改定按原版每人最多6只，满员捕获必须取舍，不允许无限reserve。新Worker边界已实现“未满直接入party／满员放弃新捕获或原放生后接纳”；新版定向4/4、typecheck／Worker构建退出0。此前9b22a02c／d3d824c4的备用交换／分页方案已被用户纠正，不再作为最终目标。**仅部分完成**：新取舍原UI未接，旧备用按钮／旧reserve断言未完成清理，旧库存迁移和新版正式WS故障／重启／去重／隔离未完成，未跑最终完整回归，浏览器未执行。因用户要求即将断电，停止扩展，提交保存并仅推送独立评审备份；main不动，下一次先接新取舍UI和更新验收，不继续扩成长。详细范围／失败历史／最终构建见[本批记录](mvp-vs-02b10-reserve-team.md)。

2026-10-21 VS-02B-09维护者修订：独立修复伙伴BALL跳过、双投球归属、逐阶段恢复检查点、原计分、待处理捕获事实归属与ID分配；原BallUiHandler接替网页投球按钮并补异步门控。规则修复da167bc4完整串行1022/1022、退出0；之后备用名称显示补丁UI34/34、退出0，未再次全套，最终构建见[验收记录](mvp-vs-02b09-review.md)。A仅限无持有物和原支持球种，B原球菜单待用户浏览器，备用原Summary仍未接；下一批只推进捕获备用战后换队至下一战可用。评审分支本地，未合并／未推送。

2026-10-20 VS-02B-09 普通捕获：A 以稳定 ball/target option 驱动原 CommandPhase BALL／AttemptCapturePhase，原三次判定与转换，成功个体进入捕获者 reserve，私有投影与客户端 apply→capture 保留完整状态；直接 Worker 3/3，typecheck／runtime／build 通过。B 加合作页最小球选择与只读备用行，取消／outbox／receipt 门控保留；未复用完整原 BallUiHandler、未做双浏览器。正式双 WS／故障重启和普通球稳定随机回归未补；完整回归见本批记录。战后换队／M6 仍未做。

2026-10-20 用户追加按键／鼠标修订：WASD方向、Enter确认、Esc取消、M菜单、C完成选队；鼠标接原选队、选项、Command／Fight／Target、Party、奖励等菜单，保留原回调、冷却、合作输入门控；文本输入框不再同时驱动画布。定向43/43、typecheck／生产build退出0，完整串行未重跑。用户自行测试后反馈“没发现问题”，只记本批可用性复核，不扩大为完整双端验收。分支fix/keyboard-mouse-controls，未合并／未推送，详见[输入修订记录](controls-review-2026-10-20.md)。下一批捕获开发须保留此最新输入修订。

2026-10-20 VS-02B-08维护者复验：修复威吓插入阶段后另一席换错后备／恢复游标、Party跨await旧目标提交及放生等未接本地操作；接原ShowPartyExpBarPhase／HidePartyExpBarPhase，换人后退场参战者能按原方法获经验并进入整备。补真实双WS＋FormalRoomStore的单方输入重启、候选落盘失败重试、再次重启、去重和房间隔离；更正原WS成功例实际使用MemoryStore。最终定向51/51，typecheck／runtime build／生产build退出0；完整串行1006/1006、退出0（1028492.7826ms，无失败／取消／跳过），最终结果见[维护者验收](mvp-vs-02b08-review.md)。A限普通SEND_OUT切片，B原Party及Potion／文字视觉仍待用户浏览器验收，不宣称全机制。评审分支review/vs02b08-active-switch-fix，未合并／未推送。下一批普通捕获→本人本局备用持久化→原BALL菜单，战后换队另批；M6待处理成果不得丢，详细任务书仅本地。

2026-10-19 VS-02B-08 战斗内主动换人：A 以稳定 pokemonId option 经原 CommandPhase POKEMON／TurnStart／SwitchSummonPhase 执行，个人 Party 视图分席换人，混合 FIGHT 与双方同轮换人可达下一输入；真实 Worker 4/4、真实双 WS 1/1、既有换人定向 23/23，最终完整串行 **1000/1000、退出 0**（1595758.506ms），typecheck／build 通过。B 接原 POKEMON→个人 Party UI，取消／拒绝／刷新清理和 outbox 门控保留，但双浏览器未执行，待用户验收。普通 SEND_OUT 之外、经验条阶段及主动换人专用故障／重启测试仍是缺口。详见 [VS-02B-08 记录](mvp-vs-02b08-active-switch.md)。

2026-10-19 VS-02B-07 维护者独立复核：A 文字基础／B 顶部布局**部分通过**，浏览器视觉和 Potion 原 Party 仍交用户验收。修复合作入口原字体未注册、既有 Text 重设遗漏 padding／行距及显式零值、窄窗长错误与控制区换行；补正式 Worker 构建启动步骤，纠正来源提交含义和 early 固定基线混称。定向35/35、typecheck／生产build退出0（1m45s）；本次完整回归和浏览器未运行，不沿用旧计数。独立本地评审分支 `review/vs02b07-ui-text-fix`，main仍86798227，未合并／未推送，详见 [维护者验收](mvp-vs-02b07-review.md)。下一批仅战斗内普通主动换人 A正式运行器／事务、B原Command／本人Party／后续FIGHT，完整提示词仅本地；UI按用户实测反馈定点修，捕获／本局备用／战后换队等MVP范围不删。

2026-10-19 VS-02B-07 文字与入口 UI：A 复用新版 Pokerogue 语言/场景文字度量，加入 CJK 字体回退、中文降字号、轻阴影、padding 与 advanced wrap；英文保持原度量。B 将 coop-play 顶部改为低高度可换行状态条，收紧房间/准备/预算与桌面控制，窄窗适配；原菜单仍用原窗口/像素资源。typecheck、生产 build 通过；浏览器项目交用户验收，未执行项保持待测。详见 [VS-02B-07 记录](mvp-vs-02b07-ui-text.md)。

2026-10-19 VS-02B-06 维护者修订：原效果改为复用原 BattleScene.addModifier 与任务观察器收尾，显式拒绝误继承的 REVIVE；修复 Potion 原 Party 缺少 battler-count、取消重选、过期回调和临时视图清理，展示使用 codec 副本。A 的球／Potion Worker 与正式双 WS／FormalRoomStore 故障、重试、重启、重复 actionId、房间隔离切片通过；B 已实际完成球补给双浏览器领取（双方5→10）、重启刷新不重授予及第二战共同 FIGHT，Potion 目标原 UI 仍待用户测试，B 整体部分通过。最终 typecheck／build 退出0，完整串行回归992/992、退出0，无失败／跳过／取消，1053058.5728ms；见维护者记录。用户要求本轮收尾后推送；发布采用公开 main 的新父提交与经审查的最终树，不合并旧内部评审历史。下一批优先复用源项目最近几个可核实版本的文字排版与原 UI，浏览器测试可交用户执行，见下一批计划；捕获／主动换人／本局备用／战后换队仍是随后 MVP 必需项。

[维护者记录](mvp-vs02b06-review.md) · [新版 UI 计划](coop-ui-text-next-plan.md) · [用户测试清单](vs02b06-manual-acceptance.md)

VS-02B-06 普通奖励生产接缝：A 段已把生产 `chooseNativePreparation` 接到既有 `advancePreparationEffect`，通过原 `SelectModifierPhase` 回调实际执行精灵球补给（`AddPokeballModifier`）与本人目标 Potion（`PokemonHpRestoreModifier`），保留 owner/target/option 错误并拒绝 unsupported；真实 Worker 定向 4/4；完整串行 **983/983、退出 0**（1000595.2568ms）。B 段已把原奖励菜单行映射到服务器 optionId、Potion 使用原 Party UI 选择本人 pokemonId，但未完成双浏览器真实领取与后续 FIGHT；普通奖励仅支持球和 HP 恢复；商店／重抽／成长／其它奖励仍未接。详见 [VS-02B-06 记录](mvp-vs-02b06-preparation-rewards.md)。

VS-02B-05 维护者审查：修复整备菜单异步回调、重复快照、过期按钮、拒绝回执与写入失败后的菜单恢复；原菜单增加可选展示参数，单人仍走原四参数。Chrome＋应用内浏览器已真实完成原选队→首战→整备刷新／跳过／准备／取消准备→第二战，并在同目录服务重启与双端刷新后共同 FIGHT 到 revision 12。修复权威昼夜投影，双方画面一致。定向32/32、类型检查／构建通过；最终完整串行回归979/979、退出0、无跳过／取消，结果见 [维护者审查](mvp-vs-02b05-review.md)。普通奖励效果／购物／重抽／成长及捕获／主动换人／本局备用仍未闭环，不代表完整 M3 或 MVP 上线。未合并／未推送，SPEC 与提示词仅本地。

2026-10-18 VS-02B-05 **未完成 A／B 验收**：已接原 `ModifierSelectUiHandler` 展示服务器已抽出的 rewards、跳过奖励／准备／取消准备安全动作、原 switch-confirm／switch-select 的“保持当前出场者”路径，并复用既有 outbox／receipt／ACK 门控；准备／下一战服务端定向 82/82、typecheck／build 通过。普通奖励效果、购物／重抽／成长未接并明确拒绝；静态 build 下 StarterSelect 黑屏导致本轮双浏览器未完成选队、整备与第二战，未跑完整回归。详见 [VS-02B-05 记录](mvp-vs-02b05-preparation-next-battle.md)。

2026-10-18 VS-02B-04B 维护者纠错：基线 cd9a5f30，修复原 Phaser 容器／原资源／BattleInfo、名字与背景、原 Command/Fight/Target 输入、ACK／outbox／过期回调门控，并修复真实回合 StatChange 遮罩导致的 Worker 失败。两独立浏览器已完成两轮 FIGHT 并共同到战后 preparation（revision 4），含同目录服务恢复及两端刷新；首回合双方仅扣一次 PP。25 项定向通过，最终类型／生产构建通过。完整串行回归 970/970、退出 0，无跳过／取消，结果见 [本批记录](mvp-vs-02b04b-review-2026-10-18.md)。捕获／主动换人／本局备用与整备 UI 仍是后续 MVP 必需项，本片不代表 MVP 可上线。未合并／未推送，SPEC 和提示词不提交。

2026-10-18 VS-02B-04B **未完成 B1／B2**：写了原 BattleScene 的展示适配（本人真实模型、公开代理、四场位占位）、Command/Fight/Target 薄输入端口、服务器 options 映射与 IndexedDB action outbox；typecheck／build 通过。但恢复 PlayerPokemon 的 Phaser 生命周期和公开代理 BattleInfo 未正确接，未取得任何双浏览器战斗画面或真实双方 FIGHT；完整回归未跑。只提交可审查代码子集，不宣称可玩。详见 [VS-02B-04B 记录](mvp-vs-02b04b-battle-ui.md)。

2026-10-18 VS-02B-04 维护者推进：原交付 d4cfa16e 仅 A 子集、B 未实现，属实。已修快照核验／epoch、IndexedDB 原消息重放及拒绝保留选队、合作取消／CLASSIC、新默认资料身份初始化和关闭 Worker；复用原控制按钮。实际 Chrome＋应用内浏览器原选队 1／2 只→正式 profile lobby→真实首战 wait-actions，刷新恢复通过；定向24/24、typecheck／build通过，完整回归未跑。只关闭 A 关键阻断，不算 A/B 或可玩验收。下一批直接接原战斗展示与 Command/Fight/Target，共同完成真实回合。见 [审查与证据](mvp-vs-02b04-review-2026-10-18.md)。

2026-10-18 VS-02B-04 **未完成 A／B**：已实现 `/coop-play.html`、合作启动分流、原 `StarterSelectUiHandler` 打开、正式 lobby／房间创建／预算显示、服务端 profile adapter 注入与随机 seed、IndexedDB 席位／outbox；typecheck／build 通过，后端 profile lobby 5/5。但浏览器内选队确认→profile-ready→双方 ready 的闭环未完成，原战斗画面与 Command／Fight／Target 输入端口未实现，完整回归未跑。详见 [VS-02B-04 记录](mvp-vs-02b04-first-ui.md)。

2026-10-18 VS-02B-03 维护者修订：核对交付 953/953 日志和两个测试 blob。修复建战候选修改缓存身份、format 3 的 stage／seed 漏验及首回合版本降级；准备后改选需先 unready。profile v2 新增最小 unlocks，服务端调用原性格／配招校验并核对 IV／蛋招／属性，成本仍为原 getter。真实失败／落盘重启等定向 20/20；其余兼容／构建最终证据见 [验收](mvp-vs-02b03-review-2026-10-18.md)。当前仍无原 UI／浏览器可玩，下一批进入原选队与首回合 UI，不再扩外围 QA。捕获／主动换人／本局备用和战后换队必须纳入 MVP。

2026-10-18 VS-02B-03 **完成 A／B**：A 新增原 GameData 最小 profile capture／validate／restore 与原 `getSpeciesStarterValue` 成本（含分数、个人折扣、蛋镜像）；B 新增 adapter format 3 profile lobby，真实双 WS 按 10／14 预算导入 1–6 只完整 v2 选队，双方 ready 后走真实 selected Worker 首战，持久化封存／重启／resume token／旧 actionId 重放均验证。A 定向 3/3、B 定向 3/3、旧恢复 15/15、typecheck／build 通过；完整串行 **953/953、退出 0**（1501366.3253ms）。仍无页面／真实档案自动读取／原 UI／outbox／双浏览器。详见 [VS-02B-03 记录](mvp-vs-02b03-profile-lobby.md)。

2026-10-18 VS-02B-02 维护者修订：核对原交付 05b872a0 的 946/946 日志及测试 blob，独立原版定向 3/3；selected Worker 改为各 1–6 只可不等长，同席不重复，允许相同训练家数值。修订定向 69/69、类型检查／构建通过，本轮完整串行未重跑，不把 946 沿用为修订结果。用户确认共享 14 点（个人上限 10），捕获、主动换人、本局备用与战后换队进入 MVP；孵化／永久收藏后置，不丢蛋或局内成果。下一批接个人资料、原成本及完整 v2 lobby。见 [维护者验收](mvp-vs-02b02-review-2026-10-18.md)。

2026-10-18 VS-02B-02 **完成**：新增 `native-open-selected`／`native-open-selected-to-input`，完整 v2 双席各 3 只描述、双 identity、原 egg 库存经严格校验后进入真实 Worker；复用原 selected-starter 构造、NewBattle／Encounter／Summon／TurnInit 与安全停点，首战 wait-actions 的 actor／options 对应双方真实原模型。定向 3/3、native guards＋runtime＋starter＋selected 68/68、typecheck／build 通过；完整串行 **946/946、退出 0**（919746.8669ms）。无非空 permanent grants、未接 profile／lobby／原 UI。详见 [VS-02B-02 记录](mvp-vs-02b02-selected-entry.md)。

2026-10-18 VS-02B-01 维护者修订：原交付 8da3de5b 的 939/939 历史证据已核对。修复独立对照误用被测 restore、已解锁蛋招丢失、构造资料泄漏和输入强制转换／稀疏数组；内部选队 JSON v2 新增显式 eggMoves，旧 v1 明确拒绝，不影响房间 v2 与蛋库存 v6/v7。定向 65/65、类型检查／构建通过，修订完整回归 **943/943、退出 0**（894264.932ms），正常 1..943 收尾，fail／cancelled／skipped／todo 均为 0。仍未接原 UI／真实 profile／正式 lobby，下一片为完整选队描述进入原 Worker 首战。见 [维护者验收](mvp-vs-02b01-review-2026-10-18.md)。

2026-10-18 VS-02B-01 **完成**：新增原 Starter 结果最小 JSON 描述（speciesId／规范 dexAttr／nature／moveset／pokerus／本人 IV）与原类解析／严格校验；真实 Worker `construct-starter` 用原 `GameData` form getter、原 `PlayerPokemon` 构造器和 `tryPopulateMoveset` 重建，保留 shiny／gender／form／ability／nature／moveset／pokerus／IV，失败回滚随机流。定向 4/4、runtime guards＋native runtime 61/61、typecheck／build 通过；完整串行 **939/939、退出 0**（1013817.0709ms）。仍无真实档案、lobby、原 UI 或浏览器；下一批为 profile 镜像＋按席位 lobby 描述。详见 [VS-02B-01 记录](mvp-vs-02b01-starter-selection.md)。

2026-10-18 VS-02B 任务纠正：上一报告仅只读核对，未交代码，不作为功能完成。本次已独立确认主要缺口并核实实时远端 871c5f18；将下一批收窄为原 Starter 结果 JSON 往返与原 PlayerPokemon 构造差分，无需页面／浏览器。之后按席位 profile/lobby、原 UI 首战、outbox／续局分批推进，不再一次打包。未修改运行源码，未新增测试结果；935/935 仍为上一验收证据。详见 [核对与范围纠正](vs-02b-scope-review-2026-10-18.md)。

2026-10-18 VS-02 维护者修订：修复关闭房间时 Worker 被在途请求重新创建导致的测试挂起；加强 envelope 恢复／stage／seed／runId 绑定、投影复制和 v6 未知蛋语义。沿用交付原种子补接原 ObtainStatusEffectPhase／ShowAbilityPhase，逐阶段新 Worker 恢复差分通过。真实双 WS＋FormalRoomStore 已验证关服重启、原 receipt 重放、单次结算、候选写盘失败及损坏存档不重写。最终定向 35/35、类型检查／构建通过；完整回归 **935/935、退出 0**（901232.6578ms），正常 1..935 收尾，失败／取消／跳过／todo 均为 0。仍仅内部入局／恢复子集，真实个人档案、原选队／战斗 UI 和跨设备未完成；默认 adapter 仍为测试夹具，正式入口默认不可用。见 [维护者记录](mvp-vs-02-review-2026-10-18.md) 与 下一批原 UI 首战提示词。下面旧计数与交付阻断保留为历史。

2026-10-18 VS-02 第一段部分完成：adapter envelope v2 持久化（实际 seed／双方 identity／lobby／checkpoint／intents）、真实 lobby 选队与双方 ready 后建战、per-seat identity 构造、蛋状态校验、投影 `stage`／`eggs`、intent 字段读取修正。定向 4/4、typecheck 与生产构建通过；真实 server 重启续局、原 StarterSelect UI 未接，旧 VS-01 WS 套件当前环境挂起，完整回归未跑。第二／三段未开始，整体未验收。详见 [VS-02 记录](mvp-vs-02-original-ui-resume-2026-10-18.md)。

2026-10-18 VS-01 最新验收：6c7f2319 的原类 adapter／投影／客户端恢复已真实贯通双 WS 首战至第二战；维护者加强第二战必须成功与房间隔离断言，修复 ready 后取消准备、非空永久授予假 ACK、终局自动推进边界。修订定向 **20/20**，类型检查与构建通过，维护者完整串行 **920/920、退出 0**（876160.9663ms），正常收尾、无跳过／取消／todo。仅验收固定夹具内部接缝；正式个人选队／双身份、原 UI、IndexedDB、实际房间落盘重启与跨设备未完成。下一批 VS-02 接原 UI 与基础续局，不追加外围 QA。main 仍 51de6356，未合入／未推送；下面旧状态与数量为历史。见 [验收记录](mvp-vs-01-review-2026-10-18.md) 和 VS-02 提示词。

2026-10-18 VS-01 联机接缝已实现并实测：新增 `server/original-coop-adapter.mjs` 八方法桥、Worker 纯校验／checkpoint 校验／shared-personal 投影、按席位事件过滤、客户端原模型模块与双 WS 验收。两个真实 WebSocket 客户端经正式 service、adapter、房间独立原类 Worker、真实 PlayerPokemon 投影与正式 consumer ACK，走通首战→整备→战前换人／拒绝→第二战双方 FIGHT 提交；第二战连续执行在部分 seed 命中未支持原 Phase 并安全失败、未提交。仍是固定 identity／队伍与内存 store 的内部接缝，未接真实选队、原 UI、落盘重启或跨设备；生产默认仍 `ADAPTER_UNAVAILABLE`。详见 [VS-01 记录](mvp-vs-01-native-bridge-2026-10-18.md)。本批新增测试 5/5、完整串行回归 917/917（退出 0）。以下旧状态和数量为历史。

2026-10-18 完整首发设计已形成：[最快双端可玩架构](mvp-delivery-architecture-2026-10-18.md)。本轮仅设计，代码核对基点 92f43a32，无桥接实现或新测试数量。按接缝证明→原 UI／基础续局→真实双机三步交付；保持现有协调器／原类 Worker／codec，补八方法桥、lobby 本人选队与身份、私有模型及按席位事件过滤、实际模型应用和只读动画队列。模型 ACK 不等待动画，但未核验模型不能开放输入；房间 checkpoint 与 intents 同候选落盘，不把 M6 延后等同于不保存。列出首发范围、恢复矩阵、待实测体验指标和明确发布门槛，不承诺全机制或无依据工期。下一实际代码工作仍为 VS-01，不再扩外围 QA。

2026-10-18 最新验收及优先级：UI-01R 953d2922、QA-03 3fd1368b 已分段验收；真实完整 TAP 为 **912/912、退出 0**，正常收尾且无失败／取消／跳过／todo，测试 blob 与最终交付一致。维护者独立 consumer 32/32，另有四个真实挂起期间 epoch 失效及一个联合 ACK 顺序控制通过；本轮未重跑全套／typecheck／build，生产源码未变。QA-02B 修订全回归待验关闭，旧 880／879／1 历史保留，资金足够的真实 reroll 仍未覆盖。见 [验收](outsourcing/MVP-QA-03-acceptance-2026-10-18.md)。用户要求最快能一起玩，停止追加外围 QA／扩大机制，下一实际开发批为 [VS-01 真实纵向接缝](mvp-vertical-slice-2026-10-18.md)：正式八方法 adapter→原类 Worker→私有投影→客户端真实原模型应用→consumer ACK→第二战再 FIGHT。随后基础房间同候选意图落盘与原 UI，再双设备验收；完整 M6／复杂机制后置但保留缺口。连续运行为普通生产主路径，逐阶段运行留诊断。当前桥接尚未实现，M3 部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE；不限制物种／世代，不把固定测试队伍当产品规则。main 仍 51de6356，未合入／未推送，以下旧状态和数量为历史。

2026-10-17 最新 QA-02 审查：交付 abeb6e43 相对 a12f4098 仅六个约定新增文件，工作区原先干净。A 的 36 项通过独立验收；B 原完整日志实际为 880／879／1，唯一 P11 是任务书误设资金足够，原真实菜单 money=0／rerollCost=250。维护者仅将 P11 修为资金不足 INVALID_REROLL 并加强拒绝前快照，独立 A＋B 定向 **80/80** 和额外 8 组控制通过；修订版完整回归待执行，不能宣称当前全绿。资金足够的真实 reroll 仍未覆盖。C 的 UI 资料部分接收、定点退修（菜单 mode／参数、取消命令语义、actionId、语义先验与每条字段）。详见 [审查记录](outsourcing/MVP-QA-02-review-2026-10-17.md)。本轮不改生产代码，main 仍 51de6356，未合入／未推送。下一外包批负责资料修订、正式 consumer 故障测试及一次完整回归；主维护者继续负责生产 adapter／私有投影／持久意图／WS，再接原 UI。M3／M4／M5／M6 和跨设备验收不提升。以下旧状态与数量保留为历史。

下一外包任务已具体化为 UI-01R＋QA-03，基线须包含维护者修订 43473dd3：先修 C 的 UI 调用资料，再补正式 createSnapshotConsumer 的 32 项确定性故障测试，最后一次完整串行回归同时核对修订 P11。两段各自 commit、最多四个文件，均尚未交付／验收；不再单独重复旧全套。主维护者生产接线职责不变。

2026-10-17 后续任务安排：用户要求下一批增加工作量，已编写 MVP-QA-02 三段提示词。A 为 36 个真实 Worker 通信／关闭场景，B 为整备／战前换人的 36 拒绝＋8 正常控制，C 为 24 条原 UI 复用清单、12 未来双浏览器脚本和 8 风险定位；最多新增六个测试／资料文件、三次独立提交，均尚未实现／验收。外包不改生产接线，主维护者的下一批仍是 adapter／持久意图／私有投影与 WS 故障矩阵，然后原 UI。此安排覆盖旧“暂不追加外包”，不要求把整个外包批次做完才启动主线。

2026-10-17 最新验收：QA-01R 交付 `7c2e0f4d`（基线 `fc2f59f0`）已通过维护者复核，见 [验收记录](outsourcing/MVP-QA-01R-acceptance-2026-10-17.md)。实际 TAP 与退出码文件确认定向 **68/68**、完整串行 **800/800**，退出 0，均正常收尾且无失败／跳过／取消／todo；本轮维护者核对日志及提交范围，未再次运行全套。原 QA-01 的 795／794／1 失败历史保留，已由精确登记候选 IO 端口的守门修订和五项行为测试闭环；生产源码与冻结 fixture 未改。类型检查／构建沿用 QA-01 同生产代码证据，本轮未重跑。A／B1 与 QA-01／R 均在评审链验收，main 仍 `51de6356`，未合入／未推送；实时远端 main 为 `56147767`。运行时代码 `eb6644bd` 已验证声明普通首战到第二战真实输入，M3 仍部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。下一批由主维护者接生产 adapter／持久意图／私有投影及新 Worker 双端 WS 故障矩阵，再接 M4／M5 原 UI 和双浏览器连续游玩；语言工具后续继续暂缓。QA 完成不代表生产接入、跨设备或 MVP 上线验收通过。当前文档提交与工作区以实际 Git 为准，以下旧状态和数量为历史。

2026-10-16 最新提交／推送核对：累计成果已汇总提交 `a14337a9` 并正常推送 origin/main（`3ce98d72` → `a14337a9`），推送后只读实时远端同一提交，代码汇总提交后工作区干净。汇总包括 52 个代码、测试及文档文件，覆盖普通下一战／战前个人换人、遭遇／战斗道具、v6/v7 投影修复和原偷取／持有种子复活。最新完整串行回归 **698/698**，类型检查、生产构建及空白检查通过；范围检查和指定凭据模式未发现问题，仅限当前范围，不作全历史或绝对隐私保证。本段交接另行提交，最终 HEAD 以实际 Git 为准。M3 部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE；下一批原敌方概率复活增益及 revived／maxRevived 限次、场景 RNG、原 Faint／Heal 队列和失败恢复，再扩展防偷特性与其余树果。下方“全部未提交”、旧 HEAD、文件数及旧下一步均为历史，不能覆盖本段。

2026-10-16 最新转移／复活批：已接普通原 Mini Black Hole／Grip Claw 偷取，双方及敌方持有复活种子经真实致死、原 Faint／Heal 到下一真实输入；保留原抽取／概率／堆叠和原回血。原转移最终 Promise 接既有观察器；修复共享更新先失败时过早解绑个人转移任务的晚到回调问题。新增 51 项（33 单端、18 WS）定向、类型检查和生产构建通过。本批完整串行回归 **698/698** 通过（约 931 秒）。开工保留前序 44 个未提交文件，main／HEAD／只读实时 origin/main 仍 `3ce98d72`；本批未提交／未推送。[本批来源／验证／边界](transfer-revive-m3-2026-10-16.md)。M3 部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。

下一批先复用原敌方概率复活增益，核对 revived／maxRevived 限次、场景随机、Faint／Heal 原队列及失败恢复，再扩展防偷特性与其余树果。普通偷取／持有种子已经有切片，不重复开发；个人手动跨玩家转移、复杂特性组合、主动换人／接棒、捕获／逃跑、特殊遭遇和生产场景仍有缺口。以下旧数字、失败或下一步均是历史，不覆盖本段。

本批累计 52 个变更文件，保留全部前序成果；空白及范围检查通过，未发现存档／房间／依赖／构建产物／临时输出纳入变更，指定凭据模式扫描未命中。结论只限当前变更和所列模式，不是全历史或绝对隐私保证；全部修改未提交／未推送，接手先读实际 Git。

2026-10-16 前序投影修复／补验批：原战斗道具测试 adapter 把不带 eggState 的 v6 交给 v7 蛋视图，导致创建房间异常并等待 welcome 超时；已修复既有投影／恢复桥。v6 不补库存，显式空库存 v7 保持，部分蛋元数据明确拒绝。前序 10 项 WS 与新增 2 项 v7 双端重启通过，战斗道具定向 51 项（39 单端、12 WS）通过。本批完整串行回归 **647/647** 通过（约 895 秒），类型检查与生产构建通过。详见 [本批记录](client-projection-fix-m3-2026-10-16.md)。审查接手时累计 42 个未提交变更文件，main／HEAD／缓存与审查实时 origin/main `3ce98d72`，全部成果保留，本批未提交／未推送。M3 部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。

下一批复用原持有物转移／复活等剩余战斗效果，先核对个人／敌方所有权、原队列与消费／恢复停点，再补原版连续／恢复和双端故障差分。不重复本批已修复的 v6/v7 视图或已通过的战斗道具 WS。以下失败、旧验证数量和当时远端查询状态均为历史证据，不能覆盖本段。

前序投影修复批累计 44 个变更文件，当时空白／范围／指定凭据模式检查通过；这里只保留历史范围证据，当前累计文件数和检查见最新批次及实际 Git。不作全历史或绝对隐私保证，所有前序成果仍保留且未提交／未推送。

2026-10-16 前序战斗道具批（修复前历史）：已将原个人／敌方道具方法贯穿普通 Command／出招／命中伤害／MoveEnd／TurnEnd、原树果与回血阶段，以及战前换人／倒下替补；实际覆盖属性增伤、命中／要害、Shell Bell／Leftovers、个人增疗、保存树果与 SITRUS／LUM／LEPPA 的触发和一次性消费。逐停点 JSON 恢复与冻结原规则连续执行一致，可收集后续真实行动输入；测试 driver 未挂生产。 [本批来源／验证／缺口](battle-items-m3-2026-10-16.md)。本批保留接手时的 28 个未提交成果，继续在 main／HEAD `3ce98d72` 开发；缓存 origin/main ahead／behind 0／0。只读实时远端查询因本机代理拒连失败，提权查询因审批服务 429 未执行，不能把缓存一致写成实时一致。本批未提交／未推送，累计范围以 git status 为准。

下一步先补跑本批真实 WS 与完整串行回归，再复用原持有物转移／复活等剩余战斗效果，逐项验证个人与敌方所有权、一次性消费及原队列恢复。其他树果、特殊遭遇、完整构造、复杂奖励、非 FIGHT 与生产运行器仍缺；M3 仍部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。

本批新增 42 项用例：32 单端通过，10 双端 WS 因 loopback EACCES 未执行网络断言，提权重试遇审批服务 429 未执行。本批实际串行 battle-core／local-save／localization 为 **399/399** 通过（约 311 秒），类型检查、生产构建通过；不能称为完整含 WS 回归通过。上一批 **596/596** 保留为用户确认的前序完成证据。 本批构建仅有既有混合导入／大包警告。以下批次与测试数量为历史证据；上一批遭遇道具记录见 [这里](encounter-modifiers-m3-2026-10-16.md)。

历史遭遇道具批结束时为 28 个变更文件；当时空白、范围及所列凭据模式检查通过。这段仅保留当时证据，不代表战斗道具推进后或本次修复后的文件数／扫描结果；当前累计范围与检查以本批记录和实际 Git 为准，不作全历史或绝对隐私保证。

2026-10-16 最新战前换人批：适配测试链路已接原 CheckSwitch 确认、原 Switch 个人后备选择／取消，以及原召回／交换／入场至下一战真实输入；两席可分别接受、拒绝或取消，换人后还能执行首个真实 FIGHT 回合。恢复只调用命名提取的原回调，不重新 start 旧菜单。新增 switch-confirm／switch-select 明确安全停点，保留倒下 wait-switch 和 v6/v7 语义。新增 32 项（19 单端、13 WS）定向通过，类型检查、生产构建通过；本批完整串行回归 **574/574** 通过。开工 main／实时远端 `3ce98d72`，保留上批 11 个未提交文件，本批同样未提交／未推送。[本批复用／验证／边界](pre-battle-switch-m3-2026-10-16.md)。M3 仍部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。以下 NewBattle 等数量及状态均为历史切片。

下一批优先原敌方道具生成／更新和个人已有道具的遭遇绑定，复用原 Modifier 方法及现有个人场景，补恢复差分。当前仍只覆盖普通同区域、无道具／感染和敌方道具抽取为零的夹具分支；完整构造、复杂离场／入场特性、特殊遭遇与生产场景尚未验收。战斗内主动换人仍是单独缺口，不把本批战前选择写成全换人完成。

2026-10-16 最新 NewBattle 批：已从双方个人整备准备，经原 NewBattle／Battle 构造／普通 NextEncounter、敌方 PostSummon／位置／个人 CheckSwitch／TurnInit，接至下一战真实行动输入并复用 FIGHT 链。创建和遭遇同候选提交，避免中间空敌方状态；已完成遭遇恢复不重抽。新增 25 项定向通过，完整串行回归 **542/542** 通过；类型检查及生产构建通过。基点 main／`3ce98d72`，开工工作区干净，缓存及只读实时 origin/main 同一提交；本批变更未提交／未推送。[本批复用／验证／限制](next-battle-m3-2026-10-16.md)。M3 仍部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。下方“下一战完全未执行”、旧数量和未提交状态仅为历史证据。

本批普通分支只覆盖双方上场存活、各自无可用后备、无道具／感染、原敌方道具抽取为零的受控夹具。1→2／2→3／3→4 为测试入口，不限制产品精灵或波次数量；其他条件明确拒绝。下一批优先原战前有可用后备时的个人换人选择／取消和恢复，再扩展原敌方道具生成／更新。完整 EnemyPokemon 构造、特殊遭遇、生产无渲染场景及全 RNG 仍未验收；保持 M6 hatch-commit 边界。

2026-10-16 提交／推送核对：此前累计 M3 切片已汇总到 `119b9f5a` 并推送 `origin/main`（原远端 `5c9f3e34` → `119b9f5a`）。验证为完整串行回归 **517/517**、类型检查、生产构建和空白检查通过；提交包含 114 个代码、测试及文档文件，提交范围检查未发现存档／房间数据／依赖／构建产物，凭据模式扫描未命中。M3 仍部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。下一批优先原 NewBattle／遭遇到下一战真实行动输入。下方旧 HEAD、未提交／未推送和当时缺口均属历史切片记录；后续文档提交号以 Git 为准。

## 当前停在哪里

当前以顶部 2026-10-17 A／B 收尾记录为准；前序遭遇道具、战前换人、NewBattle 和累计提交记录保留为历史证据，不把当时状态／数字当作最新状态。

2026-10-16 提交／推送核对：此前累计 M3 切片已汇总到 `119b9f5a` 并推送 `origin/main`（原远端 `5c9f3e34` → `119b9f5a`）。验证为完整串行回归 **517/517**、类型检查、生产构建和空白检查通过；提交包含 114 个代码、测试及文档文件，提交范围检查未发现存档／房间数据／依赖／构建产物，凭据模式扫描未命中。M3 仍部分完成，正式 WS 默认 ADAPTER_UNAVAILABLE。下一批优先原 NewBattle／遭遇到下一战真实行动输入。下方旧 HEAD、未提交／未推送和当时缺口均属历史切片记录；后续文档提交号以 Git 为准。

- 历史切片：2026-10-16 糖果成长批：已接原普通／全队糖果触发的 LevelUp、自动学招／换招、进化／取消／暂停，复用已有原升级运行器与 M2 个人子决策。双方可同时处理成长，伙伴可继续个人整备；旧菜单和已开始阶段不重新 start。新增 26 项（16 单端、10 WS），完整串行回归 **517/517**、类型检查、生产构建及空白检查通过，见 [当前记录](preparation-growth-m3-2026-10-16.md)。下一批优先原 NewBattle／遭遇到下一战真实行动输入，其他复杂成长奖励仍缺。HEAD `5c9f3e34`，全部修改未提交／未推送，实时远端未核对；M3 仍部分完成，每批回复明确下一步。 以下为历史批次。

- 历史切片：2026-10-16 持久奖励批：已接原持久道具领取、堆叠／上限／满栈替代，以及原道具更新和维生素能力值重算；保护伙伴资源、精灵与可变对象引用。新增 26 项（18 单端、8 WS），完整串行回归 **491/491**、类型检查、生产构建及空白检查通过，见 [当前记录](persistent-rewards-m3-2026-10-16.md)。复杂成长子决策、NewBattle 和生产运行器仍缺。HEAD `5c9f3e34`，保留全部未提交修改，未提交／未推送，实时远端未核对。每批回复必须明确说明下一步开发范围。 以下为历史批次。

- 历史切片：原 SelectModifier 局部选择回调命名提取为 createModifierSelectCallback，保留回调自引用，原 start／恢复共用；回调体只归一化换行即可与冻结原版逐字一致。直接复用原 addModifier 和常用消耗品，购物／重抽原回调负责扣一次款；恢复旧菜单不 start，重抽新排队原实例才 start。新效果 runner 与旧 M2 协调分开扣款职责。免费奖励、购物和连续重抽已测；券／持久道具／复杂成长／转移等仍拒绝，NewBattle 未执行。新增 23 项，完整串行回归 **465/465**、类型检查、生产构建及 diff 检查通过，见 [本批记录](preparation-effects-m3.md)。以下为历史批次。

- 历史切片：无到期蛋分支执行两个个人原 SelectModifier.start，完整原奖励池／原 shop 工厂、个人资源及原 seed／池表绑定，已抽菜单持久化到 M2 preparation。可确认跳过、准备和取消准备；双方准备仅停原 NewBattle 未开始，不伪造下一战输入。PLAY-15 已确认联机始终双打，只在合作池排除三种诱饵，原单人默认池保留。原选道具／购物／重抽等效果在接收前明确拒绝；本人私有菜单、逐选择重启及结果写盘失败后已收输入恢复已测。新增 17 项，分段串行回归合计 **442/442**（435 项主回归＋7 项独立原整备 WS）、类型检查、生产构建及 diff 检查通过，见 [本批记录](preparation-m3-2026-10-15.md)。以下为历史批次。

- 历史切片：原 EggHatch.generatePokemon 直接调用不改方法体，保存原 PlayerPokemon 及 eggMoveIndex 到 hatch-commit；结果与个人 Egg 同一检查点，恢复不重抽。未运行原 start 的删蛋／渲染，也未运行 doHatch 的永久写入；当前 stop 是 M6 原子事务前边界。测试私有视图支持本人当前原 Hatch 结果，队友只见阶段／位置。创建提供者是受控夹具，完整原 Pokemon 构造／生产场景未验收。新增 19 项，完整串行回归 **425/425**、类型检查、生产构建及 diff 检查通过，见 [本批记录](egg-hatch-m3-2026-10-15.md)。以下为历史批次。

- 历史切片：PLAY-14 已接原 EggLapse，每个个人原实例只 start 一次，两席同一候选推进。新 v7 保存个人 Egg 与原 queued EggHatch 的所属席／实例引用；v6 原样支持，不补空库存。本人私有视图恢复原模型，队友蛋只显示数量与待孵化队列位置。到期停原 EggHatch 未开始，无到期停奖励；不删除蛋、不生成结果、不写永久收藏。新增 21 项，完整串行回归 **406/406**、类型检查、生产构建和 diff 检查通过。以下为历史批次。

- 历史切片：同一 victory-aftermath 只恢复原统计 hook／战后排队，剩余行动及 TurnEnd 先执行，再运行一次原 BattleEnd。原总分、battleSummonData、双方个人临时道具到期／更新、敌方 held item 清理已执行。PLAY-07 用原 REVIVE 50% 效果只恢复全灭个人第一位，不消耗物品；失败与清理同候选回滚。当前停原未开始 EggLapse，奖励／NewBattle 保留原队列；下一次 ACK 明确拒绝，不跳过蛋或发放奖励。永久统计／收藏只有 hook，M3 仍部分完成。以下为历史批次。

- 历史切片：原 LevelUpPhase.start 整段不改，已执行原能力值计算、等级招式和进化排队；原自动学招／满招式选择／换招回调、进化应用／取消暂停／EndEvolution 已接。复用 M2 learn-apply／evolution-apply／evolution-pause，恢复显式调用原剩余方法，不重跑 start；取消时 EndEvolution 在暂停选择前已排队。升级链结束到同一 victory-aftermath，统计和 BattleEnd／战后尚未执行。原成功回调的规则段仅作命名提取；统计／图鉴等为 hook，M6 事务未接。以下为历史批次。

- 历史切片：共享原参战集合、一次基础经验和个人道具，直接复用原经验段并执行原 Exp／后备经验条／Pokemon.addExp。经验排队后同一 Victory 以 `victory-aftermath` 放回原主队列前端，EXP 先按原 prepend 执行；该阶段的统计和战后排队尚未执行，**不能重新调用 Victory.start**。升级时原 LevelUp 保留所属席并明确停住，下一批复用原能力值重算／学招／进化安全阶段。以下为历史批次。

- 历史切片：普通野生敌方 Faint 已执行原标签／状态／分数／战利品暂存，停在原未启动 Victory，后续队列、位置目标和物品对象／类型别名保持；错误／写盘失败回退、双端逐阶段重启和两房间隔离已测。当前 driver 的下一次 ACK 会明确拒绝未支持的 Victory，不伪装战斗已胜利。经验方案已批准但尚未授予；蛋／券归属、同时全倒下及完整战后闭环仍缺。以下为历史批次。

- 历史切片：原 Switch.wait-switch 的合法个人实例意图已接回调，复用原 SwitchSummon／Summon／PostSummon 以及 M2 summon-initialize／summon-finish，接至下一真实行动输入；双方依次替补后还能完成一个真实新回合。恢复使用显式 resume，已开始的 Phase 不重跑 start。原撒菱入场和致死再替补已测；没有使用测试继续动作。敌方 Faint／Victory、全机制、生产 driver 等仍缺。以下为历史批次。

- 历史切片：已复用原玩家 Faint 结算及 M2 替补安全决策，受控致死回合到回合末个人 wait-switch；保留攻击位置，不改打伙伴，不重复扣 HP／PP，不压位。个人全灭时伙伴沿原 TurnInit／Command 继续输入。**尚未接受替补输入并执行入场**；敌方 Faint／胜利、同时敌我全倒下和生产 driver 仍缺。双方败退只验证安全 ended 决策，未验收 GameOver 事务。以下为历史批次。

- 历史切片：M2 的原 Command.wait-actions／SelectTarget.wait-target 已直接用于混合手动／排队动作／Encore；只在当前原 Phase 真正请求输入时暂停，只等当前席。恢复 handle／目标回调与 end，不重新 start，目标取消沿原队列重新请求；新串行 driver 已覆盖前批混合次序缺口，旧批量 driver 的拒绝仅保留作兼容回归。decision 仍 v6；Faint／非 FIGHT／更多复杂机制和生产 driver 仍未验收，下面为历史批次。

- 历史切片：普通 FIGHT 新输入收齐后执行原玩家命令、目标阶段和敌方真实选择，再进入既有出招／效果／收尾链，单端连续三个新回合、双端连续两个新回合及重启／写盘失败已测。队首排队动作／Encore 自动执行后可只等待 partner 输入；混合强制次序仍 `UNSUPPORTED_MIXED_FORCED_ORDER`。新增 advanceCollectedFightCommands 只做候选和输入边界，不重写规则／调度。Faint／Boss／非 FIGHT／复杂机制及生产 driver 仍缺；下面为历史批次。

- 历史切片：原 TurnStart 从已收齐的三方 FIGHT 命令运行，经原出招／效果／伤害／能力阶段／续击／MoveEnd／TurnEnd／TurnInit 到下一 wait-actions。保留原未开始的 Command／EnemyCommand／TurnStart 队列，下一次合法行动可验证且单方输入可持久化／重启去重。没有重写规则或调度。下一回合新命令采集到执行仍缺，Faint／Boss／非 FIGHT／复杂机制及生产 driver 也未验收；下面为前批记录。

- 最新切片：原 Damage 展示收尾不重复扣 HP，原 StatChange 与多段 MoveEffect 可逐步保存恢复；新增原版差分、任务失败／隔离和双端逐击重启／写盘失败。直接复用原类和现有运行器／codec／harness，未修改生产执行链、未新增生产 driver，decision 仍 v6。Faint 与 FINAL_BOSS 特殊收尾仍拒绝，完整回合尚未连接。以下 206 等数字与缺口属于此前切片。

- 最新 M3 切片直接复用原 MoveEnd／TurnEnd、Battle.incrementTurn 和标签／天气／场地倒计时。新增逐个原 Phase 的独立候选推进，任务失败或无效候选保留旧状态；6 组原连续执行／逐步恢复差分、3 项双端 WS 重启／写盘失败及 2 项候选故障测试通过。累计 **206/206**、类型检查、生产构建通过，已汇总提交为 `f2377193` 并推送，decision 仍为 v6。本批是独立收尾切片，尚未连通 Damage／StatChange／Faint／多段攻击到下一行动停点，完整 M3 仍部分完成。测试 driver 未挂载生产，`/` 与 `/coop.html` 保持原行为。见 [当前记录](turn-end-m3-2026-10-14.md)。以下 195／183／177 项为历史切片。

- 历史伤害切片为 195/195，见 [原伤害／效果记录](move-effect-m3-2026-10-14.md)，现已包含在 `f2377193`；其数量／提交状态／下一步属于当时记录。

- 历史出招切片为 183/183，104 组出招、92 组命中差分及 3 项 WS 证据见 [出招记录](move-action-m3-2026-10-14.md)，现已包含在 `f2377193`，不重复实现。

- M2 批次基点 `8758a080`；当时本地相对 origin/main ahead 3。已提交的 M2 增加原 Phase/队列、可变引用、安全交互停点和正式协调器 incremental/auto 推进模式。
- M2 提交的 177/177 自动测试、类型检查和生产构建通过，范围与命令见 [M2 验收记录](m2-checkpoints-2026-10-14.md)。M2 的完成表示安全停点状态层验收，不表示完整 M3 战斗运行器、原合作 UI 或真实双机已完成。
- 当前 decision payload v6（已提交 M2 基线为 v5）、Pokemon v2、roster v3、original Phase v1；M1 envelope 不变。旧检查点明确拒绝，未静默迁移或覆盖。
- 原 Phase 清单覆盖三个源文件 68 个声明/63 个具体类；待续队列六字段、非空 pendingEffects、进化/形态目录引用及共享对象已支持。已开始的 Phase 必须保存剩余阶段，恢复不能重新 start。
- 安全停点包括选队完成、待行动/目标/替补/学招、进化及取消/暂停、地图、独立整备、整备内个人子决策、待续处理和结束。选队完成允许 Battle=null；不会在恢复时生成敌人或重抽选项。
- `/` 为原单人，`/coop.html` 为隔离实验页。正式 `/coop/v1/ws` 默认仍缺 M3 原运行器并返回 ADAPTER_UNAVAILABLE。测试适配器不能接入生产冒充完整规则。

## 工作目录与保护边界

- 只在 `E:\pokeregue\pokerogue-early` 开发；远程 `https://github.com/northstreet01/pokerogue-early.git`，分支 `main`。
- 不修改 `E:\pokeregue\pokerogue`，不重置、清理或覆盖用户工作。
- 接手先读 `git status --short`、`git log -5 --oneline`、`git rev-list --left-right --count HEAD...origin/main`；本地 origin/main 可能过期，不声称远程已同步。
- 用户于 2026-10-14 明确要求本批提交、推送并更新文档；正常快进推送已成功，不强推或绕过审批拒绝。
- 不提交个人房间、恢复凭据、存档、环境秘密、node_modules、dist 和临时测试输出；不要用真实房间生成公开夹具。

## 已确认玩法

地图双方选择一致后前进，一致前可修改；战后各自独立整备，双方准备后继续。状态协调已实现，原 UI 和完整权威下一战推进仍待后续模块。没有因版本限制精灵种类、世代或内容范围；测试小目录是夹具，不是产品限制。

经验方案已确认并接原经验段：合并双方实际参战成员计算一次，再发给各自符合条件的队员，保留原版公式和个人道具效果（SPEC PLAY-13），不重复询问。原升级／学招／进化及 BattleEnd／半血恢复已有切片，永久统计／收藏和战后闭环仍待接。

蛋规则已确认 PLAY-14：每次共同过关，双方各自蛋都推进 1 波，孵化结果各归蛋原持有人，不因个人全队倒下而排除；适配测试链路已执行原 EggLapse 和原生成规则，保存个人结果；完整孵化／永久事务仍待接。券归属和同时全倒下最终顺序仍见 SPEC 第 8 节，不要重复询问蛋规则。PLAY-15 已确认合作始终双打，合作奖励排除三种诱饵，单人原池保留。

## 阅读顺序

最新先补读 [转移／复活与任务收尾](transfer-revive-m3-2026-10-16.md)、[v6/v7 视图修复](client-projection-fix-m3-2026-10-16.md)、[普通战斗道具](battle-items-m3-2026-10-16.md)，再按下列清单核对基础与各功能来源。

1. SPEC：需求与当前验收，重点第 5/7/8 节。
   开发前必读第 4.5 节：按模块列出的复用来源、适配边界和每批复用记录要求，落实用户节省重复开发工期的要求。
2. [架构](coop-architecture-2026-10-13.md)、[计划](coop-development-plan.md)：权威边界、接口和 M1–M8 依赖。
3. [M2 当前验收](m2-checkpoints-2026-10-14.md)：字段/引用/安全停点、177 项证据、测试范围和 M3 缺口。
   当前优先读 [M3 遭遇道具](encounter-modifiers-m3-2026-10-16.md)、[M3 战前换人](pre-battle-switch-m3-2026-10-16.md)、[M3 普通下一战](next-battle-m3-2026-10-16.md)，再读 [M3 个人整备中的糖果成长](preparation-growth-m3-2026-10-16.md)，再读 [M3 持久道具领取与更新](persistent-rewards-m3-2026-10-16.md)，再读 [M3 原奖励／购物／重抽效果](preparation-effects-m3.md)，再读 [M3 原奖励菜单／整备与合作诱饵排除](preparation-m3-2026-10-15.md)，再读 [M3 原孵化生成与结果停点](egg-hatch-m3-2026-10-15.md)，再读 [M3 原蛋推进／个人待孵化队列](egg-lapse-m3-2026-10-15.md)，再读 [M3 胜利待续／BattleEnd／恢复](victory-aftermath-m3-2026-10-15.md)，再读 [M3 原升级／学招／进化](level-up-m3-2026-10-15.md) 和 [M3 合作经验](experience-m3-2026-10-15.md)：原公式／个人效果、实际授予和 victory-aftermath 精确定义；再读 [M3 敌方倒下](enemy-faint-m3-2026-10-15.md)、[M3 个人替补入场](replacement-m3-2026-10-15.md)、[M3 玩家倒下](faint-m3-2026-10-15.md)、[M3 混合命令恢复](mixed-command-m3-2026-10-15.md)、[M3 连续回合命令](command-cycle-m3-2026-10-15.md)、[M3 无倒下回合](round-loop-m3-2026-10-15.md)、[M3 伤害后待续](post-damage-m3-2026-10-15.md) 和 [M3 原收尾](turn-end-m3-2026-10-14.md) 的来源与边界。
   再读 [M3 原伤害/效果](move-effect-m3-2026-10-14.md)：195 项结果、v6 引用、异步错误及完整回合缺口。
   再读 [M3 最新工作区](move-action-m3-2026-10-14.md)：183 项结果、实际复用、出招和命中边界、仍缺的伤害/效果。
4. 按需查看历史 [队列/换人收尾](phase-continuation-m2-2026-10-13.md)、[共享标签](shared-tag-checkpoints-m2-2026-10-13.md)、[决策随机流](decision-random-checkpoints-m2-2026-10-13.md)、Pokemon/Trainer/Modifier 记录；旧版本/数量属于当时状态。
5. [语言适配](upstream-localization-2026-10-13.md)、[实验页](../COOP.md)：维护扩展，保持原内容和独立入口。

## 下一步工作安排

当前执行 VS-02 提示词：先实际房间落盘／真实初始化，再原 UI 和可玩普通闭环。VS-01 内部接缝已过验收，不重复开发八方法或只扩测试；旧下文停点仅为历史。

2026-10-17 停点：先读 A／B 两份运行时记录。用户要求本批收尾后停止；QA-01R 已补齐当前完整回归；继续开发时先做正式绑定和新 Worker 双端 WS 故障矩阵，再接原 UI，不重复已接的普通首战／下一战队列。

四类剩余工作继续有效；普通 NewBattle／战前换人／遭遇、有限道具、原普通偷取与持有种子复活已有切片，详见 [转移／复活记录](transfer-revive-m3-2026-10-16.md) 和前序记录。当前先接生产运行器已有普通闭环及原 UI；敌方概率复活／防偷特性保留后续，不把有限普通分支扩大为全机制验收。

M3 当前缺口合并为四类：战后到下一战闭环、非 FIGHT 实际执行、复杂机制补齐、生产服务器运行器。详细范围见 [模块计划](coop-development-plan.md#接下来执行方向)。优先第四类结合第一类已有切片，随后原合作 UI／个人整备（M4／M5）；永久收藏事务属于 M6。

先按 SPEC 第 4.5 节检查复用来源：M3 用 early 原规则和当前 M1/M2 基础；M4/M5 用原 UI，并适配此前项目的大厅、行动采集和展示回放；M6 用原收藏与本地事务；M7/M8 扩展现有及旧项目测试案例。此前 `E:\pokeregue\pokerogue` 只读，移植记录来源/差异/验证；不用旧 Host 权威和轻量快照替换当前架构。未复用候选须说明具体原因，不从零重写已有系统。

1. M3：当前 B 代码完整回归已由 QA-01R 通过；下一批接正式 adapter／持久意图／私有投影和必要奖励／成长／替补绑定，补生产 Worker 双端 WS 故障矩阵。通过后接原 UI／双浏览器；本批结束后按用户要求停止。
2. 提供无副作用合法目标校验和房间 RNG；接原进场特性/场地、持有物、形态及非 FIGHT 效果；不把测试提供者当生产规则。
3. 每一切片都补原版未中断/恢复差分与真实 WS 双端提取确认；延续输入重发、单方输入重启、写盘失败、损坏模型、旧连接 ACK 和两房间隔离矩阵。
4. M4/M5 接原选队/共同战斗/整备 UI，M6 接永久收藏事务；M7 故障矩阵贯穿，M8 用真实双机和长局验收。

## 检查命令

```powershell
Set-Location E:\pokeregue\pokerogue-early
git status --short
git log -5 --oneline
git rev-list --left-right --count HEAD...origin/main
npm run typecheck
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
npm run build
git diff --check
```

本机 WS 测试使用随机端口。先查现有服务，不占用 8020 或停止用户游戏。生产构建有既有 chunk/混合导入警告。并发回归曾出现测试进程无断言详情退出，相关文件单跑通过；最终验收采用串行完整回归，保留此环境限制。

## 可直接发送给新窗口

> 继续 E:\pokeregue\pokerogue-early，先只读核对 Git／实时远端，读 SPEC、交接、计划和 mvp-vs-01-review-2026-10-18.md。VS-01 6c7f2319 经维护者修订验收，真实双 WS／原模型至第二战回合通过，完整 920/920、类型与构建通过；main 仍 51de6356，未合入／未推送。按 docs/AGENT-VS-02-ORIGINAL-UI-PROMPT.md 推进实际落盘／个人选队与身份、原 UI、基本成长／替补／奖励闭环。保持默认 fail closed、单人／实验入口独立、M6／v6/v7／RNG 边界；未确认券和同时全倒下不定案。只改 early。

## 外包协作与后续验收

用户随后澄清执行者是能力较弱的另一个 agent。首项调整为 OUT-02A 单函数专用提示词，只做占位符提取和固定样例测试；不做扫描／CLI，不一次性分发三项完整工具。A 交付后独立验收，通过再安排 B。此调整优先于下段旧“先 OUT-01”的建议。最新进展：A 的 e3c840f8 已独立验收，见 [记录](outsourcing/OUT-02A-acceptance-2026-10-17.md)；下一步仅 B1 两字符串比较。原交付分支保留，评审记录在 review/out-02a-next-task，main 仍 51de6356，尚未合并／未推送。B2／B3 尚未安排。

用户已要求将简单体力工作拆给技术一般的开发者，见 外包任务入口。原先建议先 OUT-01；此排序已由上段较弱 agent 的 A→B1 小步安排覆盖，保留完整任务为后续候选。主线保留 src／server／协议／存档／生产绑定与 UI 集成责任，不因外包等待而阻塞。对方交付后，主维护者／项目助手必须执行 验收流程，记录实际 SHA、范围、独立测试及额外夹具结果；不得把自测报告直接当作验收。不要自动联系外包方或发送仓库。

### 当前外包下一项（覆盖上方历史顺序）

B1 交付 a28801af 已独立验收通过，33/33、额外输入／隔离／类型／原 A 函数体比对通过，记录见 [B1 验收](outsourcing/OUT-02B1-acceptance-2026-10-17.md)。评审记录在 review/out-02b1-mvp-qa；main 仍 51de6356，未合入／未推送。用户要求量更大且促进近期 MVP，下一项为 MVP-QA-01：42 拒绝输入、4 组真实控制及当前完整回归，只有新增测试和交付报告两个文件。尚未实施，语言工具 B2／B3 暂缓。主维护者仍负责生产接线、核心修复和原 UI；不把验证工作包当作 MVP 已完成。

### 当前停点：QA-01R 已验收，等待下一批核心接入（覆盖旧任务顺序）

QA-01R 的 7c2e0f4d 已通过 [独立复核](outsourcing/MVP-QA-01R-acceptance-2026-10-17.md)：唯一追加报告、生产源码与冻结 fixture 未改；真实日志定向 68/68、完整 800/800，退出 0。原 QA-01 失败和维护者守门修订记录保留。完整回归阻断关闭；本轮结束后停止，未合入 main／未推送。下一批主维护者处理生产 adapter、持久意图、私有投影与双端 WS 故障验证，再原 UI／连续游玩；外包本轮结束，不继续扩大矩阵。

2026-10-19 收尾：功能公开提交 `4573a3ece0751514a659c2c942c2f30b5ded9357` 已正常推送 origin/main，推送后实时 ls-remote 核对一致；父提交为 `871c5f183118ad0dea5eb4694ae4f94de6f68d87`。最终树与本地维护者修复提交 `63caea292d40a1a549ad324f37b4d481db184cd2` 完全一致，6个最终验证源码／测试 blob 全部匹配；旧评审祖先没有进入公开 main。此收尾状态仅补工程文档，不改变已验证生产代码。
