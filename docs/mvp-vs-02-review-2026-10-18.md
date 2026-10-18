# VS-02 第一段子集维护者复核与修复

日期：2026-10-18。原交付 f00f1fb68d68b055ed0353797314414d91bf743e，基线 9aca592d815916f6640deca0ec20c06f335cf1be。评审分支 review/vs-02-segment1-acceptance；保留原交付分支，不合并、不推送。

## 实际范围与问题修复

1. 独立复现 VS-01：8 项均打印 ok 后进程不退出。原因是主动 failRoom 关闭 Worker 时，在途请求捕获 CLOSED 后自动创建替身；房间已从 Map 删除，替身无法被 closeAll 清理。现在显式关闭后禁止重建，替身创建期间再次校验房间身份，清理初始化失败的 host；并发故障恢复共享一个 promise。新增 failRoom／closeRoom／closeAll 在途竞态与并发恢复测试。生命周期测试使用专门故障注入 host，不模拟战斗规则。
2. restoreCheckpoint 自行调用校验；严格 envelope／provisioning／lobby／pending intent 形状，拒绝未知字段、重复 intent、伪造已授予状态、准备但未选择、双方已准备但还滞留 lobby。战斗 stage 必须对应真实 decision，seed 必须与原 checkpoint 一致。同 run 已有 Worker 与持久 provisioning 不一致时拒绝，不静默沿用旧 seed／identity。
3. formal service 校验带 runId 的检查点与外层房间一致，包括候选提交；真实磁盘损坏版本／runId 续局拒绝，不发送快照、不重写旧文件。协议计数夹具无 runId 时保留原契约。
4. lobby 投影复制 starters，避免外部改投影污染权威候选；validateAction 拒绝非法 seat。
5. 原缓存名 committedCheckpoint 不实：formal service 在落盘前也调用 restore。改为仅诊断 diagnosticCheckpoint；capture 不写缓存，初始化／建战不提前标记提交；恢复总取传入 envelope，不从诊断缓存读状态。
6. 原 v6 无蛋数据时 personal.eggs=null（未知），不能补 []；v7 经原 owned egg codec capture，保留真实库存。客户端 captureAppliedState 同步保留 null，避免再次补空并触发核验失败。新增旧 v6 投影与真实 PlayerPokemon 应用／重新提取回归，不进行生产数据迁移。
7. 沿用交付 lobby 原种子 vs02-lobby-fixture 与队伍 [1,4,7]／[25,133,152]，新真实 FIGHT 验证发现 ObtainStatusEffectPhase／ShowAbilityPhase 未被原运行器允许。直接登记 src/phases.ts 的原类，复用已有展示端口、codec 和规则任务观察器；不修改原函数或另写状态公式。连续执行与每个阶段新 Worker 的 JSON 恢复差分一致。只覆盖本例实际状态获得和特性展示；PostTurnStatusEffectPhase、其它机制仍需逐项适配，不能泛称全部异常状态已支持。

## 验证证据

- 原默认沙箱测试遇 loopback EACCES 与临时目录 rename EPERM；有权限环境复现 8 项结束后的进程挂起，主动终止该自建测试进程。
- 第一次修订原两文件 12/12 正常退出（17872.0337ms）。
- 新真实重启测试曾揭示上述普通 Phase 缺口：30/32；失败记录保留。补原阶段后 33/33（37745.0565ms）。不换 seed、不跳过、不降低业务断言。
- 最终定向 **35/35、退出 0**（38398.7607ms）；完整串行回归 **935/935、退出 0**（901232.6578ms），正常 1..935 收尾，失败／取消／跳过／todo 均为 0。类型检查退出 0，生产构建退出 0（50.92s，仅既有 chunk／混合导入警告）。
- 两次完整回归启动后分别因补充 runId 交叉校验、客户端 v6 未知蛋捕获修复主动中断，build/vs02-review-full-interrupted.tap 与 full-interrupted-client.tap 仅历史排查材料，不作为全套完成证据。
- 最终执行 HEAD 与代码 blob 记录在 ignored build/vs02-review-execution-meta.json；TAP／退出码保存在 build/vs02-review-*，不提交。按 BOM 解码，不能把中间结果当最终结果。

真实恢复用例：正式 lobby、双真实 WS、原类模型 apply/capture、正式 consumer ACK → 双方选队 → 一席 FIGHT 与 receipt 原子保存 → 完整关闭 server＋adapter → 同目录新服务、新 Worker、不同默认 seed → resumeToken 恢复新 epoch → 同 actionId 重放旧 receipt → 另一席行动 → 与连续原执行比较完整 envelope → 重放仍不重复结算。磁盘失败用例在下一 revision 保存点注入异常，旧 checkpoint 与双方已落盘输入保留，两端均无新 revision。

## 接收范围与剩余缺口

本批仅接受内部 lobby／envelope／恢复接缝子集。真实 server 落盘重启与回执重放已从待开发推进到实测；没有浏览器 UI、真实个人选队或跨设备证明。

- createOriginalCoopAdapter() 默认仍是 VS-01 固定夹具；只有显式 fixture.lobby 才进 lobby。正式 start 未注入 adapter，默认仍 ADAPTER_UNAVAILABLE。原交付“默认不再固定队伍”不准确，不能据此发布。
- 双 identity 是服务端测试 provisioning，不是本人真实档案绑定；starter 仅 species ID，未接原 StarterSelect／收藏的形态、性格、特性、招式等完整选择语义。
- eggs 客户端消息仅 codec 结构校验，真实库存来源／绑定未完成。未消费蛋、未写永久收藏；intents recipient=null 表示尚未确认，M6 未完成。
- 事件 scope 仍非生产白名单，原 UI、IndexedDB outbox、同源发布与真实构建版本校验仍缺。
- 未支持 Phase 仍安全失败；不限制物种／世代、不更换随机种子规避、不宣称正常无限闯关。
- 实时 origin/main 查询普通／宿主环境都因本机 127.0.0.1:7897 代理拒连失败。缓存 origin/main=5614776777eb820972c60a73d8986abb4f57836e；本地 main=51de6356df27a32c91f083ee0f4c1d161cde6602。开工 HEAD 相对缓存 origin/main 为 ahead 24／behind 0，非实时远端保证。

## 下一批

执行 AGENT-VS-02B-FIRST-PLAY-PROMPT.md。先完成真实个人初始化与原 UI 双端首战；完整整备、下一战 UI 另批推进。旧 VS-02 三段任务作为总目标保留，不要求一次完成所有后续功能。

执行代码身份（完整回归时 HEAD 为 f00f1fb6，维护者修订尚未提交；以下 blob 与最终提交核对）：

- server/original-coop-adapter.mjs: 5c1b3aec2bb9cc3deb06919cd4f7f9b13048f4a1
- server/formal-coop-service.mjs: 5318fbc33c690e3c786fd2ddabc0fe2aff1bb34d
- src/server/native-entry.ts: 488dc721c75bea36f3791ef8bc6106f58fedcd6b
- src/coop/original-client-model.mjs: 55c16529d601fafdef3dd9a197cd725049321f32
- tests/coop-original-bridge-vs01.test.mjs: e6575c584f016241b1c8a06d9b9234bbf7d235e9
- tests/coop-original-resume-vs02.test.mjs: 10de61b10ce894398add81a0330de717f85f6a4b
