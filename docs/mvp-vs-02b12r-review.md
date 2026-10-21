# VS-02B-12R 维护者验收：普通训练家核心与奖金平分

日期：2026-10-21。交付 `bb96bcc8`、`cf6a9020`、`1eaaf5c4`；起点 `880ff636`。维护者分支 `review/vs02b12r-trainer-fix`，修复源码／测试 `f0bbc07d7d2337fe43725c085f0fa9cd3967a0e9`。

## 独立核对与规则确认

交付时工作区确实干净，仅一个worktree，未发现其他活跃项目开发任务，没有创建／联系agent。提交父链与差异吻合，无依赖变更、跳过测试或冻结参考修改。main、origin/main及实时远端为`86798227ca995c4ff40043b99a0c6846ed177154`，未合并、未推送。

交付日志`build/vs02b12r-final/full.tap`有完整`1..1072`、pass1072、fail/cancelled/skipped/todo0、1206748.8398ms，退出码文件为0；运行HEAD cf6a9020来自报告，独立核对cf6a9020至文档提交源码／测试无差异。该日志不作为维护者修复后的结果。

用户在本轮明确：**普通训练家奖金按原版总额由双方平分**。券归属／时机与同回合敌我全倒仍未确认，不能据此自行决定。

## 直接修复与原版复用

1. 原生后备：复用原Trainer构造、Breeder／Clerk配置、模板、等级、`genPartyMember`、AI和原SwitchSummon／PostSummon。补真实native后备与逐阶段fresh Worker差分，不以测试driver代替生产。单Trainer与原DOUBLE变体分别验证。
2. 双方敌前场同时倒下、仅一只后备时，两次Faint都可能排入补位。执行时重新核验后备可用性；已被前一个原SwitchSummon消费后，后一阶段用基础Phase结束，避免倒下个体再次PostSummon／发动登场效果。不手写选人、交换或能力公式。
3. 恢复被交付改成恒false的`validateVoucher`保护；原规则请求未确认券时仍拒绝，不伪装成“尚未领取”继续授予。
4. 正式adapter将自然新出现的`learn-move`作为稳定输入停点，修复原runToStable继续要求continuing而拒绝学招的接缝。用原普通战斗自然生成的学招前检查点经过正式WS，精确匹配原自然学招结果。
5. 原TrainerVictory只生成一笔原MoneyReward；在候选队列同步时转换为两席有scope的原MoneyRewardPhase，逐席执行原start。只在该个人奖金阶段临时适配`getWaveMoneyAmount`返回原总额一半，随后恢复方法；不改变其他奖励／购物金额方法。原总额为10的倍数，先校验整数／偶数，无自行舍入规则。本参照原总额110，两席55。
6. 本人money通过个人scene读写权威个人资源；两阶段的scope和队列进入既有codec，第一份完成后重启只执行另一份。奖金文本仅发本人；个人achievement-check带owner且按owner区分ID，不合并双方待处理事实。不调用永久saveSystem或授予M6。
7. 补原下一遭遇清理旧Trainer的`destroy`渲染端口；此前胜利后进入下一场会因缺少该展示方法失败。没有改原Trainer规则。
8. 删除当前战斗`wave%10`的额外支持判断，以实际Boss对象／battleSpec及下一原阶段判断能力；原波次分配规则保留。不支持的下一阶段错误携带其原phase名称，未支持Boss不因此放开。不修改fixedBattles定义、敌队或波次，不新增波次白名单。

## 实际生产证据与范围

- 默认原GameData初始化：席位0呆火鳄＋杰尼龟、席位1新叶喵＋杰尼龟，IV10、中性默认性格、默认配招，各6点／共12点，无额外解锁。server-only seed `learning-natural-2`。
- 自然selected入口→前4波→原普通训练家→真实敌方倒下→原胜利→原总额110平分55／55→原个人整备→双方准备→原版自然下一野生遭遇→双方真实FIGHT。第5→6波仅为回归案例，代码不按该编号准入。
- 带后备验证是明确的原构造初始场景，原Breeder四员／DOUBLE变体及Clerk三员；不是声称默认自然第5波有后备。双倒下特例使用明确HP0和原Faint队列夹具，不冒充自然战斗。
- 正式双WS／FormalRoomStore分别消费自然倒下、原后备场景、自然获胜回合的检查点，验证单方提交后重启、候选落盘失败重试、同ID去重／异内容、房间隔离、apply→capture／ACK、重复恢复不重授奖金或经验；奖金获胜回合由正式adapter实际执行，非直接改余额。明确存在测试初始化检查点注入，不是浏览器选队全过程，也未启用生产默认fixture。
- 自然学招正式停点有独立验证；普通训练家禁球保护保留。

## 验证

最终源码f0bbc07d：native **9/9、退出0**，63540.4857ms；正式双WS **4/4、退出0**，30642.8379ms；typecheck、Worker构建、生产build通过，生产build显示1m7s。最终完整串行 **1082/1082、退出0**，完整`1..1082`，fail/cancelled/skipped/todo均0，1141266.2153ms（约19分1秒）。运行HEAD为f0bbc07d，文档收尾不改变源码／测试；不沿用历史结果。完整证据为`full-final.tap`和`full-final-exit.txt`。结束后独立重跑`build:coop-runtime`退出0。主证据为`native-final-owned.tap`、`formal-final-owned.tap`和各自真实退出码文件。

证据目录：ignored `build/vs02b12r-review/`。失败历史保留：原构造夹具初版缺少native显示端口／原turnData初始化，修正夹具；逐阶段对比初版直接比较局部phaseId，改为既有语义差分方式，仅剔除局部phaseId、保留决策ID/全部规则状态/队列scope且逐事件精确比较；原Boss模板并非必有后备，修正该错误夹具假设；两组同时重建运行器导致`ORIGINAL_RUNTIME_BUILD_REQUIRED`，已改串行；类型检查一处protected scene访问已修正。上述失败运行不能算最终通过。

## 验收结论及剩余

| 分段 | 结论 |
|---|---|
| A | 普通非Boss、当前支持状态下的进入／倒下／后备／正式事务有限自动切片通过；不是所有Trainer配置或浏览器通过 |
| B | 部分通过：服务端原胜利／奖金平分／整备／自然下一遭遇FIGHT自动通过；原Trainer展示和对话未接齐，双浏览器未执行 |

A普通非Boss、当前支持状态下的进入／倒下／原后备／恢复有限自动链已获得证据，不能扩大为所有Trainer／seed机制。B服务端奖金、整备与自然下一战已到达；**原训练家展示／对话尚未接齐，双浏览器未执行，因此B整体仍部分完成**。

当前shared有battleType但无Trainer展示descriptor，`CoopBattlePresentation`只恢复战场精灵，`ui.showDialogue`的headless回调不代表浏览器已播放原对话。下一批按机制补普通Trainer原展示及对话到原Command输入，复用已完成核心，不按波次开发；见本地忽略任务书`AGENT-VS-02B-13-PROMPT.md`。

原报告“奖金前边界”是候选触达后失败回滚，并非持久化的已胜利输入停点；本轮规则确认及修复后，普通奖金路径已继续。原失败／部分记录保留，下面的工程计划以本复验为准。券、全灭顺序、剧情/Boss/地图/进化/其他奖励/M6/跨设备/部署均不由本片宣称完成。
