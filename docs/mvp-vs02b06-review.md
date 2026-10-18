# VS-02B-06 维护者审查（2026-10-19）

交付基线 `807960a0b421cb0ca9bcdaa9293c67eeea8a4864`，交付 A `e844e8d220aa0a0fe43bbf8d1f2e5dd45a588bcb`、B `52d94c5542e1b73117c34d52e0f934498a8c506a`。维护者在独立本地分支 `review/vs02b06-rewards-fix` 修复。接手工作区干净，两个提交直接相依，未发现夹带冻结 fixture、skip 或内部任务书；实时远端 main 与本地 main 均为 `871c5f183118ad0dea5eb4694ae4f94de6f68d87`。最终提交／发布引用以本次收尾记录和 Git 为准。

## 判定与证据边界

A：原球补给及本人 Potion 的 Worker、正式双 WS、FormalRoomStore 故障／重启／去重切片已复验。B：球奖励已完成真实双浏览器领取及后续 FIGHT；Potion 原 Party 目标交互尚无真实浏览器证据，B 整体仍为部分通过。用户后续明确浏览器测试可交由本人执行，维护者停止继续浏览器操作；不把缺少的治疗 UI 结果改写为通过。

原交付 983/983 TAP 和退出码 0 已独立核对，A 测试 blob 与交付提交一致。执行元数据仅记录 A 测试 blob，未证明当时全部 B 工作树与最终提交一致；本次修复后另行固定全部变更源码／测试 blob 并执行完整回归，不沿用 983。

## 维护者修复与复用

1. `PokemonReviveModifierType` 继承 HP 恢复类型，交付实际放行 REVIVE，与报告“明确拒绝”不符。服务端纯校验及 UI 显式排除复活类型，执行端保留 fainted 防线；未扩支持范围。
2. 效果端不再自行选目标直接 `apply([target, 1])`：复用原 `BattleScene.addModifier`，保留原 `shouldApply`、个人 HealingBooster 路径、原 Modifier.apply 与更新 Promise。原场景规则任务观察器等待原 Party 回调微任务及效果收尾后才允许捕获候选；补显示用无声端口，不重写数值公式。个人 modifiers 空断言保持。
3. 原 PartySlot 需要 `currentBattle.getBattlerCount()`，合作展示对象没有该方法。仅菜单期间创建个人展示视图，1 个前场加本人后备，退出恢复原公开双打展示；合作权威战斗始终双打。
4. Party 使用原 Pokemon codec 的展示副本，不再给 consumer 已核验模型直接挂真实 scene。取消可回原奖励菜单；断线、blocked、换快照、销毁和 DOM 跳过会清理临时视图；旧目标回调失效，异步切换后重检 snapshot／epoch，写盘失败可重选。
5. 球类型改用稳定 catalogId 与原 Modifier 实例判断。审查初期曾怀疑类名会被压缩，但构建已有 `keepNames: true`，并未复现该问题；此项只算加固。修正支持奖励的过时提示文字。

仍复用原 `SelectModifierPhase.createModifierSelectCallback`、`ModifierSelectUiHandler`、`PartyUiHandler`、Modifier/Pokemon 方法、既有 effect runner／codec／observer、M1/M2 outbox／receipt／ACK／候选落盘。没有引入 tests helper 到生产、清空蛋、删除 modifiers 断言或改变单人原方法。

## 真实浏览器已达到的步骤

正式静态 build、`server/start.mjs`、`COOP_PROFILE_LOBBY=1`；8042 独立服务，ignored 独立测试目录。Chrome 与应用内浏览器，分别原选队妙蛙种子＋小火龙、杰尼龟，共 9/14 点。真实三回合胜利到 preparation revision 5，双方真实菜单抽到 POKEBALL／RARE_CANDY／NUGGET。

