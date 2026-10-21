# VS-02B-11R 用户原 UI 验收清单（未执行）

本轮浏览器由用户执行；以下不是通过记录。自动证据详见维护者复验，自动用例的受控收藏描述没有写入或覆盖真实存档。

## 启动正式静态服务

```powershell
Set-Location E:\pokeregue\pokerogue-early
npm run build:coop-runtime
npm run build
$env:COOP_PROFILE_LOBBY='1'
$env:COOP_ROOM_SEED='learning-natural-2'
$env:COOP_DIST='dist'
$env:COOP_FORMAL_DATA='build/user-vs02b11r-rooms'
$env:COOP_DATA='build/user-vs02b11r-legacy'
$env:PORT='8048'
node server/start.mjs
```

两个独立浏览器／profile 打开 `http://127.0.0.1:8048/coop-play.html`，正常创建／加入新房间。保持同一 origin，不在 localhost／127.0.0.1 或端口之间切换来验证恢复；不要清理 IndexedDB 或覆盖旧资料／房间目录。已有房间仍用自身持久化的 seed，设置固定 seed 不会改造旧房间。验收后正常新随机房间可先 `Remove-Item Env:COOP_ROOM_SEED` 再启动服务。

## 可复现参照与前置条件

自动成功参照为本人资料已合法解锁的 Azurill（露力丽）与另一席 Snorlax（卡比兽），各只选一只，个人3／5点、共享8点，未使用成本折扣。初始均为普通外观、原第一特性、Hardy性格、六项IV31；Azurill在原选队配招处选择 Water Gun／Tail Whip／Splash／Helping Hand，Snorlax参照默认原配招（含Tackle与Defense Curl）。这些招式均通过原初始配招校验，没有蛋招或额外授予。

**不要求用户修改存档来匹配测试资料。** 若没有相应合法收藏／性格／配招，则该固定参照条件不满足，相关手测记未执行并反馈现有队伍。现有IV／性格／配招不同可能改变回合数、受伤、奖励抽取和升级波次；固定 seed 并不能保证不同资料仍逐回合相同。不能用导入虚构收藏、隐藏调用、改等级／经验／HP／RNG 或伪造检查点来冒充浏览器成功。

## 实际操作

1. 原 StarterSelect 正常选队，双方准备进入原战斗。
2. Azurill优先原 Water Gun、Snorlax优先原 Tackle，目标选择左侧存活敌人；左侧离场后选另一存活敌人。
3. 原整备中若本人抽到合法 Potion 且本人受伤，正常选择本人目标领取；否则跳过奖励，双方准备。战前保持当前出场者。自动参照在wave4由胜利经验自然升至6级，原四招已满，出现学习 Bubble Beam（泡沫光线）的选择。
4. 原 Confirm 进入原 Summary，检查旧四招和新招显示；取消，进入二次放弃确认；选择继续学习，重新选招。期间不能提前准备或本地改招。
5. 选择替换原 Water Gun。核对本人权威招式出现泡沫光线，伙伴招式没有被本人选择替换。也可在另一个正常新房间执行二次确认放弃，确认原四招保留。
6. 在选择前刷新本人页面或关闭服务与 Worker 后用同一数据目录重启，待学招应恢复；在选择后刷新／重启，不应重复学习或错误增减PP。另一席正常恢复、完成状态核验。
7. 到下一合法 FIGHT 时，本人实际使用泡沫光线，伙伴可使用原 Defense Curl（变圆），以便核对本人新招确实执行。新招初始PP20，执行一次后为19；以实际原Summary／战斗画面核对，不调用隐藏方法。若选择放弃，则仍可用原水枪继续战斗。
8. 检查两端公开战场、本人队伍、资源和后续整备一致；中文／英文、窄窗和原键鼠输入检查菜单不残留、取消可重选。

## 本轮停止边界

当前生产 `nextNativeBattle` 会明确拒绝 wave5 的固定 Youngster 遭遇，错误 `UNSUPPORTED_NATIVE_NEXT_BATTLE`。这不是本批已通过部分；若在wave4整备后遇到它，记录准确步骤并停止，不删存档、跳阶段或强行转野生。进化、完整多波次、跨设备和MVP上线仍不因此通过。
