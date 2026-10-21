# VS-02B-12 维护者验收：默认收藏可进入训练家，胜利链仍未完成

日期：2026-10-21。交付起点 `6c9dc35c`，交付源码 `caceab6f`，交付文档 `cbb3efa5`。维护者修复分支 `review/vs02b12-wave5-fix`，源码／测试提交 `59c2bb25`。A **部分完成**，B **未开始**；不属于第5波通关、第6波或MVP通过。

## 独立核对

交付时工作区确实干净，两个提交顺序及父提交吻合；只有 native-entry、next-battle-runner 两个生产文件和工程文档，没有新增训练家测试。单一 worktree，未发现其他活跃项目开发任务，没有联系其他 agent。main、origin/main和本次实时 `ls-remote` 均为 `86798227ca995c4ff40043b99a0c6846ed177154`。维护者没有修改源参考目录、合并或推送。

交付保留其他 fixed battle 拒绝，没有手写训练家队伍或AI；但没有合法训练家输入、战斗、正式WS、默认收藏路线和胜利证据。其22/22及构建属于交付报告的既有野生路径结果，不能用作训练家通过证据。原交付失败记录保留在 [原记录](mvp-vs-02b12-wave5.md)。

## 维护者直接修复

- 每次绑定 native 场景时，将恢复出的实际 `battle.trainer.scene` 绑定到当前场景。原 Trainer 的队伍生成、资源加载及展示回调使用当前候选，而不是旧场景及旧任务队列。
- 补齐原遭遇调用的 `pbTray.showPbTray` 展示端口；资源完成回调接入现有受控任务队列，异常交给候选失败处理，移除捕获后仅输出日志的吞错代码。
- 训练家双打配置只在同步调用原 `BattleScene.newBattle` 的期间修改，`finally`立即恢复；不再跨整个异步下一战事务保留修改。没有修改原固定遭遇定义、Trainer variant或队伍模板。
- 合并重复的下一战前置阶段执行分支；原 Return／ShowTrainer 都要求零授予、真实完成、队列引用一致、无 standby，数量限制为最多两次召回和一次展示。不能把未完成或带授予的前置阶段当成功。
- 个人资源比较从组件表中规范化个人 modifier 引用，避免新 Trainer 组件被误算为个人资源变化；个人金钱、球、modifier状态和类型别名依旧逐项比较。
- 训练家专用状态变化通过原 `Arena.updatePoolsForTimeOfDay`、`removeAllTags`、本人当前场原 `resetTurnData/resetSummonData` 构造独立参照并精确比较。新遭遇后本人场位应为空，保留原 Summon 队列重新登场；HP、PP、等级、个体、所有权等仍须保持。野生下一战保持原检查。
- 个人换人下标／场位适配只用于 player `SwitchSummonPhase`（含本人 Return）；不把敌方 fieldIndex 错设为个人 scope。

没有修改原 NewBattle／Encounter／Trainer规则，没有删掉敌方倒下保护、跳过训练家或结算奖金。

## 默认收藏生产验证

新增 `tests/helpers/native-default-trainer.mjs` 调用原 `GameData.initDexData` 产生全新默认收藏，再用原 `captureProfile` 和真实 Worker `validate-profile` 校验：

- 席位0：呆火鳄909＋杰尼龟7；席位1：新叶喵906＋杰尼龟7。
- 每席6点，共12点，个人上限10／共享14以内；原默认中性性格、六项IV10、默认原配招，无额外解锁、蛋招或折扣。
- 明确的新资料空蛋库存，未填空任何旧库存；没有读写用户真实存档或导入虚构收藏。
- 固定 server-only seed `learning-natural-2`；从原 v2 selected 入口、实际战斗和正常原整备连续走到第4波末，正常准备进入第5波。

