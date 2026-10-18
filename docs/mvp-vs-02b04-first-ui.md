# VS-02B-04：原选队与原战斗 UI 首次双浏览器回合

维护者更新：下文为原交付 d4cfa16e 的未完成历史。维护者已修复前端状态／持久重放／原选队接缝，并实际用 Chrome＋应用内浏览器通过原确认框将 1／2 只队伍送入正式首战 wait-actions；刷新恢复通过。定向 24/24、类型／构建通过，完整串行未跑；B 战斗画面与出招端口仍未实现，整个 A/B 未验收。见 [维护者审查](mvp-vs-02b04-review-2026-10-18.md)。

日期：2026-10-18。基线：`90df6818ea6268dfbb3065ad1a3f43f82f1f3287`。本记录只描述实际完成的可审查子集；**本批未达到 A／B 验收，未宣称双浏览器可玩**。

## A. 已实现的可审查子集

- 新增 `coop-play.html` 与 Vite 构建入口；保留 `/` 单人和 `/coop.html` 实验入口。
- `CoopPlayPhase`：
  - 独立页面启动原 `BattleScene`，在 `LoginPhase` 后分流到合作选队，不执行本地 `NewBattle`。
  - 原 `StarterSelectUiHandler` 的实际画面与确认框可打开；选队回调调用 `captureProfile`。
  - DOM 状态层显示房间码、席位、共享 14／个人 10、双方 ready、连接／错误状态。
  - hello／createRoom／joinRoom／profile-ready／resumeSeat 已接正式 WebSocket；URL 从当前 origin 派生 `ws`／`wss`。
  - IndexedDB `coop-play-v1` 保存席位 token 与 action outbox；actionId 在发送前写入，receipt 后删除。
- 生产启动：
  - `COOP_PROFILE_LOBBY=1` 时 `server/start.mjs` 与 Vite 注入 profile 模式适配器，随机 seed 由服务端 `seedFactory` 生成并持久化；未启用时保持原 `ADAPTER_UNAVAILABLE`。
  - 不使用 DEFAULT_FIXTURE 队伍或固定玩家身份；profiles 仍由本人 GameData 导入。
- 修复：
  - 合作页跳过 `rextexteditplugin` 远程加载和单人的 gender／tutorial 分支，避免页面卡在 LoginPhase。
  - 为 headless 浏览器加载使用 autoplay／mute 参数；页面可完成资源加载。

## 实际浏览器证据

使用 Edge headless（CDP，非 Playwright）在本机启动：

```powershell
$env:COOP_PROFILE_LOBBY='1'; npm run start -- --host 127.0.0.1 --port 8020
msedge --headless=new --autoplay-policy=no-user-gesture-required --mute-audio --remote-debugging-port=9222 ...
```

已实际观察：

- `/coop-play.html` 加载完整 Phaser 原画面；合作状态层显示“输入房间码加入，或创建新房间”。
- 点击“创建房间”后正式 service 创建房间（实测房间码 `382453`），收到 revision 0 lobby 快照，页面显示席位、共享 0/14、个人 0/10、准备 0/2。
- 自动进入原 `StarterSelectUiHandler`，看到原图鉴网格、个人已捕获 Bulbasaur、预算 3 和原确认框“使用这些宝可梦开始游戏吗？”。
- 该画面截图在 ignored `build/vs02b04-starter.png`，不提交。

**未完成浏览器验收**：自动键盘／CDP 点击在确认框与选队光标之间未稳定完成“选中→确认→profile-ready→双方 ready”的闭环；一次确认后回调没有产生可提交 profile，未进入正式首战。没有第二个浏览器，也没有双端共同 FIGHT。不能把本记录写成 A 通过。

## B. 未实现

原战斗画面与 Command／Fight／Target 输入端口未实现：没有把本人真实 `PlayerPokemon` 与公开在场对象接入场景、没有队友／敌方展示代理、没有 `CoopInputPort`、没有从服务器 options 生成行动并禁止本地规则链。

原因不是页面打不开，而是需要在原 `BattleScene`／`BattleInfo`／UI handler 上实现完整的可交互战斗场景；本批实际时间已消耗在 A 的原页面启动、remote plugin 加载、单人 LoginPhase 分流和 StarterSelect 确认链，未能进入可验收的 B 代码。B 是后续独立批次，不应把 A 的选队画面当作战斗 UI。

## 验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 退出 0 |
| `npm run build` | 退出 0，约 3m60s（既有 chunk 警告） |
| 后端 profile lobby 定向 | 5/5 通过，约 18.3s |
| 完整串行回归 | **未运行**（本批 UI 未达到验收，B 未实现） |

## 边界

- 无真实账号、无真实个人存档自动读取验收；合成／本机默认资料只用于启动测试。
- 无原战斗 UI、无行动提交、无动画展示队列、无双浏览器 FIGHT、无断线续局验收。
- 未提交截图、存档、token、room 数据；截图仅 ignored build。
- 未合并、未推送。

## 结论

**A 仅完成页面／原 StarterSelect 启动与正式 lobby 的前半段，B 未实现；本批未验收。** 后续需先完成 A 的选队回调／确认链与双浏览器入房，再单独实现 B 的原战斗输入端口。
