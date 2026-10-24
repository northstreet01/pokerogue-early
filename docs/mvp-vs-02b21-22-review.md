# VS21+22 共享商店、中文及原成长显示维护验收

状态：最终源码/测试83ae8614b33951a5cfa641ded4370403984bca04已冻结，类型/Worker/生产构建均0（1m37s），最终独立完整串行回归1314/1314、退出0、1568066.4912ms，fail/cancelled/skipped/todo均0，本批自动验收通过，真实画面/音频仍待验。分支feature/vs02b21-22-original-completion，从20工程记录0d45db82继续；问句归属首片f5646ce8、联合实现838fbe94、恢复修订02971224、可见中文b8273faf、连续阶段编号收尾15008877、双语UI断言83ae8614。用户授权两批同时推进，免费与付费商品都共享限量，并追加HP/升级/进化UI复用原版。仅early工作，无其他agent、合并、推送或部署。

## 结果与原实现复用

新正式冒险通过可持久化sharedPreparation标记使用同一免费候选和原固定付费目录，每条库存一份，每席一件免费奖励，付费各扣个人钱。原SelectModifierPhase回调、draw、重抽价格、扣款、目标过滤和addModifier仍负责规则；共享层只登记领取及同步菜单，不删除售出条目，不改变原多行索引。旧存档无标记继续原个人菜单/手动完成，不静默迁移。领取或确认跳过自动结束本人购物；原学招/进化等必要子选择完成后才ready，双方完成进入原下一战。一人领取/跳过后锁定免费重抽，已购付费库存不补货。

本人战前原问句scope限本人，公共入场/伤害/HP/离场仅共享显示事实；EXP、六项能力值和进化前后完整模型仍私有。原CheckSwitch、强制补位和共同战斗消息保留。

中文沿原i18next、字体和资源，商品使用显示专用名字/说明，原name/ID/codec不改；常规状态、特性、招式附效、天气/场地、非Boss训练家标题与实际支持对白已补接。原i18n调用产生的key/嵌套参数作为显示来源元数据传递，不反查整句英文。全原招式/特性名称及描述已审计；961条early差异说明的来源、摘要和许可见[来源记录](early-catalog-translation-sources.md)及[中文路径清单](vs02b21-localization-inventory.md)。外围联机状态解释部分原本固定中文，英文模式仍有中文；不宣称全界面双语完成。

原Exp/LevelUp/LearnMove、EvolutionPhase.applyEvolution/queueEndEvolution及既有preparation-growth runner接入生产；自然进化、取消/暂停和自然神奇糖果成长保留原队列/引用/规则。客户端原BattleInfo负责HP/EXP动画，原BattleMessage双页显示升级增量/总值，原EvolutionPhase负责进化背景视频、精灵交替、粒子、消息和音效，仅对已提交模型副本执行显示，不重算经验/能力/进化。退出清理计时器、补间、音效及旧转场；成长面板清理幂等，旧音效回调不能恢复新页面音乐。新外观最终与权威快照收敛，恢复不重放历史成长。

## 已有自动证据与中间失败

原始日志保存在ignored build/vs02b21-22；不能将不同运行拼成一次完整通过。

- text-final-b：92/92、退出0、90974.6072ms，含原状态/招式/回合差分、中文、原UI/IDB/双WS/Worker成长交互与既有捕获/商店路径。
- growth-final：100/100、退出0、111144.3084ms，含原冻结糖果/等级/必要选择、双WS各阶段失败恢复、原展示及音效取消。
- durable-d：3/3、退出0、19156.4879ms，共享同项并发、付费扣款/库存写盘失败恢复、自然进化写盘恢复与去重。后续加入真实消息中英文和下一遭遇问句两席归属，durable-ui-final中对应4项通过；该联合运行另有新声音清理重复stop断言失败，后续已修为幂等，growth-final通过。
- catalog-complete-c：21/21、退出0、7031.7734ms，原进化场景/目录/训练家/原i18n/元数据。后续来源摘要及天气覆盖由text-final-b、growth-final执行，不把前次计数当后次源码结果。

