# VS-02B-16：原选队实时草稿与共享14点同步

2026-10-23。用户明确要求继续实施16；本片只完成原公共选队的实时草稿、权威预算和最终准备。用户询问道具、商店及局外UI后已说明：下一片优先整备金钱/道具/购买重抽闭环，局外统一入口和收藏/蛋/券UI另片；本次不顺带实现。

## 起点与交付

起点7c26f53ba272cbf0474bbf0758a577016bbbec4d，源码3bd44da5。开工工作区干净、单worktree，未发现其他活跃项目开发；main/origin/main及开工只读实时远端main均86798227ca995c4ff40043b99a0c6846ed177154。仅early，没有创建/联系agent、合并或推送。

分支feature/vs02b16-live-draft。A为34c28d81，B/最终源码测试为c7495a3471357bd492956df4ae5fd53fea1f66f9。

## 复用与必要适配

- 原StarterSelectUiHandler的正常增选、popStarter、setSpeciesDetails、原确认/取消和配招回调不替换。新增可选onChange与恢复starters端口，提取原最终选择采集为selectedStarters；没有合作参数的单人仍用原模式和启动回调。清理菜单不发空草稿，真实删除到空才发。形态/性格/招式在原详情更新结束后采集，签名不变不重复通知。恢复时仍调用原详情/默认配招端口，使用原图标和网格位置。
- 原captureProfile/validateProfile/priceProfile共用内部选择验证，新增显式Draft包装仅允许编辑中0–6只；原最终入口仍1–6只，不补默认队伍。原GameData.getSpeciesStarterValue成本和分数折扣、所选解锁/IV/蛋招/配招验证均保留。不重写成本公式或消费战斗RNG。
- 原profile lobby、normalizeProfileAction、budgetOf、原Worker及FormalRoomStore继续处理所有权、run/revision/decision/actionId、候选先落盘后发布。没有另建房间、预算或ACK系统。
- 原play-phase消息串行、consumer真实模型apply→capture→ACK、IndexedDB outbox与14会话归属/主动暂停继续使用。新草稿队列只合并未发送的选择；已持久消息不改内容/ID，不重定位到新revision。

## A：权威草稿与持久化

新增profile-draft意图，仍是严格kind/profile/ready字段，ready必须false。每席只保存一份当前profile/priced，编辑状态附selectionState=draft，所以不重复计费。共享只公开每席选定speciesId/formIndex/原cost、个人总额、编辑/准备状态；不公开trainer/secret、完整dex/IV、解锁、配招、蛋、seed/RNG或未选收藏。

每次候选替换本人选择后校验个人10/共享14。并发同revision由正式房间串行处理；一方先提交后另一方可能收到STALE_DECISION/SYNC_BLOCKED，重新取得权威状态后超额明确SHARED_BUDGET_EXCEEDED。拒绝不改变对方、已接受草稿、战斗RNG或价格。

profile-ready最终准备须非空且与已接受草稿完全相同。已ready不能直接发草稿，也不能在unready请求里偷换队伍；先以原profile取消准备，再编辑。仍兼容无selectionState的旧format3及旧直接profile-ready入口；新字段只在lobby envelope，不升级或清空v6/v7蛋和战斗检查点。旧battle和无草稿大厅恢复继续走原校验。

真实磁盘测试证明：结果写盘失败不广播新预算/预览；旧checkpoint和已接输入保留，服务重启、双方真实模型ACK后精确执行一次。原回执重放/异内容actionId拒绝、旧ACK、两房间和个人私有投影已覆盖。

## B：原菜单持续编辑与反馈

原增删和详情变化触发草稿；公共DOM持续显示双方权威选定精灵/成本、个人已用和共享剩余，后台快照不会关闭/重开正在编辑的Starter，也不会覆盖脏的本地选择。区分待同步、已接受、被拒绝；预算或存储失败保留本地选择，改选或显式重试恢复。

过期草稿只在请求快照并收到同步后最多自动重试一次，使用新actionId；历史已发送消息保持不变。预算拒绝和本地写盘失败停止自动重发，不形成状态通知循环。最终原确认先等待精确草稿被接受，再提交ready；DOM准备按钮不能绕过仍打开的原确认，空队不能准备。

