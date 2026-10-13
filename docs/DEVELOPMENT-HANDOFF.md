# 新窗口开发交接

更新：2026-10-13。本文件用于打开新窗口后的上下文恢复，不代表已创建新聊天或启动下一阶段。

## 工作目录与起点

- 只在 `E:\pokeregue\pokerogue-early` 开发；远程 `https://github.com/northstreet01/pokerogue-early.git`，分支 `main`。
- M1 批次起点是 `df9eb8bf`（架构、模块排期和交接）；本批 M1 工作区修改随本批提交；未推送，接手以 Git 状态为准。
- `E:\pokeregue\pokerogue` 是另一份含用户未上传工作的新版目录，不能重置、清理或批量覆盖。需要移植扩展时只读参考并记录来源。
- 接手先读 `git status --short`、`git log -5 --oneline`；不要假定用户之后没有修改，不做强制拉取、reset 或清理。
- 发布排除服务器房间数据、恢复凭据、个人备份、环境秘密、node_modules、构建和临时审计输出。不要读取真实房间文件来生成公开测试夹具。

## 阅读顺序

1. [SPEC](../SPEC.md)：批准玩法、永久收藏边界、真实进度、验收与未决问题。
2. [联机架构与接口](coop-architecture-2026-10-13.md)：权威边界、消息、状态/恢复接口、安全停点。
3. [模块计划](coop-development-plan.md)：M1–M8 依赖、验收和双端测试安排。
4. [B1](original-battle-integration-2026-10-13.md) 与 [B2](original-state-checkpoints-2026-10-13.md)：已提取的原版规则、状态组件和缺口。
5. [语言适配](upstream-localization-2026-10-13.md)、[实验页说明](../COOP.md)：保留现有扩展与理解实验边界。

## 已完成与未完成

已存在 Node/WebSocket 房间、去重/确认/持久化基础，本地档案与备份，B1 局部纯规则，B2 效果/RNG 状态组件，首批上游中英语言适配。M1 已新增正式契约、适配入口和 12 项协议测试，连同原有 63 项共 75 项通过；详见 [M1 记录](coop-contract-m1-2026-10-13.md)。

**原游戏尚未接入完整合作战斗。** `/` 是原单人；`/coop.html` 是隔离实验页。`server/coop-service.mjs` 仍导入 `src/coop/engine.mjs`，不能把这套有限规则当原版运行器。完整精灵、全部随机流、决策状态、实际客户端模型 ACK、原 UI 联机与原版合作收藏仍待实现。

正式 `/coop/v1/ws` 已在开发/生产服务挂载，默认无原版适配器，开局返回 `ADAPTER_UNAVAILABLE`。`src/battle-core/coop-contract.mjs` 与类型声明定义正式消息/适配接口；`coop-client.mjs` 从应用后的模型提取并确认。测试使用两个独立计数器模型，仅证明协议，原 Pokemon 模型尚未接入。

## 下一项可执行任务：M2

1. 阅读 M1 映射/实现记录、B2 与当前适配接口，登记完整精灵字段、稳定引用、所有权、派生值及安全决策停点。
2. 按切片补齐精灵、本局资源、全部随机流及决策上下文；完整校验后一次替换，失败不污染旧状态，不给 getter 赋值。
3. 每个切片同时做原版未中断/恢复继续差分，并接 M1 真实 WS 两端入口；两端实际恢复原模型后独立提取摘要。
4. 保持 `/` 与实验页行为；完成后更新 SPEC/模块证据，再进入 M3 原规则运行器。不得将测试适配器用于正式游戏。

不需要等完整引擎才能开双端，也不以先开两个页面代替单端原规则差分。两类测试同步开展，浏览器 UI 和真实双机验收另行记录。

## 常用检查

```powershell
Set-Location E:\pokeregue\pokerogue-early
git status --short
git log -5 --oneline
npm run typecheck
npm run test:battle-core
npm run test:coop
npm run test:local-save
npm run test:localization
npm run build
```

按变更范围执行检查；文档变更只需检查差异/链接/一致性。开发 `npm run start` 默认 8020；生产 `npm run build` 后 `npm run start:server` 也默认 8020。先检查已有服务，不能占端口或停掉用户正在玩的进程。浏览器试验用隔离档案和临时房间，不覆盖用户收藏；生产只上传 dist 不足以运行 Node 联机。

## 可直接发送给新窗口的任务

> 在 E:\pokeregue\pokerogue-early 继续开发。先检查工作区，再读 SPEC.md、docs/coop-architecture-2026-10-13.md、docs/coop-development-plan.md、docs/DEVELOPMENT-HANDOFF.md 和 docs/coop-contract-m1-2026-10-13.md。M1 契约与协议测试已完成，M1 已提交（编号以 Git 记录为准）；从 M2 完整状态检查点开始，单端原版差分与真实 WS 双端原模型恢复同时推进。架构为 Node.js 权威结算，不是浏览器 P2P。保留 early 原规则、原图鉴和本地局外收藏；不重写简化游戏，不动 E:\pokeregue\pokerogue 的未上传内容。每批次更新模块进度与验证证据，区分文档、接口、运行器、UI 和双机验收。
