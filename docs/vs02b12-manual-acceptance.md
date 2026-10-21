# VS-02B-12 用户手测准备（未执行，训练家通关仍阻断）

本轮只有默认收藏到第5波入口及有限非击倒回合的自动证据。原训练家展示／浏览器交互未验收。**无需用户现在重复尝试第5波通关**：正常攻击造成训练家敌人倒下仍会报 `UNSUPPORTED_COOP_ENEMY_FAINT`，胜利／第6波未完成。开发继续补同一条链，完成后更新本清单。

若要检查已有入口，使用新目录，不覆盖已有房间／资料：

```powershell
Set-Location E:\pokeregue\pokerogue-early
npm run build:coop-runtime
npm run build
$env:COOP_PROFILE_LOBBY='1'
$env:COOP_ROOM_SEED='learning-natural-2'
$env:COOP_DIST='dist'
$env:COOP_FORMAL_DATA='build/user-vs02b12-rooms'
$env:COOP_DATA='build/user-vs02b12-legacy'
$env:PORT='8049'
node server/start.mjs
```

两个独立浏览器／profile打开 `http://127.0.0.1:8049/coop-play.html`。不要混用localhost／127.0.0.1或切换端口验证恢复，不清空IndexedDB／outbox，不修改真实存档。

默认初始收藏即可选择：

- 席位0：呆火鳄＋杰尼龟，呆火鳄首发。
- 席位1：新叶喵＋杰尼龟，新叶喵首发。
- 个人各6点、共享12点，无需卡比兽、露力丽、特殊解锁或配招。新资料原默认IV10／中性性格，实际历史资料不同可能改变回合与奖励，不保证逐步相同。

自动参照使用原默认配招；优先本人火花／树叶等已有元素攻击，目标选左侧存活敌人，再选另一只。原整备若有支持的治疗且本人受伤就正常领取，否则跳过；双方准备，战前保持当前出场者。若正常触发学招，用原界面处理，参照路线选择放弃；不能修改经验、等级、HP或RNG来赶到第5波。

可记录的手测项目：正常选队／准备，前4波双方战斗及整备，第5波是否出现敌方且恢复双方Command，刷新后席位、本人后备及公开场位是否一致，球菜单不应允许捕获训练家精灵。训练家人像／对话是否正确属于待测展示项，不能由自动Worker推断。

遇到敌方倒下报错立即记录第几波、双方操作、错误文字并停止；不要删存档、换seed跳关或反复提交。不要把“只用状态招式能继续一轮”写成训练家可打赢，也不需要用户通过特殊操作回避倒下来完成验收。