- Chrome 原确认领取球：revision 5→6，本人球 5→10，伙伴仍为 5；只有本人 rewardResolved=true。
- 应用内浏览器原确认领取：revision 6→7，双方球各 10，双方 rewardResolved=true。
- 同目录关闭服务与 Worker 后重启，两端刷新。恢复后球数各 10，无重复授予；房间中随后记录双方 ready 并进入原下一战。维护者实际点击保持当前出场者，然后两端通过原 Command/Fight/Target 共同完成第二战 FIGHT，revision 10→11，再到合法下一输入。双方出招均为真实浏览器动作，未注入 action／checkpoint 或修改模型。
- 第二战该回合妙蛙种子首招 ppUsed 3→4，备用小火龙保持 0；杰尼龟选择的目标已先倒下，原目标规则取消出招，ppUsed 保持 2，不伪称双方必定各扣 PP。两端公开 HP 与权威终态对照。之后继续的实际战斗另到 revision 12，不替代已保存的 revision 10／11 对照。
- 再以 `127.0.0.1` 独立来源真实新局，原选队小火龙＋妙蛙种子、杰尼龟，三回合胜利；抽到 TM_COMMON／RARE_CANDY／POKEBALL，没有抽到 Potion。两端点击 TM 后明确提示不支持，revision 保持 5、未授予。该新局不计作治疗 UI 成功。来源改变隔离资料，未覆盖已有 localhost 存档。

应用内窗口失焦时原 reveal 动画明显变慢，激活后继续；未跳动画或重启规则阶段。仍为同机两浏览器，不是跨物理设备。

最小证据在 ignored `build/vs02b06-review/`：`browser-before-reward.json`、`browser-after-a-reward.json`、`browser-both-rewards.json`、`second-before.json`／`second-after.json`、两端原战斗截图。实际房间与凭据不提交。

## 自动验证

- 新增正式双 WS／FormalRoomStore 测试 2/2 通过：GREAT_BALL 与 POTION 分别验证候选落盘失败保持旧 checkpoint／RNG、已收输入保留、重新同步 ACK 后单次结算、客户端真实模型 apply→capture→ACK、同目录服务和原 Worker 重启、旧 actionId 原回执及不重授予、另一房间隔离。使用现有原 adapter 测试 provision 队伍／种子，不把它当生产 profile lobby 或浏览器证据。
- 原 Worker＋UI 定向曾 31/31 通过，随后新增 DOM 跳过清理用例，最终以本次完整串行回归为准；不拼接定向运行计数。
- 最终 typecheck 退出 0，生产 build 退出 0（1m2s，既有混合导入／大包提示）。
- 最终完整串行回归：**992/992，退出 0**，正常 `1..992` 收尾，fail／cancelled／skipped／todo 均为 0；1053058.5728ms（约17分33秒）。运行时 HEAD 为 `52d94c5542e1b73117c34d52e0f934498a8c506a`，维护者修复在工作树；`execution-meta-final.json` 固定6个源码／测试 blob，与最终提交逐项核对。本轮定向2/2退出0，用时19368.9024ms；不拼接早期失败／中止运行。
- 首次 WS 沙箱 EACCES 为环境失败，允许本机回环后重跑；早期目标测试错误、补齐 sound 端口前原 addModifier 失败以及主动中止的完整运行均保留为历史，不计入最终通过。原新增 Worker 文件导入了 build 方法却未调用，本次加 before 构建，避免单独执行时复用旧 bundle。

## 下一批与长期缺口

用户要求下一批优先改善文字适配与 UI，复用源项目最近几个版本的既有方案，不从零另造一套界面。见 `docs/coop-ui-text-next-plan.md`；具体本地提示词不提交。Potion 实际目标选择、取消重选、本人 HP 变化和刷新恢复仍交用户实际测试。未支持奖励、购物／重抽／成长、捕获、主动换人、本局备用／战后换队保留为缺口，不据此宣布完整 M3、M4/M5、M6 或 MVP 上线。

此次用户已授权收尾后推送。发布必须从实时 main 建立干净父提交、仅转入明确审查文件的最终树；不直接合并含内部文档的旧评审历史，不强推，不提交 SPEC／AGENT／PROMPT、存档、凭据、依赖、build／dist／日志／截图。

提交范围检查：明确审查本批11个源码／测试／工程文档文件；公开整理相对 main 共50个文件。未纳入 SPEC、AGENT／PROMPT、存档／房间、依赖、build／dist、日志或截图；指定私钥／GitHub token／API key／AWS key／Bearer 模式未命中，空白检查通过。这只覆盖本次范围及所列模式，不是全历史或绝对隐私保证。