先前失败完整保留：shared-a漏Worker操作白名单；growth-ui多次发现真实显示端口、客户端粒子误触规则RNG及异步清理问题；joint-b为47通过/1失败，新增测试误将后续原EXP结算当伙伴不应变化，修为精确核验所有权/物种/IV/配招，规则仍由原Worker及模型ACK核对；text-final-a的回环WS受沙箱EACCES拒绝，另有测试错误直接使用未导出的Arena类，均独立修正后重跑，未skip/改冻结参考/拼日志。自然进化正式链实际发现INVALID_PREPARATION_ID：旧native编号将成长后缀解析成NaN，已保留旧数字编号兼容并对后缀沿用安全序列递增，完整持久化复验通过。fresh测试的异步开页等待与原handler玩家端口补齐只修测试夹具，不声称是生产故障。

首次独立全量源码838fbe94，日志full-owned.tap在682项后主动中断，工具返回退出1，TAP不完整，绝非完整通过；first-source-blobs.json保留其源码清单。已发现5个失败：连续运行和每阶段重启时，临时翻译来源缓存不同导致事件presentation有值/null不同；旧switch夹具尚未接原i18n；旧奖金计数将新增的本人换人/经验/升级消息也算作奖金。没有删除事件、过滤新metadata来放宽原对照，而是把MessagePhase来源JSON保存为原display标量字段、阶段局部清理缓存并重建显示名字，保留多页消息的来源切片。规则字段/schema数值不变，显示JSON不进入规则投影。旧夹具改接真实依赖，奖金断言精确核验原moneyWon键且仍每席一次。

修订定向：recovery-text-b 23/23、退出0、104436.7387ms（原连续/每阶段新Worker、Trainer替补与下一战）；recovery-joint 38/38、退出0、101159.7541ms（真实IDB/双WS/Worker、共享库存、成长及原UI）；recovery-codec-b 27/27、退出0、12001.1165ms；recovery-projection 9/9、退出0、3358.6483ms，包含修改显示JSON仍不改变原规则投影。修订中曾直接保存对象被原scalar-only display校验拒绝，已改JSON字符串；类型库不支持Object.hasOwn已改原hasOwnProperty写法；清单发现未声明的可选显示字段，已用declare属性补齐，单人不产生初始化行为。所有失败日志保留。

第二轮02971224全量输出843个通过条目、当时无TAP失败后因源码文字排查发现遗漏而主动中断（工具退出1），另存full-second-owned.tap及second-source-blobs.json，不是完整通过。AST检查消息框直接英文，发现并补齐满层道具替代、旧保存失败/导入、初始伙伴解锁/蛋招式、Starter改招；进一步补Summary的经验/下级标签、训练师/属性/取消、性格及相遇说明，复用原BBCode和真实早期已有字段，不捏造相遇波次。35项原统计标签按稳定key显示中文、30条原随机标题台词按原目录索引翻译，英文目录/选取次数不变。visible-text-final-a118/118退出0（104312.6348ms）；最后visible-text-final-b112/112退出0（97580.1878ms），实际原满层回调消息的key/本人scope、原统计只读事实与原台词英文逐项校验均通过。直接消息框扫描仅余已有中文分支的条件模板；统计/台词原英文数据保留供原规则/英文显示，非直接漏译。没有借自动测试暂无失败而忽略手动源码审计缺口。

