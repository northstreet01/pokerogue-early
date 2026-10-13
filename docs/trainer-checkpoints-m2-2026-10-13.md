# M2 第三批：原 Trainer 检查点适配

日期：2026-10-13。基于 `271b5570`，本批独立提交，未推送。M2 仍部分完成。

## 实现范围

- `src/battle-core/trainer-state.mjs`：Trainer 的 config、variant、partyTemplateIndex、name、partnerName 显式编解码与版本校验。配置保存 trainerType，恢复只查可信配置表，不执行构造函数、名称生成、随机数、动态模板函数或渲染方法。
- `src/field/trainer.ts`：新增 `captureTrainerState` / `restoreTrainerState`，延迟读取原 `trainerConfigs`，避免循环导入初始化问题。原规则方法未修改；正式运行器可将这两个导出注册为决策编解码器的 trainer 组件。
- 配置对象必须与目录项一致，拒绝未知 ID、克隆配置、非法 variant、越界模板下标。保留缺失、undefined、null 和空字符串的姓名差异；空模板列表保留原构造逻辑可能产生的 -1，不补默认配置或重新抽样。
- 恢复对象保留原 Trainer prototype，但没有 Phaser 容器或 scene；调用依赖场景的规则前，由运行器绑定可信场景。不能直接将该对象加入原渲染容器。显示字段和 Phaser 自有属性不序列化，声明字段覆盖测试防止新增原 Trainer 字段遗漏。
- 姓名为检查点展示数据，不应进入正式共享战斗摘要。本批 WS 使用无姓名合成训练家；完整生产投影和 UI 应用仍待实现。

## 验收证据

新增 3 项单元测试、1 项 WS 错误恢复测试；原有 3 项 wait-actions WS 用例升级为含 Trainer 的恢复。总计 **96 项自动测试通过**。

- 执行原 Trainer 模块及其生产导出，渲染构造函数设为抛错；使用合成可信配置和原版普通/复合模板类。对静态及动态模板，在波次 1–1000 比较恢复前后的原 `getPartyLevels` 结果，检查 prototype、配置身份、`isDouble` 与姓名字段存在性。
- 错误版本、类型、配置、模板、variant、姓名格式及规则字段 getter 被拒绝；失败不修改旧模型。
- 两个真实 WebSocket 客户端各自恢复 Trainer；接受单方行动后重启服务实例，恢复后继续与未中断状态一致；结果落盘失败后可重试，损坏持久输入继续拒绝。
- 持久 Trainer 配置 ID 损坏时，拒绝恢复、不发布快照、不重写房间存档。
- 全套检查命令：`node --test tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs`；`npm run typecheck`、`npm run build` 均通过。构建保留既有大包和静态/动态混合导入警告。

WS 沙箱首次运行因本机回环连接 EACCES 失败，取得执行授权后全套测试通过。只用本机临时端口、合成配置及内存房间；未读取真实房间、未停止现有服务、未修改个人收藏。

## 尚未完成

生产导出绑定原配置表，但自动测试没有加载全部原训练家配置或执行全量队伍生成；不据此宣称原训练家所有行为兼容。动态模板依赖的完整 BattleScene、全部规则随机调用、完整 Phase 流程仍未接入。

下一批优先补 Modifier 全类型及生成型 ModifierType 的无副作用恢复；之后补原 Command/EnemyCommand 的决策映射、房间随机调用接入。正式 `/coop/v1/ws` 默认仍缺运行器；原 UI、浏览器验收和真实双机验收未完成。
