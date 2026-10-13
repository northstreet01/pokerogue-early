# M1 正式协议与双客户端入口

日期：2026-10-13。起点 `df9eb8bf`，审查后提交为 `13ac6839`；未推送。M2 后续进度见 [原 Pokemon 检查点](original-pokemon-checkpoints-m2-2026-10-13.md)，下文记录 M1 范围。

M1 契约及协议测试已完成。原版运行器、Pokemon 模型适配、原 UI、正式收藏事务和真实双机仍未完成。测试里的计数器仅用于验证协议，不能替代原规则，也不从生产入口导入。

## 实验协议与正式契约映射

| 现有实验路径 | 正式路径 | 差异与落实位置 |
|---|---|---|
| `/coop/ws`，直接导入实验 engine | `/coop/v1/ws`，依赖注入 ServerAdapter | 新服务不导入实验 engine；默认缺适配器时返回 `ADAPTER_UNAVAILABLE` |
| 每消息 version/rulesHash | hello/welcome 四项版本 | protocolVersion、rulesVersion、contentHash、checkpointVersion 严格比较；不兼容存档拒绝恢复且不重写 |
| create/join 混合新加入和恢复 | createRoom / joinRoom / resumeSeat | 原席位依私有 token 恢复；seat 从连接导出，未知顶层字段拒绝 |
| room code、revision、指令 id | roomId、runId、decisionId、expectedRevision、actionId | 唯一指令绑定席位与整条内容；同 ID 异内容拒绝；回执保留本局全程 |
| action/team/prepare 独立分支 | submitAction + 适配器决策 | 只校验通用 kind/JSON；原版合法动作联合与目标规则由 M2/M3 补齐，不用实验招式目录定义 |
| snapshot 的整个实验 state/hash | 共享投影及席位个人投影分别 SHA-256 | 凭据不在快照；在线/ACK/输入收集状态单独 syncStatus |
| ack 校验收到的 JSON | applySnapshot → captureAppliedState → 本地事务 → 再校验 → stateAck | 消费器从已应用模型提取；旧连接异步完成不 ACK；失败请求重同步并撤回此前确认 |
| grantAck ids | grantAck 含 runId / connectionEpoch | 校验授予所有者；必要授予未确认不能过状态屏障 |
| snapshot 请求 | requestSnapshot | 请求权威状态并重建双端屏障，不能上传客户端状态替换服务器 |
| RoomStore 保存实验结构 | FormalRoomStore 保存正式 envelope + 不透明检查点 | 默认目录 `server/data/formal-rooms`；生产可用 COOP_FORMAL_DATA 配置；实验目录与文件不迁移 |

## 实现边界

- `src/battle-core/coop-contract.mjs` 及 `.d.mts`：共享消息联合、适配器类型、运行时严格字段校验、版本检查和稳定错误码。标准 JSON 编码排序对象键、保留数组次序，拒绝 undefined、非有限数、稀疏数组及访问器；SHA-256 用于状态一致性，不是身份认证。
- `src/battle-core/coop-client.mjs`：每连接串行应用快照；调用真实适配器的模型提取与授予事务。M1 测试使用两个独立计数器模型；原 Pokemon 模型尚未接入。
- `server/formal-coop-service.mjs`：连接代次、房间串行队列、双端屏障、私有恢复、输入和回执先持久化、候选检查点提交、授予确认和失败暂停。ACK 仅存在内存且绑定当前连接，重启必须重建。
- `server/start.mjs` / `vite.config.js`：同时挂载两个隔离入口；正式入口默认没有运行器，无法开始冒险。没有切换 `/` 或 `/coop.html` 的客户端路径。
- `tests/coop-formal.test.mjs`：沿用原 WS 测试的随机本机端口、独立客户端与临时存储模式。没有读取真实房间或个人存档作为夹具。

适配器先创建可恢复的初始决策上下文；未来选队也应是决策。describeDecision 指明 id/所需席位；validateAction 必须无副作用（检查点前后比较）；advanceToDecision 返回下个 context、展示 events、grants。检查点 payload 的完整字段和原规则合法性由 M2/M3 提供，M1 不伪造这些实现。

双方输入收齐之前，每个输入及回执已落盘。运行器在独立恢复的候选上下文推进，结果再次校验、保存后发布。写盘或执行失败保持最后已提交检查点和输入，暂停；重同步与当前双端确认后重试。重复回执不重复执行。提交成功而结果未收到时，恢复发送已提交版本与待授予。

## 验证证据

新增 12 项协议测试通过，覆盖：

1. 严格消息边界、规范编码及浏览器 WebCrypto/Node SHA-256 一致。
2. 四项版本拒绝、握手顺序、缺适配器明确拒绝。
3. 两个真实 WS 客户端、两份独立模型、身份/所有权、确认屏障、去重、同 ID 异内容、旧决策及旧 ACK。
4. 共享/个人投影分离、模型损坏、本地事务失败、授予所有权及重复授予账本。
5. 连接替换、私有凭据、新连接代次、旧代次拒绝。
6. 输入写盘失败、结果写盘失败、运行器失败后的暂停与恢复。
7. 临时真实文件重启恢复单方输入和回执；不兼容恢复保持文件字节不变。
8. A/B 输入顺序、双方输入已落盘但结果提交失败后的重启只结算一次。
9. 提交后丢失结果/ACK 的恢复不重复扣费和生成授予。
10. 本地事务等待期间连接失效不发送旧 ACK。
11. 正式与实验 WS 入口同端口共存，实验建房正常，正式缺适配器拒绝。
12. 审查修复：重同步撤回双方 ACK 后向双方重发快照，避免只通知请求方导致另一端无法重新确认。

原有 63 项回归通过；新增 12 项通过，合计 75 项。`npm run typecheck` 与 `npm run build` 通过；构建仍有原项目大包、动态/静态导入混用警告。首次 WS 检查遭沙箱 EACCES，获执行权限后通过；首次构建遭沙箱 realpath EPERM，获执行权限后构建通过。测试未占用 8020 或停止用户服务。

不计为 M1 证据：原 Pokemon 完整恢复、全部原规则差分、浏览器 UI 双端、真实两设备长局。没有执行正式收藏授予；M1 已提交，未推送。

## 下一步 M2

先建立完整字段/引用/决策停点清单，再逐类接 Pokemon、本局资源、全随机流、决策与输入；每个切片同时验证不中断原版执行与保存恢复继续的差分，并通过本入口让两端实际恢复原模型及提取摘要。完整运行器在 M3，原 UI 在 M4，收藏事务在 M6，故障矩阵随模块扩大。
