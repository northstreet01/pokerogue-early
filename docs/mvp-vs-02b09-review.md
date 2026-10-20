# VS-02B-09 维护者独立验收（2026-10-21）

## 起点与证据边界

只读核对起点为 feature/vs02b09-capture，HEAD `7059665854c98850e914093ec1aa57d94205852d`，工作区干净，单一 worktree。A `bd16dac4`、B `722f28e3`、兼容 `8dd281d1`、文档 `70596658` 均在起点 `d279311f05c0591a8f84b9e29ddf67fa5f44cf16` 之后。交付差异为11文件、361增／15删；没有引入新的运行时依赖，也没有引用 tests helper。origin 为既有 northstreet01/pokerogue-early；本地 main、origin/main 与实时 ls-remote main 均为 `86798227ca995c4ff40043b99a0c6846ed177154`。维护者新建本地 `review/vs02b09-capture-fix`，不重写交付历史，不操作参考目录。

交付的 `build/vs02b09/full-final2.tap` 确有正常 `1..1014`、pass1014、fail/cancelled/skipped/todo均0、1594238.4243ms；对应 meta 的 HEAD 为8dd281d1。没有可核对的shell退出码，仍记“退出码未捕获”，不能倒推0。原记录保留。交付第三项JSON测试实际只比较 native-submit 的结果，没有执行捕获，也没有重建Worker，已改名以准确说明范围。

## 实际问题与修复

1. 原 CommandPhase 第二场位的 BALL 分支会把第一场位指令标记 skip。合作适配现在只撤回本次BALL引入的伙伴skip，保留原有skip语义。普通球失败时检查伙伴原招式PP实际增加一次。
2. 原代码按相同目标查找首个BALL命令作为捕获者，同轮两席投球会猜错归属。TurnStartPhase保留原排序／构造，只增加可选queueCaptureAttempt端口；native在原阶段入队时绑定个人scene scope及稳定coopTargetId，并由既有phase codec持久化。执行时核对作用者、球种和目标实例；若排队后目标实例已离场则取消，不改投当前位置的另一实例，不消费球或随机数。另一颗球遇到已捕获且HP为0的同一实例，仍由原AttemptCapturePhase.start提前结束，不重复消费。
3. 捕获暂存reserve使用个人Party view；不再清空共享root.getParty，保留双方前场和原清除来源标签逻辑。捕获生成的Victory重归共享scene，防止个人scope污染后续共享整备。捕获离场时清除失去field owner的敌方turnCommand，保证每个阶段都能capture／JSON恢复，不能依赖连续运行到TurnEnd才变合法。
4. 删除仅记录capture-score的规则空操作，调用原BattleScene.addFaintedEnemyScore；普通球成功例验证共享BattleEnd累计分数。投球计时端口的重复回调按次数递增时间，不再把所有摇球放在同一tick。
5. 捕获转换仍调用原EnemyPokemon.addToParty；新稳定ID从未使用的uint32空位分配，避免旧算法max+1遇到4294967295溢出，不消费RNG。原捕获／图鉴IV待处理intent绑定新个体ID，保留野生来源ID；capture-pending补dexAttr和完整原模型状态，正式adapter据roster得到正确owner。仍为持久pending，未调用个人saveSystem、未发永久收藏成功ACK。
6. 原CommandPhase只接受0–4球种；生成option和纯校验同步排除未被原入口支持的Luxury Ball。存在目标持有物时明确阻断，防止原转移调用造成丢物／个人modifiers断言失败；不删除个人modifiers空断言冒充支持。带持有物捕获仍未完成，不能统称全部普通捕获机制通过。
7. 捕获目标字段在原AttemptCapturePhase类中以可选declare声明，字段覆盖清单同步登记；未改冻结fixture或弱化AST覆盖断言。
8. B删除合作网页投球按钮，复用原BallUiHandler窗口、光标、数量、键盘和鼠标。只增加可选展示数量／允许球种／选择和取消回调；单人无参数路径保留原CommandPhase调用。合作回调只提交服务器给定ball/targetId，Mode.MESSAGE异步切换后再查snapshot／epoch，失败／拒绝回原Command重选；重复就绪通知不覆盖已打开的球菜单。浏览器不扣球、不转换个体。