选队开关复用原Mode转场并串行等待：取消淡出未结束时重开须等待；菜单epoch使同房间旧onChange/确认/取消失效，开菜单失败先回MESSAGE后允许重试。退出/断线沿原生命周期和14独立出口隔离，迟到回调不保存/发旧草稿、不激活旧会话；不转移旧房outbox。

## 验证与失败历史

证据只放ignored build/vs02b16/。所有runtime重建串行。

- target-a：13项、12通过/1失败、退出1。测试误用必须返回true的applyAndAck助手处理旧快照，原consumer正确返回false；改为断言false并直接发送旧ACK。target-a-final为13/13、退出0、22484.5423ms。
- ui-first：80项、79通过/1失败、退出1。旧Party测试仅等两次tick，尚未完成真实IDB写盘就读sent；改为等待原选择回调实际Promise，断言不变。
- ui-second：85项、83通过/2失败、退出1。合成测试给小火龙硬塞撞击被原合法配招校验拒绝，改用原默认配招；空队准备测试需先退出原菜单，再验证空队拒绝，不能绕过新增确认门控。
- ui-ws-first：89/89、退出0、29854.6148ms，含两个席位的原Starter回调→真实IDB/双WS/profile Worker/原模型ACK→入战→双方FIGHT；渲染/资源为明确headless端口，不是浏览器视觉证据。
- target-before-selector-fence：112项、110通过/2失败、退出1。旧outbox用无starters的synthetic profile，被新增非空门控挡住；改用真实合法profile，保留原outbox/写盘故障断言。
- target-final：113/113、退出0、65279.6761ms，为中间补查；最后再增加选队打开失败恢复测试并冻结最终源码，不拿中间结果替代最终运行。
- 最终冻结源码c7495a34：target-owned为114/114、退出0、65178.933ms（原捕获7/profile4/原UI90/UI-WS4/profile大厅9）；typecheck-owned/runtime-owned/build-owned均退出0，Vite显示1m3s，仅既有mixed-import/chunk警告。运行清单为final-source-head.txt和final-source-blobs.txt，源码/测试比较0差异。完整串行1133/1133、退出0，1190092.7004ms（约19分50秒），fail/cancelled/skipped/todo均0，不沿用15的1117作为本版通过。

## 结论与边界

A权威草稿/预算/持久恢复和B原UI通知/队列/菜单隔离的有限自动验收通过，完整回归以本节收尾结果为准。真实双浏览器/跨设备未执行，第2项仍待用户按[手测清单](vs02b16-manual-acceptance.md)确认。14退出和15捕获原次故障的浏览器证据仍缺；第5展示仍部分，不能据此写成完整MVP通过。

仍无账号认证，原导入profile校验不能证明客户端记录来自真实存档，不作防作弊保证。仅服务器已接收的草稿可跨刷新恢复；还没发送/没写盘的本地编辑不承诺刷新保存。已接受草稿可在大厅点击重新选队恢复到原菜单，不强制自动开菜单。

道具/商店下一独立片准备任务书，本片不实施；局外统一入口/收藏/蛋/券UI尚未完整适配。券和同时全灭未定规则、个人蛋/pending及每人6只取舍不改变。SPEC和全部AGENT/PROMPT本地忽略，工程记录显式清单提交，不提交日志、构建、真实资料/房间/凭据。未合并、未推送。

## 收尾核对

最终单次完整日志full-owned.tap及退出文件完整保留，1..1133；运行源码c7495a3471357bd492956df4ae5fd53fea1f66f9，最终src/server/tests/scripts与package/入口文件blob清单比较0差异。16个明确范围文件（11源码/测试、5工程文档）的私钥/常见token/URL内凭据模式未发现匹配；空白检查通过，不作绝对隐私保证。SPEC及全部AGENT/PROMPT/日志/构建仍本地忽略。main/origin/main及收尾只读实时远端main仍86798227ca995c4ff40043b99a0c6846ed177154，单一worktree，无合并/推送。最终工程文档HEAD与干净状态见实际Git及本地恢复说明。
