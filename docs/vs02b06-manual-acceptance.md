# VS-02B-06 用户浏览器验收清单

当前已独立验证球补给的两浏览器领取、球数隔离、服务重启与刷新不重授予、下一战双方真实 FIGHT。Potion 的 Worker 与真实双 WS 已测；原 Party 目标交互仍待用户验收，未记通过。

## 启动

在 `E:\pokeregue\pokerogue-early`：

```powershell
npm run build:coop-runtime
npm run build
$env:PORT='8042'
$env:COOP_PROFILE_LOBBY='1'
$env:COOP_DATA='build/vs02b06-review/browser-experimental'
$env:COOP_FORMAL_DATA='build/vs02b06-review/browser-formal'
node server/start.mjs
```

若8042已运行本轮测试服务，不要重复启动。两个独立浏览器打开同一个地址 `http://localhost:8042/coop-play.html`。不要一端 localhost、一端 IP；不同来源的本地资料／席位凭据隔离。当前测试房间可恢复，但不是正式个人存档备份。

## 最小检查

1. 原选队→双方准备→真实胜利。奖励若没有Potion，可正常继续或另开新局，不修改检查点／数值；未抽到就记录未执行。
2. 点Potion后只应出现本人队伍；原取消应回奖励菜单，可以重新进入。选择已损伤的本人目标后，只有本人目标按原规则回复，伙伴和备用不被误改。
3. 领取成功后旧菜单不能再次领取；双方处理整备后可准备／取消准备。
4. 整备期间刷新，或关闭服务后用同目录重启，再恢复双方；治疗不重复、原席位与HP不丢，再进入下一战双方FIGHT。
5. 不支持的TM／糖果等应清楚提示，不误显示成功；不要据此认为所有普通奖励都可领取。

原奖励揭示动画存在输入延迟，应用内窗口失焦时可能更慢，先让窗口获得焦点等待原动画完成。下一批将专门改善文字排版、布局和这些可见体验；当前不把跨设备、移动端或全机制写成已验收。

反馈给维护者时说明：在哪个页面／原菜单、选了什么、实际发生什么、是否刷新或断线。房间恢复令牌和完整个人存档不要公开粘贴。
