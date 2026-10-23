# VS-02B-20 维护与验收记录

2026-10-24。最终自动验收通过，真实双浏览器/音频仍待验。用户在第二轮试玩仅记录后，再明确授权“允许，开工吧”，要求尽量复用原版表现并补回背景音乐。本批处理第二轮第2/1/5项的共同显示底座及音乐；第3/4/6/7项仍开放。

仅在early实施，分支feature/vs02b20-original-presentation，从7396b7f2（源码/测试a6f8b73b）继续。启动核对main/origin/main与实时远端main均86798227ca995c4ff40043b99a0c6846ed177154、单worktree，没有联系/创建其他agent；未合并、未推送、未部署。SPEC和AGENT/PROMPT只留本地。

## 原实现复用

原Pokemon/BattleInfo.updateInfo(false)负责血条，MoveAnim/CommonBattleAnim负责招式。把原FaintPhase/SwitchSummonPhase的纯离场部分、SummonPhase精灵球飞行释放、NextEncounter/NewBiomeEncounter的2000ms滚动和SwitchBiome的延迟1000ms/渐变1000ms抽成共用函数，原Phase继续保留状态、分数、掉落、友情、能力和队列推进回调。没有另算伤害、HP、规则/RNG，浏览器不执行规则阶段。

显示层按稳定ID保留上一画面，核验模型仍先接受权威最终状态并真实apply→capture→ACK；之后按原事件依次更新显示副本。最终离场对象延迟到事件结束回收，新入场沿原精灵球表现；首次/重连直接收敛最终状态。同场revision复用精灵、血条和资源，仅改变的原模型字段更新，不再每次clear整场。

整备界面复用原ModifierSelect的活动页更新；伙伴操作虽然推进共享决策编号，但本人选项、资源和队伍相同且新快照已成功呈现时保留回调/目标页。行动仍使用最新版本并等待ACK，真正过期选项、本人状态改变和退出仍失效。本人购买/伙伴领取不额外全场MESSAGE重建；重抽保留原候选重建流程。

首页/大厅/战斗接回原BattleScene.playBgm，原Battle.getBgmOverride/Trainer配置和群系键选择曲目，沿原音量、循环点和淡出。未复制音频资源或另造播放器。新增取消信号阻止退出后迟到加载重新播放；同曲目不因购买/快照重新启动。原音频资源本来仍在仓库，缺口是合作Worker端口静默及合作首页/显示层未恢复播放调用。

清理包含原tween、血条、叫声、精灵球粒子、资源完成回调和音乐加载。超时不能让旧离场/召唤回调覆盖最终画面；取消资源加载后不再启动原sprite动画。规则状态和原单人调用默认参数保持兼容。

## 中间失败与修复

原始日志保留于ignored build/vs02b20。最初red两例证明重复apply重建以及最终HP提前覆盖。UI早期夹具缺字段、旧回调准入过宽和同帧退出已分别修正，原断言保留。提取共用函数后旧phase-model测试辅助器接回真实新依赖，没有替换规则或删断言。

原native训练家→下一野生遭遇发现INVALID_JSON；单独真实原路线诊断确认新增bgm事件key为undefined：无渲染arena未保存bgm。按原Biome名称回退补齐，未放宽canonical校验；自然路线恢复。诊断仅临时修改ignored生成bundle，后续构建重建，不进入源码。

曾在串行测试尚未读取展示模块时继续编辑，引起target-c后段9个构建失败，原日志/退出1保留，不当成通过；其中先前原规则62例通过只是中间定位证据。ui-d因沙箱localhost WebSocket EACCES失败并悬挂，精确核对进程后终止该轮，保留日志/中断记录；在允许连接环境独立重跑，不拼接。ui-e/f新两席用例分别定位共享决策id变化和consumer规范化快照的引用身份差异，保留过期回调原断言，改为成功呈现的版本门控后再验证。

## 首次提交与定向证据（历史）

A c8a22c5a4aff4ba295ba35005b90baf9532d9741：共用原展示、按序回放和原音乐端口/取消。B及冻结源码/测试19372d1eaafe50f2aedb1d43913aa4996721e75a：原整备页保留/个人输入续用和首页音乐，含两席真实链。联合定向206/206、退出0、295731.0092ms，fail/cancelled/skipped/todo均0。其间复测ui-g143/143退出0；最终定向新增长期批次预算用例也通过。

收尾实时远端核对：系统配置的本机代理7897不可用，普通及沙箱外代理命令失败均保留；仅本次git -c http.proxy= -c https.proxy= ls-remote只读直连成功，main仍86798227ca995c4ff40043b99a0c6846ed177154，未改配置/远端。

