# VS-02B-17：原金钱、常用道具商店与页内整备

2026-10-23。用户明确“继续下一批”，本片按17任务书实施；期间询问剩余范围，已说明四块近期开发范围并不等于固定四批：当前整备消费、一般持久道具/复杂成长、统一入口与局外UI、战斗展示补齐。永久事务/特殊遭遇/跨设备仍另有缺口。

## 起点与复用

起点63d837b57774dfc9564367af2fa5460e06209887，16最终源码c7495a34；仅early，未创建/联系agent，单worktree。main/origin/main及开工、实施中只读实时远端main均86798227ca995c4ff40043b99a0c6846ed177154。分支feature/vs02b17-preparation-shop。A/B提交和最终证据在收尾追加；未合并/未推送。

复用完整原SelectModifierPhase.start/createModifierSelectCallback/getRerollCost、原shop工厂、BattleScene.getWaveMoneyAmount/addModifier及各原Modifier/filter/shouldApply/apply，使用既有preparation-effects-runner、安全决策、codec、规则任务观察器、原Worker、adapter、FormalRoomStore、私有投影和模型ACK。未把tests/helpers或源码摘取VM接到生产，没有重写价格、扣款、治疗/PP或随机公式。

原ModifierSelect/Party及其moveSelectFilter、updateMoneyText继续用于页面；只新增可选合作完成端口，单人无参数维持原行为。旧实验effects/growth/persistent测试是接缝参考，不当作正式native已完成。

## A：原生效果和资金

生产支持按原类型判断的HP恢复（含单体复活）、状态恢复、单招/全招PP恢复、PP提升、球补给和金钱奖励；两席各用13种真实原工厂实例验证效果。合成条件仅用于没有自然抽到的类型，明确不是自然浏览器测试。全队复活SACRED_ASH、一般持久道具、糖果/进化/TM/融合/转移等仍明确未接，券政策未确认不发放，不删目录或pending。

购买重新核对当前原商店类型和价格、本人余额、稳定pokemonId和原filter/招式目标。由原回调独占扣款，映射原商店一行/两行，免费奖励状态保留且撤销本人ready，不改变伙伴。连续重抽只运行原回调排入的新SelectModifier实例，原随机流/池表/价格/菜单/阶段同候选保存；恢复旧菜单不start、不再次重抽，合作三种诱饵仍排除。

原Party回调异步addModifier及每个updateInfo交给既有任务观察器等待，原allSettled吞掉updateInfo拒绝时仍失败，不发布半成品。金钱变化产生本人私有消息，金钱奖励的成就检查仍是既有待处理intent，不执行永久存档事务。

自然联测发现正式selected入局只初始化球等资源，沿用headless默认0金钱，遗漏原开局资金。本片仅在新建正式selected冒险调用原gameMode.getStartingMoney()（当前默认1000），旧检查点恢复和numeric测试入口不重新发钱。Trainer测试仍精确验证原110平分的+55/+55及半程重启，不把余额1055误认作奖金1055。

## B：原页消费与完成

入战/整备从本人已提交resources.money更新scene.money和原金额文本，不本地预扣。原页使用服务器已抽奖励、实际shop、rerollCost；领取/跳过后奖励变淡且拒绝再次领取，保留商店。原Party按本人稳定目标、原filter及必要moveSelectFilter选择；显示副本不执行本地规则。

完成按钮位于原Phaser奖励页，可键鼠操作/Enter，显示未处理、可完成、已完成等待伙伴；保留取消准备。必要选择/奖励未处理不得完成，双方完成才继续原下一战。移除脱离原页的DOM整备完成流程。使用菜单epoch、一次提交占用及既有teamMenuEpoch/revision/退出生命周期，旧回调和连点不能再次消费；转场拒绝被捕获，已持久动作保留原outbox，不宣传撤销。

## 自动验证和失败历史

所有日志仅本地ignored build/vs02b17/，runtime重建串行。以下中间证据不替代最终冻结后的回归。

