# VS-01 维护者审查、修订与验收

日期：2026-10-18。交付 `6c7f2319e313de0f5176b244a4f9331f09fac809`，基线 `80ae45f6ca1b5d1c53e7a789c52cefe653624ecb`。维护者在 `review/vs-01-bridge-acceptance` 保存独立修订，原交付分支保持不变；未合入 main、未推送。

**验收结论：维护者修订后，固定夹具的 VS-01 内部真实接缝通过。** 原交付与修订版本分别记录；不提升为原 UI、正式个人初始化、实际落盘续局或跨设备验收。下一实际开发批为 VS-02。

## 1. 交付与原始证据

- 接手工作区干净，分支 `feature/vs-01-original-coop-bridge`；相对基线确为 11 文件、+1013/−5，无依赖或冻结 fixture 变化，空白检查通过。
- 原完整 TAP 按 BOM 读取：917/917，退出 0，`1..917`，934466.0661ms，fail／cancelled／skipped／todo 均为 0。对应 `build/vs-01/full-clean.tap` 和退出码文件，属于原交付版本，不覆盖维护者后续修订。
- 执行元数据 HEAD 为当时的 80ae45f6，新增 VS 测试 blob `8a58287089e92d68605429644b6ac28f3d4cb586` 与最终交付一致；不能把执行时 HEAD 当成已经包含未提交代码的提交。
- 维护者独立复跑原五项 5/5，退出 0，39113.4511ms。首次受限沙箱有四项本机 connect EACCES，属于回环连接限制，随后在允许临时回环的宿主复跑；没有改测或把受限结果写成业务失败。
- 原代码确有正式八方法 adapter、真实 Worker RPC、个人原类恢复和正式 consumer 参与；不是 counter adapter。固定夹具链路在独立复跑中确有第二战推进，但原测试允许失败分支，必须加强后才能作为持续守门。

## 2. 修订项

| 问题 | 原行为／风险 | 维护者修订 |
| --- | --- | --- |
| 第二战成功测试也接受 RUNNER_FAILED | 固定场景退化后，仍可能保留绿色“贯通”结果 | 删除接受错误的成功分支；两端必须收到第二战的新 revision／命令事件，实际应用并 ACK，且无 error |
| 两房间隔离断言无效 | 读取缓存的旧 snapshot；sharedHash 与自身比较 | 发 resync 前注册两端新快照等待；比较旧／新与双端摘要，再让存活房间完成真实下一回合 |
| ready 后不能 unready | describeDecision 排除 ready 席位，advance 再次拒绝该席；原 native 纯校验却允许 unready | 整备 requiredSeats 保持双方，复用原安全动作校验，不重复阻断 ready 席位；新真实 WS 测试验证 ready→unready→ready，搭档资源／菜单不变 |
| 未实现永久事务却默认成功 | ClientModelAdapter 无条件 resolve 非空 grants，consumer 可发假 grantAck | 空 grants 正常；非空／非法列表拒绝 PERMANENT_GRANTS_UNAVAILABLE，并验证只 resync、不 ACK、不推进 |
| ended 描述为 auto | 最终状态会被协调器再次推进，adapter 却不支持该动作 | terminal 用无输入的非 auto 描述；新增纯描述测试，不伪造规则终局执行 |

未修改原伤害、成长、随机或其他公式。实际复现过“native 允许取消准备但正式层不允许”以及非空 grant 被吞的行为后才修订。

## 3. 接收范围与尚存缺口

本批接收的是**固定夹具的内部真实接缝**：两 WS→formal→八方法→每房 Worker→shared／personal→本人原 PlayerPokemon 应用／再捕获→consumer ACK→首战／整备／换人→第二战真实回合。新严格测试覆盖该完整路径，不能推广为任意 seed／全部机制兼容。

仍未接：真实 lobby／原选队／双方身份、原浏览器 UI、IndexedDB 席位／outbox、真实房间落盘与服务器重启、双设备、完整奖励／成长／替补绑定、M6。未知 Phase 必须继续安全失败，下一步定位具体原节点，不能靠换 seed 掩盖。

正式入口默认仍 ADAPTER_UNAVAILABLE。原客户端模型是最小应用边界，浏览器 codec 注入、原 UI 真正读取的对象、场地／状态显示和所有权绑定尚需 B 批实际验证。

事件过滤已验证当前场景的个人整备隔离，不等于完整生产白名单：当前按 pokemonId owner 猜 scope 会把部分应共同显示的在场动作私有化，未知事件默认 shared 与旧无 scope 兼容也不能作为生产隐私保证。B 批必须按事件类型／明确来源收敛，在提交前拒绝未知生产事件。

envelope／intent 校验也仍有限：stage／initialSelections 关系、序列化 Pokemon 的 fields.id、seen 的真正接收者、seed／个人身份恢复来源需要正式落盘前核对。不得把 pending 的精灵 owner 猜测当作 M6 授予归属。captureCheckpoint 的诊断缓存不是已提交状态，measureProjection 的值不能当作持久提交证据。

## 4. 维护者实际验证

| 检查 | 实际结果 |
| --- | --- |
| 修订 VS 双 WS＋正式协议定向 | 20/20，退出 0，`1..20`，14816.3306ms；其中 VS 新增三项后为 8 项，formal 12 项 |
| npm run typecheck | 退出 0 |
| npm run build | 退出 0，55.10s，仅既有混合导入／chunk 警告 |
| 修订版完整串行回归 | **920/920**，退出 0，`1..920`，876160.9663ms，fail／cancelled／skipped／todo 为 0 |

日志／退出码／执行元数据在 ignored `build/vs-01-review/`，不提交。原 sandbox、host 基线、target、full、typecheck、build 分开保留，不能混用统计。完整执行时三个变更文件 blob 在 execution-meta.txt 保存，完成后与本批提交对应。

### 本次测量点

严格贯通测试在第二战实际结算至 revision 10 后测得：envelope checkpoint 17,652 字节、shared 708 字节、personal 4,788 字节、events 5,433 字节，projection RPC 单次约 7.75ms；进程 RSS 924,553,216 字节。事件采样位置已从原测试的旧 state 修正为真实新快照，因此不能与原约 0.24KB 直接比较或声称性能退化。该 RSS 含测试主进程原 bundle／多个 Worker，不是单 Worker 内存；单次 RPC 不是 p95 或公开容量结论。

## 5. 下一批

下一步为 VS-02 原 UI 与基础续局，按持久化／真实初始化、原画面薄适配、可玩普通闭环三段独立提交。重点是实际双浏览器操作和基本恢复，不继续分配外围参数测试。真实两设备条件未具备时必须留明确未验收项。

完整回归执行时 HEAD 为 6c7f2319e313de0f5176b244a4f9331f09fac809（维护者修订尚未提交），被测 adapter／model／test blob 依次为 4fb89d459c6731172cd6371939a2884ed0cdf1a2、401b2dc73a1d0077da5905fec7798936cee13fe0、d001d6b2af1733c154a4da59df604ad07b3e5690，已与最终工作树核对。原 917/917 与维护者新 920/920 是不同版本的真实执行，不拼接分项计数。本地 main 仍 51de6356，实时只读远端 main 为 5614776777eb820972c60a73d8986abb4f57836e，未合入／未推送。
