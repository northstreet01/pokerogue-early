# VS-02B-08 维护者验收

日期：2026-10-20。结论：**A 普通主动换人的有限生产切片通过自动验收；B 原 Party 接线部分通过，双浏览器仍待用户。** 修复后完整串行1006/1006、退出0，不把旧1000项列为新结果。不代表B或全机制／MVP上线通过。

## Git 与交付核对

开始时 HEAD `693638026b0241583c73a506801482a7b9f5257c`、分支 `feature/vs02b08-active-switch`、工作区干净，只有本目录一个 worktree。A `0ddbd323`、B `8ffcd9d9`、文档 `3da1d43f`／`69363802` 连续依赖于 `6ff2fc4adc576033df896cb14d6aa9c525662e88`。实际13文件，未发现无关功能。原有“所有option均为当前出场者”断言改为排除switch符合新增目标语义；没有删除整个用例、skip或修改冻结原规则fixture。

本地 main／origin/main 及重新查询的实时远端均为 `86798227ca995c4ff40043b99a0c6846ed177154`。维护者创建本地 `review/vs02b08-active-switch-fix` 修复，未重置或清理他人工作，未修改只读源项目。未合并、未推送。

交付最终日志 `build/vs02b08/full-final.tap` 正常 `1..1000`、通过1000、失败／取消／跳过／todo均0，退出0，1595758.506ms。元数据对应8ffcd9d9；到69363802的src／server／tests无差异。该证据只属于原交付。

## 发现与直接修复

### 1. 插入特性阶段后另一席换错后备

原TurnStart用共享party游标生成SwitchSummon；交付在execute里根据尚未丢弃的inputs临时换算，并在submit里提前执行少数阶段。第二席先换入威吓宝可梦后插入ShowAbility／StatChange，循环退出，后续运行／恢复没有inputs，另一席使用错误游标，选择结果与意图不一致。已用真实Worker及原威吓复现。

改在原换人Phase从root scene入队绑定个人scope时，将其slotIndex解析到所属个人party；在任何checkpoint之前完成，重启不依赖外部临时输入。撤掉提前执行换人链的特殊循环。继续调用原CommandPhase.handleCommand、TurnStartPhase、SwitchSummonPhase.switchAndSummon、Summon／PostSummon和原sync，不手写交换、HP、PP、优先级或特性效果。

新增双方同轮换人、第二席入场威吓、每个排队阶段换新Worker恢复与连续执行的完整状态差分；只忽略本来不具规则语义的decision/phase编号，队伍、场位、效果、资源和RNG全部比较。

### 2. Party回调跨await提交旧目标

原回调只在Mode.MESSAGE之前检查snapshot／epoch。异步界面切换期间版本变化后，sendAction会读取最新信封，将旧目标提交到新决策。现于await之后再次检查原snapshot身份、epoch和输入门控。回归覆盖revision／epoch各自改变，不发送任何旧动作。

保留codec副本、取消恢复Command、写盘失败重选、拒绝回执重开菜单；sendAction也清理活动换人视图。自动测试核对源模型未被菜单修改。

### 3. 原Party菜单泄露本地操作

SWITCH默认包含放生、恢复进化、可能的Baton Pass。个人展示副本不能把这些操作变成已接入的联机功能。为原PartyUiHandler增加末尾可选allowedOptions配置：合作主动换人仅SEND_OUT、SUMMARY及CANCEL；默认未配置仍使用单人原菜单。显示过滤和实际输入均检查，clear清除临时配置，callback还必须匹配SEND_OUT。UI fixture仅增加真实Party类／枚举导出，没有改写原规则fixture。

### 4. 换人后胜利卡在备用参战者经验条

真实Worker换人后继续普通攻击获胜，可复现UNSUPPORTED_NATIVE_ENTRY_PHASE。退场但参战过的成员走原ShowPartyExpBarPhase，原交付没有native端口。

添加ShowPartyExpBarPhase／HidePartyExpBarPhase支持，复用原Pokemon.addExp、个人ExpBooster、原LevelUp排队；仅提供partyExpBar显示端口并等待原500ms结束计时，未跳过规则阶段或重写经验公式。已有codec已支持这两个Phase，无schema放宽。新增实际战斗获胜、退场者经验增加、Show／Hide阶段发生及到达原SelectModifier边界的回归。更复杂学招／进化子决策仍是现存缺口，本次不宣称全部成长已接。

### 5. 主动换人的磁盘证据缺失

原新增WS成功用例没有传store，实际是MemoryStore；原报告的FormalRoomStore说法不成立，已在原记录追加更正。新增真实FormalRoomStore用例，验证：

- 单方switch输入落盘后关服务／Worker，在同目录重新启动并由另一席FIGHT补齐。
- 候选revision落盘失败保留原checkpoint及双方inputs，不广播未提交结果；重试只执行一次。
- 正常落盘后再次同目录重启，两席模型哈希一致，退场者PP不变、伙伴场位保持。
- 重复actionId返回原回执，同ID异内容拒绝，inputs清空且checkpoint不重复变化。
- 第二房间的checkpoint在故障、重试及重启全过程保持一致。

## 验证

最终定向命令：

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core-active-switch.test.mjs tests/coop-play-entry.test.mjs tests/coop-original-bridge-vs01.test.mjs
```

- 最终定向：退出0，正常1..51，51通过，失败／取消／跳过／todo均0，53721.323ms。
- typecheck：退出0。
- build:coop-runtime：退出0；专项WS用例也重新构建正式运行包。
- 生产build：退出0，1m34s，既有chunk警告。
- 完整串行回归：退出0，正常1..1006，1006通过，失败／取消／跳过／todo均0，1028492.7826ms（约17分8秒）。命令为 `node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs`。
- 浏览器：本次未执行，交用户验收；不以端口测试或真实WS替代原画面测试。

证据目录为ignored `build/vs02b08-review/`。保留修复前失败复现，以及第一次定向的沙箱EACCES（13个WS连接失败）；随后在允许本地网络的环境完整重跑51项通过。这些失败不能冒充最终通过。初次新增测试中的冻结storage替身赋值错误也已修正后重跑，未掩盖生产问题。

最终源码／测试blob在完整回归启动前记录为verified-blobs.txt，提交后逐一核对；具体最终评审SHA以维护者交付为准。

采用11个明确文件路径暂存；SPEC与AGENT提示词已核对ignored且未被跟踪。空白检查及本批凭据模式扫描没有匹配问题；这仅覆盖本批差异，不是绝对隐私保证。

## 用户待测与下一批

按[原操作清单](mvp-vs-02b08-active-switch.md#用户浏览器验收清单待用户执行)验收取消／重选、只显示本人队伍、两席同轮换人、伙伴FIGHT、刷新／重启和后续战斗。增加菜单无放生等未接操作、威吓插队后仍选对后备、胜利给退场参战者经验。Potion原Party和VS-02B-07视觉项目仍待用户，不改写历史状态。

下一批建议只做普通捕获→捕获者本局备用持久化→原BALL输入的一个纵向切片，分A真实Worker／正式事务、B原UI；战后换队另批，不能因此从MVP删除。优先复用early原AttemptCapturePhase、捕获公式／RNG和既有owner／reserve／codec，不引入现代规则或手写捕获结算。任务书本地保存在docs/AGENT-VS-02B-09-PROMPT.md。

本片不覆盖Baton Pass、全部特殊进退场机制、完整成长、购物／重抽、捕获、战后换队、永久收藏M6、跨物理设备、移动端或上线容量。维护者修复与验收结束后停止，不承担下一整批。
