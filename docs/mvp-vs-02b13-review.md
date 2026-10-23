# VS-02B-13 维护者复验：权威事件回放与异步取消

日期：2026-10-23。交付HEAD `0055439d7905b656312c8015f696f36deba32660`，主要源码提交 `804634ef`、`2311fdcc`、`866a9496`，父基点 `9a419345`。维护者修复源码／测试提交 `2b66d130`、`ace41bb6`（最终），评审分支 `review/vs02b13-presentation-fix`。

## 独立核对

- 初始分支实际为feature/vs02b13-battle-presentation，仅一个worktree。相对9a419345增加6个提交、7个文件，无包依赖、冻结fixture或测试skip修改。此前留下的交接／计划两份修改及未跟踪用户反馈清单仍在，未覆盖或清理；本轮补入工程记录。
- main、origin/main和实时远端main均为`86798227ca995c4ff40043b99a0c6846ed177154`。初次普通网络访问失败，随后只读重核远端成功。HEAD与main初始关系为main领先0、交付分支领先57个提交；没有合并旧评审历史、没有推送。
- 可见任务列表中未发现另一活跃项目开发任务，未创建或联系agent。此为本次可见状态，不代表对外部进程的绝对保证。
- 原交付日志build/vs02b13-final4/full.tap实际完整1..1084、pass1084、fail/cancelled/skipped/todo均0，1750551.4918ms；full-exit.txt为0。日志目录没有额外运行HEAD元数据，866a9496来自交付文档；已独立核对该源码提交到0055439d无源码／测试差异。这是交付历史证据，不冒充修复后的结果。

## 交付范围与结论

此次实际推进为原动画／消息／经验事件回放、最小Trainer展示descriptor和资源加载、背景别名预加载、恢复后的精灵显示名；并非七项用户整改全部完成，也不是原13任务书完整A/B交付。

| 分支 | 本轮结论 |
|---|---|
| 权威事件／公开投影 | 有限自动切片通过；原Worker保持权威，Common动画字段修正后有明确原阶段证据 |
| 原展示播放与生命周期 | 部分通过；有原类／控制器回归证据，真实双浏览器未执行 |
| 原13 Trainer完整UI | 部分完成；当前单sprite、消息播放，不等同原完整双人物、对话及各场景视觉通过 |
| 用户七项反馈 | 第5项部分推进；其余入口、选队实时同步、整备完成按钮、个人钱显示、捕获故障、退出重开均未由这批关闭 |

## 直接修复

1. 服务端原CommonBattleAnim属性是`commonAnim`，交付却读取`anim`，导致该类事件缺少动画编号。改读原属性；新增明确合成的原CommonAnimPhase经真实Worker执行，核验编号和稳定source／target ID，不假装自然触发。
2. 删除外层5s／4s“只结束等待”的Promise.race。原来超时后事件队列仍在运行，ACK和新菜单已继续，旧回调可能再覆盖。改为展示生命周期AbortSignal、原加载／播放有界等待，断线／clear取消旧任务，await后核对epoch，失败不记作已播放。
3. 原BattleAnim.play增加可选第三参数AbortSignal，既有单人两参数调用保留。中止时停止原帧tween和尾部tween，复用原清理过程回收临时sprite／背景、恢复精灵显示，幂等完成；不改动画帧、伤害、规则或RNG。原无signal正常完成与signal取消分别测试。
4. 回放不再每条message启动异步切换菜单。原消息以0延迟显示完整文字并留可读停顿；dialogue通过原Message handler无交互prompt播放各页，避免原UI.showDialogue内部强制prompt及分页旧回调跨入新决策。不运行浏览器规则阶段。
5. 经验条show后沿用原hide，避免shown一直为true而后续队员不再显示；取消时停止该bar tween并清理显示状态。
6. 回放报错／缩短后，将显示副本HP和可见性恢复为已提交最终值，不残留中途HP；私有核验模型未改。回放仍先应用最终快照，因此不宣称实现从回合前HP逐步播放的完整方案。
7. 原UI新增cancelFade展示端口，清理被放弃的overlay tween和遮罩，避免取消时留黑屏。正常fadeOut／fadeIn原实现沿用。
8. Trainer恢复后的稳定位置设在可见处；原入场事件仍用原tween从屏外进入。旧atlas加载完成不能复活新野生场景中的Trainer；补刷新和迟到资源回归。双训练家伙伴sprite未在本片补全。
9. 展示失败不再写入成功battleSignature，同一快照可再次应用／补播未完成事件；成功重复快照仍不重建菜单。补原CoopPlayPhase直接回归。

