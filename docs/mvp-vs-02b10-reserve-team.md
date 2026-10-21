# VS-02B-10：备用详情与战后换队（2026-10-21）

**续接状态请先看[六只上限与捕获取舍复验](mvp-vs-02b10-resume-review.md)。以下断电结论及旧无限备用实现保留为历史，不是最新玩法或最终验收。**

## 断电前最新结论：规则已纠正，当前仅部分完成，不能按完整功能验收

用户在本批开发中明确改定：按原版每人最多保留6只；捕获后取舍，不能靠reserve无限积累。以下A／B两个阶段记录属于该纠正之前的实现与测试历史，已被新规则取代；44项UI通过不代表新取舍UI通过，不再派发备用分页／无限仓库方案。

最新修改：未满6只时沿原EnemyPokemon.addToParty直接进入本人party；满6只时暂停原AttemptCapturePhase，新增capture-choice安全边界，选择放弃新捕获或放生本人非前场成员后接纳。复用原PartyUiHandler.doRelease及原捕获后续方法，新增可恢复的finishCatch入口，不能重投球／重跑捕获RNG。已落到原phase／codec／native／正式adapter的路由；个人原reserve-swap生产入口明确拒绝。没有自动删除旧存档reserve：旧规则库存存在时阻止新的捕获并报LEGACY_RESERVE_REQUIRES_REVIEW，后续必须明确迁移取舍，不能静默清空。

最新真实Worker定向4/4、退出0，5464.0506ms，正常1..4，无失败／跳过／取消／todo：不足6只捕获→本人party→下一战实际FIGHT；满6只放弃或原放生后接纳（仍6只）→新成员下一战；非法owner／前场／额外字段／准备绕过／错误scope拒绝；新Worker恢复结果一致；原倒下强制换人恢复。满员测试从真实v2六只选队构造，仅为确定成功而显式合成初始Master Ball库存，不是浏览器证据。typecheck及Worker构建退出0。

第一次新版定向3/4失败于恢复选择后的decisionId追加非数字后缀，导致后续菜单ID不递增；现已改用原native数字序列，第二次4/4通过。早期原放生因headless容器缺少destroy失败，补原显示销毁端口；未替换原party／modifier删除方法。

**未完成且下一次必须优先处理**：新capture-choice的原Confirm／Party RELEASE客户端接线；撤除旧备用分页／换队按钮及相应测试；旧reserve的显式取舍迁移；原捕获／WS套件仍有旧reserve断言需按新规则重写并核对，不可删断言／skip掩盖；新增取舍的正式双WS＋FormalRoomStore失败／重试／重启／去重／隔离；最终完整串行回归；用户双浏览器验收。因此当前不能作为完整A／B、M3或MVP通过，也不应合并发布main。用户要求即将断电，停止功能扩展，保存当前工作并仅推送独立备份评审分支。

最终生产构建、发布SHA与收尾核对在本文件末尾追加。证据仅本地ignored build/vs02b10，旧日志不冒充新结果。

断电前最终检查：新版typecheck退出0，Worker构建退出0，生产build退出0（47.81s，既有chunk警告）。新版Worker最终定向为上述4/4、退出0；完整串行、取舍双WS和浏览器未执行，旧44项UI仅历史。相对公开origin/main扫描51个变更文件的常见凭据模式未命中，tracked无SPEC／任务书／build／dist等禁止路径，diff --check通过；这是本批扫描，不是绝对隐私保证。实时远端main再次确认86798227ca995c4ff40043b99a0c6846ed177154。

本地保留feature/vs02b10-reserve-team完整开发历史；对外保存使用review/vs02b10-poweroff-backup，以实时公开main为单一父提交、内容与本地最终树一致，防止推入旧内部评审历史，不修改main。SPEC与续接任务书仅本地忽略。下一次从本记录最新“部分完成”状态继续，不能从早先A／B通过段落推断已完成。

用户本次明确授权由维护者直接完成第①部分，暂停“只验收其它agent交付”的日常分工。本批只开发队伍闭环，不扩展成长、购物、持有物捕获或M6。

## 起点核对

开始HEAD ef141fe3a1cafe8643d1ac4bc60b1fb0487c292d，review/vs02b09-capture-fix，工作区干净，一个worktree。origin为northstreet01/pokerogue-early；本地main／origin/main和实时ls-remote均86798227ca995c4ff40043b99a0c6846ed177154。创建feature/vs02b10-reserve-team，只在early工作，参考目录未操作；不合并、不推送。

## A：正式权威队伍事务与换人边界

