# 按键与鼠标输入修订（2026-10-20）

用户要求 WASD 方向、Enter 确认、Esc 取消，并支持鼠标点击选择。起点 `1b071a735c8eb1c062fabe07f2e933ca503f16f4`，最初工作区干净；独立本地分支 `fix/keyboard-mouse-controls`。本地 main／origin/main 与重新查询的实时远端 main 均为 `86798227ca995c4ff40043b99a0c6846ed177154`，未合并、未推送。未改只读源项目。

## 已完成

- 原 setupControls 已有 WASD，但 Enter 同时触发 SUBMIT／ACTION，Esc 原来是 MENU。本次以 WASD 为首选，保留方向键；Enter 仅确认，Esc／Backspace／X 取消，M 菜单，C 独立完成选队，保留空格／Z 确认。更新两个正式游戏 HTML 的按钮提示。
- 复用原 UiHandler、UI.processInput、原光标和各菜单回调。鼠标先选择对应项目，再走原确认入口；没有另造菜单或在浏览器结算合作动作。
- 已接：原选队图标／世代／开始按钮、选项与确认列表、Command、Fight、Target、Party卡片／操作／取消、奖励与商店项目、选球列表，以及等待确认的战斗消息。合作尚未实现的功能仍按原服务端门控拒绝，不因可点击就算功能完成。
- 原 Phaser 对象负责嵌套容器、缩放后的命中坐标。Party卡片绑定真实背景Sprite；重复绑定同一对象会替换旧回调。仅当前活动handler接受点击，遮罩、教程及输入冷却期间拒绝选择；复用键盘的250ms冷却避免快速重复操作。教程仍可使用Enter继续，不宣称全流程纯鼠标可玩。
- 光标滚动箭头只滚动，不确认滚动后的相邻条目。奖励保留原reveal／输入延迟及displayGeneration门控。房间文本输入框聚焦时键盘不同时操作画布。
- 合作继续复用原Command拦截端口、outbox、receipt、ACK和epoch／revision校验；鼠标不绕过这些保护。

## 实际验证

`node --test --test-concurrency=1 --test-reporter=tap tests/coop-controls.test.mjs tests/coop-play-entry.test.mjs tests/localization.test.mjs`：退出0，正常1..43，43通过，失败／取消／跳过／todo均0，15164.645ms。新增五项覆盖真实按键setup与场景分发、文本框隔离、鼠标冷却／活动菜单／遮罩、回调替换与拒绝选择、点击原POKEMON进入合作端口。

typecheck、生产build均退出0；build约2分钟（Vite显示1m60s），既有chunk警告。此次为客户端输入与UI接线，未改权威规则、codec、RNG或服务端事务；未重跑完整串行套件，也未将前一批1006项计作本次结果。

维护者在隔离的 `http://127.0.0.1:8045/` 前端开发入口，使用computer-use查看原StarterSelect并鼠标点击妙蛙种子，实际显示原选择菜单；未将后续界面变化作为完整操作链通过证据。用户随后要求自行测试，维护者停止浏览器操作并保留页面。用户最终反馈原话：**“没发现问题”**。记录为本批按键／鼠标可用性的用户复核，用户未逐项提供界面与操作记录，不扩写为所有菜单、双浏览器、跨设备或完整MVP验收。

证据日志位于ignored `build/controls-review/`，不提交日志／截图／真实存档。8045为前端测试入口，未据此验收正式合作WS链路。页面及服务留给用户继续反馈，未关闭其他服务。

## 交接

本批完成后停止，后续普通捕获任务沿最新输入修订继续，不能从旧功能起点覆盖本批改动。原主动换人B、Potion原Party和其它玩法的具体待验项，仍按各自记录管理。SPEC和任务书只本地；明确文件清单暂存，空白／凭据模式扫描仅覆盖本批，不是绝对隐私保证。最终提交SHA以维护者交付为准。