第三轮b8273faf输出到第991条通过编号后，已有6项失败并主动中断（工具退出1），另存full-third-owned.tap及third-source-blobs.json，不算完整回归。两项为旧断言：addModifier整体源码逐字对照不允许新中文提示、WS奖金计数把所有本人消息计成奖金；前者只将唯一满层显示调用精确替换成已经批准的新表达式，其余完整方法和其他转移方法继续逐字比较，原冻结fixture不改，后者仍精确核验每席一次moneyWon和真实+55/去重。另4项学招后下一FIGHT超时确属实现遗漏：连续运行和捕获选择剩余3处编号转换尚未使用统一nextNativeDecisionId，后缀产生重复NaN编号，正式服务安全拒绝候选。现已补齐，src/server所有decision.id数值解析只剩统一的严格数字校验入口；不修改学招/战斗规则。原WS测试辅助器同时识别新evolution输入，不自动代选。continuation-final-a为62/62、退出0、226660.2212ms，覆盖全部原转移/复活对照和完整原WS桥、4条学招后继续战斗、存储失败/重启/去重/隔离。之后15008877再次冻结、完整重跑，不能拼接上述三次中断数据。

第四轮15008877完整执行115文件，1312通过/2失败，退出1，1713804.0672ms，fail=2且cancelled/skipped/todo均0；完整日志full-fourth-owned.tap/.exit与fourth-source-blobs.json保留。这两项均为coop-play-entry旧断言仍要求英文too many/Lucky Egg，实际默认中文满层提示/幸运蛋已正确显示；没有修改产品效果来迁就旧英文。测试改为分别精确核验中英文整句，并保留原取消不发奖、真实层数及模型ACK反篡改断言，语言用后恢复；该整份UI测试ui-language-final103/103、退出0、11476.2891ms。83ae8614只修测试，产品源码与已构建的15008877一致；原类型/Worker/生产构建证据仍有效，不因测试文字改动重复构建。之后以83ae8614冻结548个blob进行第五轮独立完整串行回归；不拼第四轮通过项。

## 验收边界

真实双浏览器、音频设备、画面流畅度及小窗口排版尚未执行，见[本批手测](vs02b21-22-manual-acceptance.md)及[VS20手测](vs02b20-manual-acceptance.md)。暂停进化后联机Party重新开启尚未接通，选择前已明确说明；永久收藏写入/M6事务、TM及进化石等复杂奖励入口、融合/转移、特殊遭遇/Boss、券政策与同时全灭规则、跨设备/部署未扩。原目录可读不表示所有机制已经接通。

维护者尝试使用computer-use补查真实浏览器，已阅读其技能/安全要求并启动隔离的冻结版服务（端口18024、房间数据与Worker副本都在ignored build内）。工具成功列出并启动Chrome，但首次取浏览器状态即因无法可靠确定当前URL、无法执行策略检查而主动停止该回合的Computer Use；没有导航/点击/输入游戏界面，没有尝试绕过。临时服务随后关闭，不计为任何真实画面、双端或音频验收通过。

## 最终冻结与独立回归

冻结源码/测试83ae8614b33951a5cfa641ded4370403984bca04；最终独立串行115文件回归1314/1314、退出0、1568066.4912ms，fail/cancelled/skipped/todo均0。开始2026-10-24T13:57:30.9768655+08:00，结束2026-10-24T14:23:39.1856863+08:00。完整原始TAP、真实退出及起止时间在ignored build/vs02b21-22/full-final-owned.tap、full-final-owned.exit、full-final-start.txt和full-final-end.txt；不使用三次中断部分、第四轮失败部分或20旧结果拼接。类型检查、Worker和生产构建均退出0，生产构建1m37s。

548个源码/测试/资源/配置blob与冻结清单逐项比较0差异，源码工作区无未提交修改；清单见ignored build/vs02b21-22/final-source-blobs.json。本地main、origin/main与本轮实时远端main均86798227ca995c4ff40043b99a0c6846ed177154，单一worktree。七份工程文档208处本地链接检查无缺失，有限凭据模式扫描无命中，git diff --check通过。仅显式提交这七份工程文档，SPEC及AGENT/PROMPT保持本地忽略；未合并、推送或部署。工程文档提交后再次比对HEAD及源码工作区，最终Git/实时远端、各轮结果与日志摘要记录在ignored build/vs02b21-22/final-evidence.json。本批只交付代码及自动验收，手测未执行项继续开放。