旧v6／v7安全边界和无reserve的旧客户端投影形状继续保留；未审查版本已生成的无owner待处理事实或无scope中间捕获Phase未做猜测迁移，用户复测使用独立目录，不清理旧数据。

没有新增reserve原Party／Summary查看界面，目前仍只有名称／等级行。这是交付B的剩余功能缺口，留在下一条战后换队纵向链路中补齐。未为了验收扩做战后换队或永久收藏。

## 本次验证

- 早期定向55/55、退出0（81109.8073ms），覆盖真实Worker6项、正式双WS16项、UI33项；后续ID分配、完整属性断言、声明与目标离场取消调整以最终全套为准，不把早期日志当最终源码结果。
- 最终捕获／Phase codec定向16/16、退出0（13705.402ms），包括目标离场取消和未弱化的Phase字段覆盖检查。`full-attempt1-manifest-failed-aborted.tap`记录首轮全套在344项字段声明覆盖检查失败，随后主动中止，无完整收尾／suite退出码；已补可选字段声明，第二轮全套独立重跑。
- 最终typecheck、Worker构建、生产build均退出0；生产build用时1m29s，保留既有chunk警告。完整串行第二轮正常收尾：1..1022，tests/pass均1022，fail/cancelled/skipped/todo均0，shell退出0，1110402.3664ms（约18分30秒）。运行HEAD为70596658加维护者暂存的源码修订，不能把结果归于70596658原树；source-blobs.txt记录实际源码／测试blob并核对与规则修复提交一致。
- 最终源码／测试blob清单、TAP、退出码在ignored `build/vs02b09-review/`；包含调试失败历史，不混作通过结果。此前定向失败包括修复中的参数编码／共享scope问题，以及测试误用pokeballCounts代替投影pokeballs；最终结果单独记录。

正式WS使用原生数字队伍夹具、真实adapter和FormalRoomStore；重启用例在同一测试进程内关闭并重建HTTP服务、adapter和房间Worker。独立server/start进程＋生产静态页面的双浏览器关服重启仍待用户，不能混称已执行。

新增的实际场景：普通球确定失败且伙伴真实出招；普通球确定成功归席位2并记原分数与待处理事实；双方同目标合成Master Ball初态（明确测试夹具）不重复个体／扣球，且每个阶段重建Worker与连续执行语义检查点一致；uint32最大退休ID不导致新个体溢出；真实双WS＋FormalRoomStore单方输入重启、候选写盘失败重试、提交后同目录重启、去重／冲突、两房间隔离、本人真实模型apply→capture→ACK、整备后下一战双方FIGHT。随机普通球成功／失败使用确定seed和正常native生成初态，不改捕获公式，不当浏览器证据。

## 结论与余项

结论：A在上述不含持有物、原入口支持球种的有限切片内通过自动验收，完整A的所有机制并未完成。B原球菜单接缝已补，原Party／Summary备用查看未接，双浏览器全部待用户，因此B仍部分完成。跨物理设备、移动端、所有seed／特殊规则、全部成长／奖励／购物重抽、战后换队、永久收藏／蛋事务均不能借本片宣布通过。

浏览器由用户执行，维护者未使用伪造checkpoint、改值或隐藏方法演示成功。请先用最终源码重新构建Worker和生产静态文件，使用独立ignored数据目录与空闲端口8046（启动前确认空闲，不关闭原服务）。运行说明仍见交付记录，并注意下面追加的当前修订。

下一批优先“已捕获reserve → 本人原Party／Summary查看 → 战后与本人party一换一 → 持久化／恢复 → 下一战实际使用新个体”。复用M2已有reserve-swap及原Party／Summary，不重造协调器／公式，不同时扩展购物、成长和M6。完整任务书仅本地保留。

提交前明确暂存13个源码／测试／工程文档文件；空白检查通过，禁入路径和新增行凭据模式本批扫描均未命中。这只是本批范围检查，不是绝对隐私保证。SPEC和完整下一批提示词仅本地忽略；main未变，未合并、未推送。