- native-first：33项、25通过/8失败，退出1，测试误把原resetStatus的undefined当null，改为断言原实际语义。
- native-ui-first：123项、117通过/6失败，退出1，旧UI预期仍关闭shop/拒绝Revive/使用额外DOM控件；按新行为保留实质断言。native-ui-second为123/123、退出0、46135.7953ms。
- native-ws-first：38项、33通过/5失败，退出1，异步故障夹具原prototype临时descriptor未设writable；另四项因自然0金钱不能买/重抽。ws-second为0/4、退出1，直接原校验确认余额缺口，随后修新selected开局资金，旧局不补发。
- typecheck-b-first退出1，恢复ModifierType基类未声明运行时子类filter接口；恢复后按能力边界验证类型再使用，后续类型检查退出0。
- native-ws-third：前49项原生/Trainer/selected通过，四项真实WS遭沙箱connect EACCES；无完整TAP收尾，主动中断直接退出1，不能与其他日志拼接。
- ui-ws-third-owned：101项、96通过/5失败，退出1、158860.7057ms。四个下一FIGHT等待失败，另一项已持久动作的转场异常被catch后缺少状态提示；已修后者。
- ui-ws-fourth-owned：107项、101通过/6失败，退出1、103376.8143ms。直接逐原phase诊断（diagnose-next及diagnose-next-phases）确认较弱普通攻击触发敌方BerryPhase的既有未接边界；另两项自然UI测试漏处理原战前可选换人。改测试走同既有自然回归的较强正常攻击并通过原Confirm保持出场，未删树果/改HP/跳阶段，未宣称该持有物缺口关闭。
- ui-ws-fifth-owned：107/107、退出0、59698.4578ms。包括两个席位分别作为原菜单/Party端→真实IDB/双WS/正式selected Worker/真实模型apply/capture/ACK→下一FIGHT；每次的伙伴为真实模型WS客户端，显示和资源端口明确headless，不是两个真实浏览器画面。
- 首次完整回归full-owned为1178项、1177通过/1失败、退出1、1360861.9742ms，fail之外cancelled/skipped/todo均0；正式Trainer WS用例末尾旧绝对余额断言1055不等于55，同一用例前段已经正确断言初始余额+55，后段遗漏同步。以ca524be6修订末尾为每席初始余额+55，原精确奖金/重启/去重/隔离/下一FIGHT断言保持，没有修改生产代码或放松为宽泛范围。首次完整日志及fe8c22a7运行源码清单单独保留，不能与修订后的运行拼接。

冻结前本批联合target-final-owned为158/158、退出0、170788.9582ms（35原生消耗品、10Trainer、5selected、5shop WS、97UI、6UI-WS）；该次本批文件不含后续修订旧断言的bridge文件。typecheck-final/runtime-owned/build-owned均退出0，Vite58.30秒。构建时生产源码为fe8c22a7，后续ca524be6只修订旧WS测试，src/server/scripts/package/入口文件均无变化，不因此重复生产构建。

最终源码/测试ca524be6a8ae42368cd883bb1b7c5c1cc257f670冻结后，full-final-owned单次完整串行1178/1178、退出0、1580679.2504ms（约26分20秒），1..1178，fail/cancelled/skipped/todo均0。前次唯一失败的正式Trainer奖金/重启/下一FIGHT用例在本次完整运行通过，未跳过或弱化。最终src/server/tests/scripts及package/入口blob与运行清单比较0差异，工作树相对HEAD没有源码/测试差异；没有把两次完整日志或定向数量拼成总数。

## 结论与后续

本片范围仅常用消耗品、原购买/重抽和金钱/页内整备，真实双浏览器尚未执行，见[手测清单](vs02b17-manual-acceptance.md)。不能写成全道具/M3/MVP通过。第2/6/7仍待真实用户复测，第5展示部分，第1统一入口/局外UI未接；个人6只取舍/蛋/v6-v7/pending、券和同时全灭未确认规则保留。

本片发现的BerryPhase阻断仍存在于未接持有物机制：合法普通战斗可能安全停止候选并显示RUNNER_FAILED。现有较强攻击的自然路线通过不能覆盖所有合法行动。下一独立片优先原持有物/树果生产链及恢复，把实验persistent/berry接缝迁到完整原类；复杂成长、局外UI、M6、特殊遭遇和部署继续拆分，不在本片扩实现。完整下一批任务书只本地准备，用户再授权才启动。

## 最终交付

A5c0529cb7a71130af1223f9f66271d11ed62998c；Bfe8c22a7457d4cebb1777bb4a246f06cee61a143；旧奖金WS断言修订及最终源码/测试ca524be6a8ae42368cd883bb1b7c5c1cc257f670。A权威常用消耗品/购物/重抽和B原UI控制器/金额/页内完成的有限自动验收通过；真实双浏览器未执行，展示、树果、一般持久/复杂成长及完整MVP继续部分完成。

仅本地分段提交，SPEC及全部AGENT/PROMPT、日志/构建/真实资料不纳入提交。最终文档HEAD、Git状态、实时远端和日志SHA256记录在ignored build/vs02b17/final-evidence.json及本地恢复说明；完整日志full-final-owned.tap/exit、失败full-owned.tap/exit、运行源码清单均保留。未合并/未推送。下一片18完整本地任务书已备，不在本片实施。

收尾main/origin/main及只读实时远端main仍86798227ca995c4ff40043b99a0c6846ed177154，单一worktree。17个明确范围文件（12源码/测试、5工程文档）的私钥/常见token/URL内凭据模式扫描无匹配，空白检查通过；这是有限模式检查，不作绝对隐私保证。工程文档的186处本地链接检查无缺失。
