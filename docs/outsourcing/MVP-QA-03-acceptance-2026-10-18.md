# UI-01R／QA-03 独立验收

日期：2026-10-18。结论：**UI-01R 资料修订接收；QA-03 接收；QA-02B 修订版完整回归待验关闭。** 仅验收已声明的资料、consumer 和回归范围，不提升生产 adapter／原 UI／双浏览器／跨设备或 M6 完成状态。

## 提交与实际范围

- 总起点：`845c64deff334e6b9b03313b2f7c892983b79595`。
- UI-01R：`953d29220ab59da9066bf73c21935b2a04e5f0c9`，父提交为总起点，仅修改原 C 两文档。
- QA-03：`3fd1368bd4d4a7e8247bb2ca1a925ab34655f230`，父提交 UI-01R，仅新增 consumer 测试和交付报告。
- 合计四个约定文件；生产源码、脚本、依赖、旧测试和 fixture 相对总起点无变化，空白检查通过。接手分支 `outsourcing/mvp-ui-01r-consumer-qa` 干净，维护者在 `review/mvp-qa-03-vertical-priority` 记录验收，不移动原交付分支。
- 本地 main 仍 `51de6356df27a32c91f083ee0f4c1d161cde6602`；实时只读远端 main 为 `5614776777eb820972c60a73d8986abb4f57836e`。未合入 main，未推送。

## 日志与版本复核

按 BOM 解码原始 UTF-16LE TAP，核对统计、每条顶层 ok、正常计划收尾、K01–K32、修订后的 P11 及退出码文件：

| 执行证据 | 结果 |
| --- | --- |
| 外包 consumer 定向 | 32/32，退出 0，`1..32`，176.9265ms |
| 外包完整串行回归 | 912/912，退出 0，`1..912`，918439.2206ms |
| 维护者独立重跑 consumer 新文件 | 32/32，退出 0，`1..32`，191.8512ms |

上述各轮 fail／cancelled／skipped／todo 均为 0。维护者本轮没有重跑十五分钟全套，不把日志复核表述为独立执行全套。

完整执行时 HEAD 为 UI-01R 的 `953d2922`，当时 QA-03 测试尚未提交；元数据中的 consumer blob `2d38464996f0266d48caeeab7e88c300f5d525a3` 与最终交付一致，P11 测试 blob `44f9c3e0d1c81c9dc9a973e84f7ae4a841a38b09` 与维护者修订一致。因此本次证据确实覆盖修订 P11、A／B、正式 WS 与新增 consumer，没有用旧 880 加新编号推算。

原始日志与退出码／执行元数据位于 ignored 的 `build/qa-mvp-03/`，不提交。生产代码与依赖未变，本轮未重跑 typecheck／build，沿用前序同生产代码证据。旧 880／879／1 和错误资金前提的历史保留，本次仅关闭修订版本待验，资金足够的真实 reroll 仍未覆盖。

## consumer 实现审查及额外控制

直接 import 正式 `createSnapshotConsumer`；独立协议 counter、Node crypto 夹具 hash、真实 consumer 的 hooks／错误／ACK 被断言，未复制被测消费器或挂 fake adapter 到生产。拒绝值、resync 消息、重复消费的实际事务调用和 ACK 均有具体预期。内存 ledger 去重属于测试 adapter 假设，不是 consumer 自动去重或 M6 验收。

外包 K26／K27 使用 deferred gate 验证排队；K28–K31 在 hook 内切换 epoch，能覆盖失效分支，但没有外部控制真实挂起窗口。成功测试的 hook 与 send 也分开记日志。维护者因此独立补充了：

1. applySnapshot 真正挂起后由外部切换 epoch，再释放。
2. 事务真正挂起后切换 epoch，再释放。
3. 最后一次 capture 真正挂起后切换 epoch，再释放。
4. apply 真正挂起后切换 epoch，再以固定错误失败。
5. 用同一条 trace 断言 `apply → capture1 → grants → capture2 → grantAck → stateAck`。

五项临时控制均通过，四个失效窗口均不发送旧 ACK／resync，失败项传播固定错误，原 snapshot 未变。未修改外包测试，完整回归对应的代码／测试版本不变。这些额外控制不加进登记的 912 项；若以后要把它们变成持续回归，可在实际客户端桥接批次顺带固化，不另开外围 QA 批次。

## UI-01R 资料审查

U01–U24 及 12 份未来脚本、8 风险保留，逐条字段已补齐。原退修点已纠正：MODIFIER_SELECT 和四个 handler args、先验与效果拒绝的层次、临时 command 取消语义、actionId、MessagePhase 展示完成与权威推进的区分、原 C 父提交。原代码未变化，已复核的调用位置仍成立。资料可作为接线索引，建议和未确认项不等于批准的协议设计；12 份浏览器脚本仍未执行。

## 下一步

依用户最新优先级停止追加外围 QA，转入 [MVP 纵向切片](../mvp-vertical-slice-2026-10-18.md)。以真实 WS／Worker／私有投影／原模型应用／ACK 到第二战为下一项可交付证据；基础房间事务与待处理意图需在可玩验收前落盘，完整收藏事务不冒称已完成。
