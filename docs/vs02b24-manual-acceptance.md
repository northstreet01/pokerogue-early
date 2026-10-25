# VS24 单Boss终战真实双端待验清单

自动验收与边界见[维护验收](mvp-vs-02b24-final-boss-review.md)。本清单没有真实双浏览器、音频或视觉通过证据。

## 加载本批前端

维护者不自动重启服务。用户自行停止原游戏服务后，沿用原房间目录和原隧道启动新版，避免两个服务写同一数据目录：

~~~powershell
cd E:\pokeregue\pokerogue-early
$env:COOP_PROFILE_LOBBY='1'
$env:COOP_DIST='build/vs02b24/dist'
$env:COOP_FORMAL_DATA='server/data/remote-test-formal'
$env:COOP_DATA='server/data/remote-test-legacy'
$env:PORT='8020'
node build/vs02b24/frozen/server/start.mjs
~~~

另一窗口正在开发local-meta，本批通过c55c3bf9冻结副本独立验收；上述入口固定使用该副本的正式server和原Worker，静态前端仍为build/vs02b24/dist。不要清理frozen目录，也不要把混合工作区的其它代码当成本批已验收。若原服务使用其它数据目录，必须保留原配置；命令仍从项目根执行，因此原相对数据路径不变。双方刷新同一原隧道地址的/coop-play.html，使用原席位恢复；不清IndexedDB或个人存档。

## 终战复验

1. 新建最终遭遇应只有一只无极汰那、一条原Boss分段血条。两名玩家从首阶段同时各控制本人一只，均可选招、看本人后备；敌方目标中不出现空第二槽。
2. 双方出招、不同速度和先后操作应沿同一权威顺序播放。原遭遇对白、阶段对白、BGM、血条、精灵形态和背景应正常；首次加载、窄窗和刷新后分别观察。
3. 原首阶段结束时，同一只Boss变身，原黑洞/配招和HP分段生效；不出现第二只Boss、不换实例或重复对白/变身。两席仍各有本人前场和输入。
4. 本人倒下后的原替补选择只允许本人队伍，伙伴继续保留前场；本人全灭时伙伴可继续，双方全灭正常结束冒险。蓄力第二回合、再充能和状态图标不丢失。
5. 首阶段前/中、变身前后、最后击倒和通关后分别刷新或短暂断线。恢复不重复剧情、变身、伤害、耗PP或pending奖励，声音和画面最终收敛。
6. 最终胜利只结束一次；每席Boss券沿原份额保存pending，不出现可消费永久余额或扭蛋自动授予。

## 旧档与前序回看

已保存为两只Boss的旧200波继续原两Boss局，恢复不静默删敌。该局不应宣称已迁移成新单Boss。旧199波尚未生成最终遭遇时，下一战采用新结构。未升级服务前不能用旧进程的两Boss画面判定新版。

按[23成长道具](vs02b23-manual-acceptance.md)、[22V续招](vs02b22v-manual-acceptance.md)和[八项远程修复](vs02b22w-manual-acceptance.md)回看TM/进化/本人队伍、限量商店、捕获、房间和退出。自动测试不关闭这些真人复验项。
