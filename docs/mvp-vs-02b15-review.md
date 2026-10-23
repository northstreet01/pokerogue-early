# VS-02B-15：选球后的异常恢复、旧回调隔离与捕获结果反馈

2026-10-23。用户明确启动本片，并补充症状为“选球后报错、无反应或卡住”，具体错误文字已不记得。本片修复已独立复现的同类UI缺口，并加强原菜单到真实服务的证据；不能倒推这些就是用户原故障的全部原因，也不能在没有浏览器复测时将第6项全部关闭。

## 起点与范围

起点4cf40ac2，源码/测试b7cc4f83；实际初始分支feature/vs02b14-safe-exit，可跟踪工作区干净、单一worktree。本次分支fix/vs02b15-capture-ui，仅改early，未创建或联系agent。main、origin/main与开工实时远端均86798227ca995c4ff40043b99a0c6846ed177154。没有合并/推送、改Git配置或操作另一份pokerogue目录。

复用原CommandUiHandler/BallUiHandler、原AttemptCapturePhase/捕获概率/球消耗/EnemyPokemon.addToParty；既有native选队、scope、codec、FormalRoomStore、私有投影、createSnapshotConsumer、真实模型apply→capture→ACK与IndexedDB outbox。展示复用原showText和既有AbortSignal，不重跑浏览器捕获规则、不给本地模型扣球，不新增依赖。

## A：原规则结果和真实生产链

提交7209e79485c31e53a2d6d7b406f20a0fe059fd4d。

- 原默认收藏（两席各两只、IV10默认配招、共享12点）的Worker独立诊断可以自然到合法单野生目标，普通球失败只扣本人一球并回到wait-actions。没有发现该路径上的原捕获公式/消耗错误；未用原native成功否定用户页面报告。
- 新增原CoopPlayPhase+原Command/Ball控制器→真实IndexedDB→真实双WS/正式profile lobby→原selected Worker→本地真实模型/ACK的联测，两席分别验证。先正常战斗到可投球状态；不改HP/球库存/RNG/存档。Phaser绘制、资源与菜单转场使用明确headless端口，不是浏览器视觉证据。
- 原普通球失败没有必然的文字结果，旧客户端又未播放原摇球全过程，可能只看到回到菜单。现在原AttemptCapturePhase执行结束后仅观察实际球消耗及完成/取舍边界，生成capture-result（caught/failed/cancelled），不重新判定、不消费额外RNG、不更改原球数/捕获个体。恢复满员取舍不重复发投球结果。
- 正式adapter将结果按seat私有投影；联测验证本人收到、伙伴不收到。原成功/失败/目标已离场单端用例断言结果事件，旧双捕获/原分数/pending/同实例取消仍保留。

## B：UI问题与直接修复

提交3bd44da53b20e1d04e27b09ab9458c28b2d92767（最终源码/测试）。旧代码的ui-red.tap为77项、74通过/3失败、退出1，明确复现：

1. 取消或重开球菜单后，同一快照/epoch下的旧回调仍能投球。改为复用teamMenuEpoch并一次性消费菜单选择；取消、菜单替换、断线/退出和新快照均失效旧回调。
2. 选球后的Mode.MESSAGE切换拒绝会使异步选择Promise向外拒绝，原球handler不等待该Promise，且缺少统一恢复。现在捕获显示/切换错误、显示具体原错误，恢复原Command；未提交时不写outbox/发行动。已有持久动作仍保持原actionId/回执语义，不谎称撤销。
3. 选球后过早释放battleInputActive，在异步转场期间重复ready/syncStatus能重新打开Command、打断球菜单。现在到真正交接动作前保持门控，原ready通知不能插入新菜单。旧Command显示Promise失败也按原快照/epoch校验，不能禁用新决策。

成功/失败/取消结果通过原消息端口和本人状态栏显示。只补反馈，不宣称已经实现原摇球的完整动画。保留14的独立退出、active暂停/会话归属/fresh入口及13展示取消；没有把捕获扩为持有物/进化/M6或实时选队。

## 证据与失败历史

日志仅保留ignored build/vs02b15/，不提交房间/日志/截图。

- diagnose-default-capture退出0：正常默认收藏双席普通球失败均只扣本人一球，下一输入合法；不是浏览器证明。
- UI红测77/74/3、退出1，之后修复；不改断言或skip掩盖。
- ui-ws-repro及second各0/2失败：联测初稿错误假定双野生均在场时可投球；实际原规则要求只剩一个目标。后按正常战斗自然击倒一只，不删原限制。ui-ws-legal为1/2，席位1测试控制器遗漏原cursor2初始化，修正测试fixture，不称生产修复。
- target-first为86项、84通过/2失败、退出1：native测试先于新UI模块build执行，读了旧runtime，没有新结果事件。已给捕获测试增加独立buildCoopRuntime前置；所有运行器重建串行。
- 最终联合定向89/89、退出0，40862.7838ms，target-final.tap/target-final-exit.txt。含原捕获7、原UI80、新真实UI/WS2；不与历史数量相加成其他整套结果。
- typecheck退出0（typecheck-first.log，对应最终源码树，中途未再改源码）；最终Worker/生产构建均退出0，Vite53.95秒，保留原chunk/mixed-import警告。
- 单次完整串行1117/1117、退出0，1..1117，fail/cancelled/skipped/todo均0，1504204.0389ms（约25分04秒），full-owned.tap/full-owned-exit.txt。运行源码HEAD为3bd44da53b20e1d04e27b09ab9458c28b2d92767；收尾src/server/tests/scripts及package/入口文件blob与运行清单比较0差异，不沿用14的1109。

## 结论与待验

A有限原规则/私有结果及联测通过；B已复现的异步恢复/旧回调/ready竞态与反馈自动通过。真实双浏览器未执行，用户原次故障未取得复测关闭证据；第6项保持“本批已修复确定问题，用户实测待验”。[手测清单](vs02b15-manual-acceptance.md)要求重新构建Worker与静态文件，并记录新的具体错误。

原禁捕条件继续生效：双野生均在场、Trainer、END等按原规则拒绝；携带持有物捕获仍是尚未接入的机制，不能静默改成产品限制。普通球自然允许失败。每人最多6只、满员可放生本人当前前场的原取舍、旧库存显式处理、本人蛋/pending、券/同时全灭未定规则等均未扩大或删除。

下一批实时选队/共享14点已作为独立任务准备，不在本片实施；若用户复测仍有捕获错误，优先按明确错误继续本故障。未合并、未推送；SPEC/所有AGENT/PROMPT继续本地忽略。

## 收尾检查

源码/测试共7个文件、工程记录5个文件，均显式清单处理。git diff --check通过；本批12文件的私钥、常见token及URL内凭据模式扫描未发现匹配，不作绝对隐私保证。SPEC及全部AGENT/PROMPT本地忽略，不提交日志、构建或真实数据。收尾本地main/origin/main及只读实时远端main仍为86798227ca995c4ff40043b99a0c6846ed177154；单一worktree。最终文档提交号与可跟踪工作区状态见实际Git及本地恢复说明。未合并、未推送。