- 复用safe-decisions.mjs已有reserve-swap，不复制一套交换算法。独立验证／事务分流，原奖励PREPARATION_CHANGED_ROSTER断言保持。只允许本人未ready、无个人selection／subdecision／pending growth的整备输入；拒绝额外字段、伙伴／未知ID及交换后本人无存活party成员的不可出场配置。后者是输入可执行性保护，不制定全灭终局顺序。
- 在既有M2交换后保护全部原Pokemon数据、个人双方资源、已抽奖励、pending菜单、蛋和RNG；只允许两个条目的group/index、本席必要field引用和新decisionId变化。
- 替换现前场时将本人field腾空，不把新成员伪装成已经召唤。由下一次原Encounter.end排入原SummonPhase初始化并真正上场。用既有native binding.sync统一party/reserve条目顺序，没有放宽NEXT_BATTLE_PARTY_CHANGED／OWNER等原断言；非前场交换仍保留原当前出场者。个体与ID不丢失、不重建、不回血／补PP。
- 真实FaintPhase排出的modal SwitchPhase改接已有createForcedSwitchDecision／advanceForcedSwitch，经过正式adapter的stage／describe／validate／advance路由；每阶段恢复沿原SwitchSummon／PostSummon，伙伴场位保留。codec补当前强制Switch的scope／isModal／doReturn绑定。没有自行定义无后备或同回合全灭的新胜负顺序。
- reserve-swap事件只投给本人；capture-pending／dex事实保持原owner、个体和pending状态，不调用个人永久saveSystem。

A阶段定向6/6，退出0，22620.9242ms，失败／跳过／取消／todo均0；typecheck和Worker构建退出0。此时生产静态build和完整回归未执行，待B完成后统一验证。真实Worker验证普通球捕获→交换→下一战实际FIGHT、1/6人边界、后备经原战前选择、非法输入、pending growth、非空个人蛋保留、原战斗倒下及逐阶段换新Worker恢复。正式双WS＋FormalRoomStore验证换队候选失败持久化输入→关HTTP服务/Worker→同目录恢复重试→再次重启→去重/冲突/房间隔离→下一战双方FIGHT；另有不改值的自然战斗倒下→强制补位边界重启→本人后备派出→继续FIGHT。均为自动接缝，非双浏览器证据。

调试失败保留于ignored build/vs02b10：先发现条目顺序导致NEXT_BATTLE_PARTY_CHANGED，继而发现新前场未原生召唤导致moveQueue缺失；修正生产接缝，不删除断言。强制补位首轮WS超时暴露遗漏describeDecision路由，随后补齐；合成pending LevelUp测试最初漏必需继承字段，修正夹具声明而非放宽codec。

## B与最终验收

尚待原Party／只读Summary、reserve分页、确认交换、战前/强制补位的原Party选择接线及最终定向／构建／完整回归。浏览器由用户执行，未执行项目不标通过。完成后本记录追加结果，保留阶段历史。

### B实现与阶段验证

已完成原Party／Summary的只读备用入口；每页至多6只，超过6只仅翻页，不扩大本人1–6只随身队伍。整备的“战后换队”选择本人备用→本人现有任意槽位→原确认框→服务器reserve-swap，一换一；不与伙伴交换。未ready、无selection／subdecision时开放，拒绝和IndexedDB写入失败后可重选。

展示复用已有Phaser Container工厂，围绕codec副本调用原init／loadAssets，保留原Summary所需精灵／调色板；不调用Pokemon构造器、不消耗规则RNG、不改核验模型。原Party与Summary增加可选readOnly配置，防止浏览副本时重排招式；单人无参数时维持原功能。原Summary上下切换相邻个体保持只读，原Party退出后恢复公开双打party／battle。加载期间取消／断线／换快照先恢复场景，待原资源回调结束才销毁副本；异步旧入口、旧确认、相同快照重开菜单用菜单epoch失效。原Potion和主动换人也改用这个统一的展示生命周期，继续调用原过滤／稳定ID输入／outbox。

原战前确认／选择及倒下强制补位都接原Confirm／Party，强制Party原Esc与取消槽不退出。正式输入仍由服务器option限定，不在浏览器结算。原UI的明确mode handler访问只增加可选参数，用于摘要覆盖Party时一起清理。

B阶段界面定向44/44、退出0（6846.3201ms），typecheck和build:coop-runtime退出0。测试使用真实控制器／原Party和Summary输入方法，但Phaser资源端口为无画布副本，不能写成浏览器画面通过。早期UI回归先因headless容器不支持真实sprites失败7项，明确注入展示端口后剩1项为旧测试未传原Party的APPLY参数，补全真实回调参数；随后补上并发入口／强制Esc／摘要相邻个体等边界。两个早期typecheck失败均为新增明确mode参数尚未扩展UI.getHandler签名，已修正。日志保留ignored目录，后续最终全套另记。