实际自动到达：原第5波 TRAINER＋原敌队 → Return／ShowTrainer／NextEncounter → 原敌我 Summon → 双方合法 wait-actions。JSON检查点在新Worker重跑下一战，Trainer、variant、敌队、随机状态及事件一致。球选项不存在，伪造投球在通用合法选项校验处以 `INVALID_ACTION` 拒绝。

为单独验证入口后的回合，双方使用当前默认前场原 Leer／Tail Whip 等合法状态招式执行 FIGHT；敌方走原 EnemyCommand／AI，双方各扣一次对应PP并到下一合法输入。该非击倒回合只证明这条有限生产接缝，不证明能打赢训练家。

正式双WS从上述自然产生的第4波末检查点开始，测试初始化注入而非用户页面选队全程；后续全部使用正式adapter、真实Worker、FormalRoomStore、真实Pokemon模型apply→capture和ACK。测试环境内部仍复用既有三只fixture完成adapter初始化，再替换成自然检查点；这不是生产回退fixture，也不是默认收藏浏览器证据。

## 验证与失败历史

- 修订后 native 2/2，退出0，`13155.4007ms`；其中一项是明确的未支持倒下边界回滚验证。
- 修订后正式双WS 1/1，退出0，`12463.9119ms`：自然进入5、单方提交后关服重启、候选写盘失败、同目录重启重试、重复actionId、异内容冲突、第二房间隔离、提交后再次重启不重复PP消耗。
- typecheck退出0；Worker运行器构建通过。最终生产构建退出0，Vite `52.34s`，保留既有动态导入／chunk警告。
- 最终完整串行 **1071/1071，退出0**，正常 `1..1071` 收尾；fail／cancelled／skipped／todo均0，`1086494.5792ms`，约18分6秒。单次 `full-final.tap`＋`full-final-exit.txt`，运行HEAD `59c2bb25185db2b2424d6b842ec2951fcac0c9fc`。本轮新增正式WS在该完整运行中也通过（编号781）。

证据在忽略目录 `build/vs02b12-review/`。保留探索失败：首次绑定漏判空battle导致运行失败，已修正；对整个组件表比较导致资源误判，已规范化；测试把未在option中的投球预期写成较晚的专用错误，已改为实际前置`INVALID_ACTION`；正式测试最初用两只走旧三只fixture初始化，随后误读envelope为raw battle，均修正测试入口后复验。早期 `targeted-first.tap` 23/24含失败，不作为通过运行；`formal-first/second.tap`为失败，最终定向只引用`formal-third.tap`，不拼接通过数。

## 剩余与停止边界

默认攻击路线在第5波第一次敌方倒下时仍报 **`UNSUPPORTED_COOP_ENEMY_FAINT`**：`src/battle-core/faint-queue.mjs` 的合作敌方分支只允许WILD。候选失败，原提交检查点不被修改。不能简单删掉WILD条件；还需接原Trainer后备召回／补位、稳定场位、原逐敌Victory及最后TrainerVictory／MoneyReward／ModifierReward。

A整体仍部分完成；B训练家胜利／奖金／整备／wave6未开始。奖金归属没有明确批准依据，券归属／时机及同回合敌我全倒仍未确认，维护者未自行决定。真实原UI／双浏览器由用户执行，本轮未执行；当前不要交给用户测试“第5波通关成功”。不声明所有seed、所有训练家、跨设备、进化、M6或MVP完成。

下一小批见本地忽略的 `AGENT-VS-02B-12R-PROMPT.md`：先接训练家敌方倒下／原后备补位至下一合法输入，再独立处理胜利整备到6；不新增外围大包。

## 收尾核验

本批10个拟提交源码／测试／工程文档完成空白及常见凭据模式检查，0命中；这是本批有限扫描，不是绝对隐私保证。SPEC与任务书确认为ignored且未暂存；源码／测试运行blob清单保存在证据目录，文档提交后再次比较。收尾实时远端main仍`86798227`，本地main未动。所有提交只在本地评审分支，不合并、不推送。
