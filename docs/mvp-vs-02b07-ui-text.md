# VS-02B-07：文字基础与合作入口 UI

日期：2026-10-19。基线：`86798227ca995c4ff40043b99a0c6846ed177154`（本地 main／实时 origin/main）。本批只做文字和 UI，不扩玩法；浏览器验收**交用户执行**，以下未标注的用户结果均为“待用户验收”。

## 来源与许可证

只读参考官方 `pagefaultgames/pokerogue`（AGPL-3.0；early 自身许可证同为 AGPL-3.0）：

| SHA | 日期 | 路径 | 选择原因 |
|---|---|---|---|
| `6d9c6b425d9a99a714b43f2dbe762f9a66c9236c` | 2026-10-11 | `src/ui/text.ts`, `src/ui/handlers/message-ui-handler.ts` | 最近一次文字换行修复：Ideographic Space／ZWSP 与消息窗口 |
| `1c1d63a50f00630e506f447aece8e6d55a185346` | 2026-10-02 | `src/ui/handlers/message-ui-handler.ts` | 最近消息窗口结构／说话者变化前基线 |
| `1174d9f35f…` | 2026-08-05 | early 可见上游基点 | early 当前固定版本的来源边界，未把它称“官方最新” |

只读源目录 `E:\pokeregue\pokerogue` HEAD `d95670171eb71143c1385222c95be97271944baf`；工作树含个人联机修改和 Party 修改，本批只读取 HEAD 的 `src/ui/text.ts` 与语言资源，不复制其未提交 Party 代码。参考原文只写入 ignored `build/ref-*`，未提交。

未整套引入新版 `globalScene`、PhaseManager、设置管理器、现代规则或依赖；新版 `TextStyle` 数值/枚举与 early 不同，不能直接替换。

## A：文字基础

文件：`src/ui/text.ts`（提交 `03264b78fc2d661e1545cb4e7faf0615cd78f41a`）

- 复用新版按 `resolvedLanguage` 和场景配置字号／padding／阴影／行距的方法，但继续使用 early 的 TextStyle、颜色、6 倍画布和原字体资源。
- 简体中文／日文：
  - 字体回退 `emerald` → `Noto Sans SC`／`Microsoft YaHei`／sans-serif；Party 使用 `pkmnems` 同样回退，避免中文落到不可控字体。
  - MESSAGE／WINDOW／SUMMARY 96→88px；BATTLE_INFO 72→68px；PARTY 66→62px；TOOLTIP 64→60px。
  - 阴影默认 6→4.5，窗口/消息 3.5，Party 3.5；底部 padding 6→8。
  - 行距 5→6（BBCode 10→8）；用 `resolvedLanguage` 启用 advanced wrap，长中文/中英混排按字符断行。
- 英文保持原字号与字体，仅阴影默认略降；不改变原 UI 颜色、布局容器或操作语义。
- 新增 `setTextStyle` 供既有文本对象按同一规则重设；不改权威状态、codec、RNG、物种/招式 ID。
- 奖励名称/描述使用现有 `modifier-type` 本地化，不把新版数值文案套到 early；本批没有改写 early 规则文案。

实际检查：`npm run typecheck` 退出 0；生产 build 退出 0（约 1m17s，既有 chunk 警告）。未添加镜像样式测试。

## B：合作入口布局

文件：`coop-play.html`（提交 `0104af0c`）

- 顶部状态改为单行低高度 flex bar：标题、房间/状态、预算、按钮自动换行；字体 12px、按钮 22px 高、阴影和留白收敛。
- 房间码、席位、共享/个人点数、准备/取消准备、错误仍可见；未暴露 revision/Worker/ACK 实现细节。
- 窄视窗（≤820px）进一步缩小间距和字号，面板 `max-width:100%`，不固定画布尺寸；原 canvas 占剩余高度。
- 原桌面控制按钮压缩；`/`、`/coop.html`、`/coop-play.html` 仍独立，单人文本样式仅受 A 的语言/度量规则影响，不接入合作状态。

## 自动验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 退出 0 |
| `npm run build` | 退出 0，约 1m17s |
| 权威/codec/输入回归 | 本批未改这些路径，未跑完整回归；沿用上一验收基线，不把旧计数写成新结果 |

## 用户浏览器验收清单（待用户执行）

1. `npm run build`。
2. PowerShell：
   ```powershell
   $env:COOP_PROFILE_LOBBY='1'
   $env:COOP_DIST='dist'
   $env:COOP_FORMAL_DATA='build/user-vs02b07-rooms'
   $env:PORT='8043'
   node server/start.mjs
   ```
3. 两个独立浏览器/profile 打开 `http://127.0.0.1:8043/coop-play.html`，不要用同一浏览器两个普通标签页冒充独立存储。
4. 中文与英文：先在各浏览器现有语言偏好中切换；检查原消息窗口、Command/Fight/Target、选队、整备、Party、BattleInfo 中文字体不再发虚、阴影不过重、长名称/长描述不裁切，中英混排行距可读。
5. 检查房间码/状态/准备按钮不遮挡原画面；把窗口缩窄到约 800px，确认按钮仍可点、文字仍可见。
6. Potion 目标链：进入整备，选择 Potion，打开原 Party；取消目标应回原奖励菜单，再选本人目标；确认本人 HP 实际变化、伙伴 HP 不变。
7. 刷新一端：席位恢复、已领取奖励不重复、prepare/ready 状态正确；双方准备后下一战继续，双方原 UI FIGHT 产生新 revision。
8. 记录任何中文截断/错位/字体异常的具体界面与窗口尺寸；未实际执行的项目保持“待用户验收”。

## 剩余缺口

- 未改购物/重抽/成长/捕获/主动换人/本局备用/战后换队。
- 未在真实浏览器执行本批视觉检查；用户测试前不宣称通过。
- 新版消息窗口的说话者框、特殊空格换行完整回调未整套移植；本批只用语言/度量/advanced wrap。
- 未新增跨设备/移动端支持声明。
