# M2 有界补充：Pokemon/Battle 跨精灵标签引用

日期：2026-10-13。起点 `cc1dd5de`，`main` 工作区干净、相对 `origin/main` ahead 1。用户重新要求继续有界 Pokemon/Battle 检查点切片；核查 SPEC、M1 契约与模块计划后发现首批及后续装配已存在，本轮补实际引用缺口，不重复实现，也不扩大为完整 M2。本批随 `fix: preserve shared Pokemon tags across checkpoints` 提交；提交号与远程状态以 Git 核验为准。

## 字段和稳定引用

继续复用 Pokemon 显式字段表、物种/形态/招式目录、HP/PP/状态/临时数据及 Battle 的原型、敌方队伍 ID、参与者集合、命令与随机流；既有清单见 [首批](original-pokemon-checkpoints-m2-2026-10-13.md) 和 [等待行动装配](wait-action-checkpoints-m2-2026-10-13.md)。本轮唯一新增 wire 字段是 roster 的 `tagGroups`。

原 `Pokemon.transferSummon` 用 `this.summonData.tags.push(tag)` 共享标签对象。逐个 Pokemon 保存虽然保留各自内部 aliases，却会拆散跨精灵引用。原 `transferTagsBySourceId` 或标签 `lapse` 后，恢复分支会与不中断分支不同。

`tagGroups` 的每个引用由 `{pokemonId, summon, index}` 定位：稳定实例 ID、`summonData` 或 `summonDataPrimer`、标签数组下标。不使用 roster 数组下标作为精灵身份，不把同值但独立的标签合并。记录跨精灵共享组的全部出现位置，包括 primer；原单精灵 aliases 继续保留。标签自身的 `sourceId` 仍按 roster/retiredIds 验证。

roster payload 升为 **v2**，拒绝旧 v1（不能推断旧数据丢失的引用）；外层 decision 仍 v3，通用 M1 envelope 版本不变。恢复遇到不兼容版本返回 `VERSION_MISMATCH`，不迁移或改写已有房间。正式运行器仍默认不可用。

## 恢复与失败边界

在独立候选上恢复原 Pokemon 原型，再验证引用、标签编码相等、重复路径和规范分组；最后才返回模型。未知 ID、越界下标、非白名单路径、冲突内容、不完整 primer 分组及重复引用均拒绝。校验失败不修改输入 payload、此前模型或持久化房间。恢复不调用游戏构造器、效果钩子或随机数。

实现仅修改 `src/battle-core/roster-state.mjs`；Battle 装配复用该 codec。没有改动原游戏方法、入口、服务路由或实验引擎，没有访问或改动 `E:\pokeregue\pokerogue`。

## 验证证据

- 新增三项单端测试：共享引用/primer/原型与候选独立；三步原 `transferTagsBySourceId`、`BattlerTag.lapse` 及原有 Battle 随机继续差分；八种失败候选保留旧模型和输入；同值不同引用与重排 roster。
- 扩充既有真实双客户端 WS 用例为 A 先提交和 B 先提交两种情况：revision 0、decision-1 保存一方输入后关闭并重新挂载服务，恢复原席位、重发指令，再提交另一方输入。revision 1 的事件、两端实际模型投影、服务器检查点、标签引用和两随机流均与不中断参考一致；重复输入不二次消耗资源。
- 新增损坏持久化标签 ID 的 WS 恢复拒绝测试：`INVALID_TAG_ALIAS`，不发布快照、不重写房间。已有结果写盘失败测试也携带共享标签，确认候选执行失败后可重试。
- `node --test tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs`：**135/135 通过**（原 130，本轮净增 5）。首次定向 WS 测试被沙箱 EACCES 阻止，获执行权限后通过。
- `npm run typecheck`、`npm run build` 通过，构建生成 `index.html` 和 `coop.html`，保留既有大包与动态/静态导入混用警告。首次沙箱构建被 realpath EPERM 阻止，获执行权限后重跑通过。`git diff --check` 通过。

WS 使用本机随机端口、测试内存存储和两个独立客户端；重启是重新挂载服务，不是真实进程崩溃或两台设备。夹具按原 `transferSummon` 标签循环建立共享关系，继续执行使用原方法；**没有执行完整接棒 Phase 或完整回合**，也不覆盖所有跨精灵可变对象的共享。目录仍为测试夹具。完整 Phase 待续、进化、地图、整备、结束停点、UI 和双机仍待开发/验收，CHECKPOINT-01 保持未勾选。