复用文件／方法：原battle-anims.ts的MoveAnim／CommonBattleAnim／BattleAnim.play及原资源加载，原UI／MessageUiHandler、PartyExpBar.showPokemonExp／hide、TrainerConfig.loadAssets／getSpriteKey、Pokemon.generateName／updateInfo，既有createSnapshotConsumer、apply→capture、事件ID及outbox。新增适配仅为公开事件和展示生命周期，不新增伤害／经验／钱公式。

## 验证与证据

证据保存在ignored build/vs02b13-review/，不提交日志／截图／房间。

- 最终UI定向：58/58，退出0，11980.4968ms，ui-owned-final.tap／ui-owned-final-exit.txt。先前57/57是追加同快照重试修复前的定向历史。
- 中间联合定向66/66、退出0，78975.482ms，但期间有后续源码／测试补充，不作为最终整套源码证据。最终源码以完整串行为准。
- 最终ace41bb6：typecheck、build:coop-runtime、生产build均退出0；Vite显示1m35s，既有动态导入/chunk警告。最终完整串行 **1092/1092、退出0**，完整`1..1092`，fail/cancelled/skipped/todo均0，2130421.0305ms（约35分30秒）；运行源码／测试ace41bb6。证据full-owned.tap／full-owned-exit.txt是独立单次完整运行，不与受限日志拼接。2b66d130时2m10s为早期构建记录。
- 双浏览器／跨物理设备：本轮未执行，继续交用户测试；具体启动与观察步骤见[用户手测清单](vs02b13-manual-acceptance.md)。

受限全套full-sandbox-interrupted.tap在真实WS连接处出现EACCES，主进程和子进程已按实际命令行核对后终止，父shell退出1；没有正常TAP总计划收尾，不能写成已跑完或通过。已另起full-owned.tap在允许本地连接的环境重跑，单次记录，不拼接。

失败历史保留：native-first.tap为8/9，错误假设自然status回合必产生CommonBattleAnim；后改独立明确合成原阶段。common-second.tap为0/1，因旧numeric fixture入口必须为原固定三员而拒绝；仅修正该合成用例入口，不改变正式可变选队。原交付showText／dialogue镜像端口测试也已改为核对原handler参数与真实生命周期。不能拿这些失败运行冒充通过。

## 仍缺与下一步

- 播放仍位于consumer的ACK前；边界等待有界且会取消，但尚未拆成独立的展示完成屏障。不能称为完全独立于网络同步的播放器。
- 只根据最终field建立显示对象，已离场目标／中途换人／致死动画可能找不到原显示实例；HP／等级最终值可能先显示。回合前展示状态、过程对象和完整事件覆盖需要单独机制批，不能靠延时解决。
- 长回放存在20秒事件预算和单项超时；超出时明确展示失败并保留最终帧，未完成事件不标记完成。不是所有招式完整动画播放保证。资源库底层下载可继续，但过期完成不再恢复该合作场景对象；不宣称全局资源加载器可取消。
- 原训练家双人物、单敌居中、完整倒下／捕获摇球、升级页和各浏览器视觉仍未验收。现有自动数据／controller证据不替代真实画面。
- 用户实测“不能捕获”保持待定位；已有native／WS捕获测试不能关闭该用户故障。钱显示、实时共享14点及退出入口同样没有被回放代码解决。
- 下一批先做用户明确要求的主动退出／回首页／重新开局，范围限本地会话和安全恢复，不解散伙伴房间、不清个人存档。完整本地任务书：docs/AGENT-VS-02B-14-EXIT-PROMPT.md。之后另批定位捕获真实UI链，再做实时选队。维护者本轮停止，不实现下一批。


## 最终提交核对

最终源码ace41bb66d47e9ff2d5b041797c78f726a5b850a；收尾文档不改变src/server/tests/scripts树。实际工作区源码diff为空，最终测试记录的源码／测试blob与提交比较为0差异。收尾再次读取实时远端main仍为86798227，与本地main/origin/main一致；未合并、未推送。本批15文件凭据模式扫描未命中、空白检查通过，仅是本批扫描，不作绝对隐私保证。工程记录和手测清单提交，SPEC/AGENT任务书仍本地忽略。
