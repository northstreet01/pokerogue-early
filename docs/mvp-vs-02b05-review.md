# VS-02B-05 维护者审查与修复

基线 `2b7c87f3889ff14f4d02417631a8c9ce427fc4fb`，评审分支 `review/vs02b05-preparation-fix`。原交付未完成浏览器验收、未跑完整回归的记录保留，不以历史 970 项替代当前结果。未合并或推送 main；SPEC 与任务提示词只保留在本地。

只读实时远端 `ls-remote origin refs/heads/main` 为 `871c5f183118ad0dea5eb4694ae4f94de6f68d87`，与本地 main 一致。此次是评审分支修复，不把包含内部历史的评审分支直接合并到公开 main。

## 纠错与复用

- 继续直接调用原 `ModifierSelectUiHandler`、`restoreModifierTypeState`、Command／Fight／Target、原 Worker NewBattle／Encounter。服务器已抽出的奖励只恢复为原类型展示，不在浏览器重抽、计价或应用效果。
- 原奖励菜单新增可选第五个展示参数，合作页关闭本地商店生成、重抽和转移；单人四参数调用保留。删除合作页临时克隆／修改 gameMode 的办法，避免展示适配污染原场景模型。
- 原菜单的延迟动画／教程回调加入展示代次核对，clear 后旧回调不重新激活菜单。原 CANCEL 回调返回 false 时保留输入能力，支持提交未完成或失败后重试。
- 整备和战前保持按钮绑定原 snapshot／epoch；不能把旧按钮动作改投到新 decision。准备须先处理奖励；奖励已处理时不重新打开旧菜单，已准备的一席仍能取消准备。
- blocked／ACK 恢复、拒绝回执、旧回执与 IndexedDB 写入失败统一按当前 decision 重开正确菜单；写入失败不误称已跳过奖励。已核验的重复快照保留当前菜单绑定，不清除控制按钮后又被缓存签名阻止重建。
- 浏览器发现原 shader 读取本地新场景的 waveCycleOffset，导致双方／刷新后昼夜色调不同。shared 投影补公开昼夜周期偏移，展示复制权威 offset 和 biome，再由原 arena／shader 计算光照；不调用 setBiome 的装饰随机，也不下发种子或 RNG 状态。偏移属于可见昼夜时间表，完整检查点仍不下发。

## 浏览器验收过程

使用正式静态 build 和 `server/start.mjs`，`COOP_PROFILE_LOBBY=1`，独立端口与 ignored 测试房间目录；Chrome 与应用内浏览器隔离存储。通过真实按钮操作原 StarterSelect，分别选择妙蛙种子＋小火龙、杰尼龟，总计 9/14 点，不修改模型、不注入战斗动作。

首战双方两轮真实 FIGHT 后共同进入 preparation（revision 4）；两席原奖励菜单各展示自己的服务器奖励。整备期间刷新一端并恢复原菜单；普通奖励点击明确拒绝。分别通过 DOM 跳过按钮与原 CANCEL 跳过，准备→取消准备→重新准备，双方准备后由原 NewBattle 到第二战 switch-confirm。保持当前出场者后进入真实第二战行动输入。

最终构建完成后，关闭本批 8041 服务及原 Worker，在同一测试目录重启；两浏览器刷新恢复第二战 revision 11，原 Command／Fight／Target 提交双方 FIGHT 后共同到 revision 12／波次 2／回合 2。两名出场者首招 ppUsed 均为 2→3，备用仍为 0；妙蛙种子 HP 16→6、杰尼龟 19→19、敌方圆法师 15→1、大牙狸 16→16，与双方画面一致。两端光照一致，不再随各自新场景偏移变化。此为同机不同浏览器验证，未冒充第二台物理设备。

截图仅本地：`build/vs02b05-review/preparation-resumed.png`、`second-battle-a.png`、`second-battle-b.png`；最小 HP／PP 对照在 `second-before.json`／`second-after.json`。房间、令牌、浏览器个人资料不提交。

初次加载曾暂时出现黑色 canvas，随后资源和原网格正常出现；未取得原交付 Edge headless 黑屏的确定根因，不能把本次浏览器成功写成修好了所有 headless／设备问题。

## 验证

- 最终 UI／真实双 WS 定向：32/32，退出 0，29193.3662ms；含新增 9 项菜单／回执／展示保护测试，旧入口和真实桥接仍通过。
- 最终 `npm run typecheck` 退出 0，`npm run build` 退出 0（1m31s，仅原有 chunk／混合导入提示）。
- 完整串行回归：979/979，退出 0，正常 `1..979` 收尾，fail／cancelled／skipped／todo 均为 0；985029.8187ms（约 16m25s）。首次运行因修复拒绝回执及昼夜展示而主动中止，`full-interrupted.tap` 不计作最终通过；定向初次沙箱内 WS EACCES 属环境失败，允许本机回环后完整重跑定向通过。
- 运行证据位于 ignored `build/vs02b05-review/`，最终源码／测试 blob 记录于 `execution-meta-final.json`。不提交测试房间、恢复令牌、截图或日志。

## 仍未完成

本片仅打通跳过奖励／准备／取消准备及保持前场的普通连续分支。普通奖励效果、购物／重抽、成长子决策的正式 UI 端口仍未接；捕获、主动换人、本局备用和战后换队仍是 MVP 必需项，不能删出范围。战斗消息动画／状态显示与任意 seed、特殊机制、跨设备、移动端性能仍需验收；不是完整 M3 或 MVP 上线通过。

原奖励展示仍有 reveal／输入延迟；新 revision 重新展示时可能再次等待动画。服务器不会重抽或重复授予，但这不等于整备交互时延已优化。后续可减少无关的个人菜单重绘，不能绕过权威 ACK 或重新 start 原规则阶段。

下一批先复用已有原整备效果端口补普通奖励及个人成长决策，再接主动换人和捕获／本局备用，并持续以真实双浏览器闭环验收。永久收藏／孵化事务继续遵守 M6，个人蛋不清空、不消费以绕过边界；券与同回合全倒下顺序仍待用户确认。