## 首次冻结的验证状态（历史）

冻结源码/测试19372d1e：typecheck-frozen、runtime-frozen、build-frozen退出均0，生产构建日志1m39s（约99秒）；原动态导入/大包提示保留，未调低警告或改构建门槛。109个tests/*.test.mjs文件正在按名称串行执行，完整TAP/真实退出及起止时刻保留，最终数字待整轮结束。历史19的1263/1263不能用作本批结果。真实双浏览器、帧耗时/资源网络测量与真实音频设备未执行，见[手测清单](vs02b20-manual-acceptance.md)。


下一完整本地任务书docs/AGENT-VS-02B-21-CHINESE-PROMPT.md已准备：A本人战前换人问句scope，B完整中文路径清单与原资源迁移。20完成后停，不自动实施21；共享池和自动整备联动继续另片设计。


## 入场同回合受击收尾修订

2026-10-24收尾发现入场HP边界：首次19372d1e完整回归在929项通过后主动中断（退出-1，非完整通过），因为复核发现换人后同回合受击时新对象可能显示最终HP。新增复现13例中12过/1失败（应为19，提前成14），修复为按原pokemon-enter公开HP入场、逐事件受击并最终收敛；13/13退出0。真实原Worker种子AI同回合受击与原entry HP事件检查也已通过，正在跑联合UI定向；必须新提交/重新冻结、构建及独立完整回归，不能引用旧206/206或中断929项作为新最终证据。

原始incoming-red.log为13例12过/1失败，明确显示预期19、实际14；incoming-green.log为13/13退出0（12220.5794ms）。新增原Worker自然种子AI检查实际pokemon-enter.view.hp先于受击damage-display，未注入规则结果或改AI。初次full-frozen日志最后929项通过，主动中断退出-1；没有完整汇总，不当作最终通过。后续完整回归必须独立保存，不能拼接。


## 最终入场修订冻结

C及最终源码/测试368167ce10fec5dbdcf22822a52a9fea60312a15。target-incoming联合135/135退出0、109718.9875ms；新的typecheck-owned/runtime-owned/build-owned退出均0，生产构建1m27s（约87秒）。2026-10-24T01:31:59+08:00独立重跑109个文件，完整证据full-owned.log/.exit及full-owned-started/finished，已完整1279/1279退出0，见下方最终结论。原final-source-head与full-frozen均属19372d1e第一次冻结；最终清单为final-owned-source-head/blobs，必须按此核对。


## 最终独立完整回归与结论

2026-10-24 VS-02B-20最终覆盖：用户已授权按原版复用并恢复背景音乐；feature/vs02b20-original-presentation，Ac8a22c5a4aff4ba295ba35005b90baf9532d9741、B19372d1eaafe50f2aedb1d43913aa4996721e75a，入场同回合受击修订C及最终源码/测试368167ce10fec5dbdcf22822a52a9fea60312a15。第二轮第2/1/5增量显示、原HP/倒下/召回/入场/遭遇过场及原BGM已实施；初始联合206/206退出0，最终修订联合135/135退出0（109718.9875ms），最终类型/Worker/生产构建均0、生产1m27s。最终冻结版独立完整串行1279/1279、退出0、1806897.2233ms，fail/cancelled/skipped/todo均0；源码/测试blob0差异。旧19372d1e回归929项后主动中断退出-1，因发现入场HP边界，另存且不拼接。真实双浏览器/帧耗时/音频设备尚未执行，第二轮第1/2/5及音乐待用户实测，第3本人换人提示/第4全面中文/第6共享池/第7自动整备继续开放。见[20维护验收](mvp-vs-02b20-review.md)与[手测清单](vs02b20-manual-acceptance.md)。下一完整本地21任务书已备，不自动实施；未合并/推送，不创建/联系agent。

最终证据仅采用build/vs02b20/full-owned.log/.exit与full-owned-started/finished，对应final-owned-source-head/blobs。109个测试文件按名称串行、单次完整执行；旧full-frozen主动中断记录不属于本次汇总。新最终源码入场HP事件在原Worker自然受击路径及显示副本回放两侧验证，原核验模型没有为动画改写。

已实现的第1/2/5和音乐属于代码/自动证据通过，用户真实体验尚待复测；不能宣布第二轮7项全部关闭，不能把共享商店/自动整备或完整中文写成已完成。下一片21仅准备完整本地任务书，停在本片收尾。
