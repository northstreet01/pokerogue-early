# 新窗口开发交接

更新：2026-10-13。本文件用于打开新窗口后的上下文恢复，不代表已创建新聊天或启动下一阶段。

## 工作目录与起点

- 只在 `E:\pokeregue\pokerogue-early` 开发；远程 `https://github.com/northstreet01/pokerogue-early.git`，分支 `main`。
- 本轮文档之前的代码提交是 `d860f601`（上游语言适配、默认中文）；本轮文档提交号读取 Git 最新记录。
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

已存在 Node/WebSocket 房间、去重/确认/持久化基础，本地档案与备份，B1 局部纯规则，B2 效果/RNG 状态组件，首批上游中英语言适配。已有测试共 63 项通过的历史记录。

**原游戏尚未接入完整合作战斗。** `/` 是原单人；`/coop.html` 是隔离实验页。`server/coop-service.mjs` 仍导入 `src/coop/engine.mjs`，不能把这套有限规则当原版运行器。完整精灵、全部随机流、决策状态、实际客户端模型 ACK、原 UI 联机与原版合作收藏仍待实现。

本轮只整理了文档与开发顺序，未新增正式协议类型/校验器或改变运行时代码。下一批不要误认为接口已编码。

## 下一项可执行任务：M1

1. 梳理服务的身份、输入、回执、屏障和持久化；先列当前协议与正式契约的映射/差异。
2. 建立共享版本/消息契约与运行时校验，预留原版运行器、检查点、模型应用/提取和本地授予接口。缺少实现时明确拒绝，不假成功。
3. 复用真实 WebSocket 测试框架，启动两个独立客户端，覆盖版本、身份、去重/过期包、连接替换、当前模型确认屏障与恢复。测试适配器仅证明协议；原版模型覆盖从 M2 逐步加入。
4. 保持 `/` 与隔离实验页现有行为。完成后更新 SPEC 和模块进度，再继续 M2 的完整状态切片及双端恢复差分。

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

> 在 E:\pokeregue\pokerogue-early 继续开发。先读 SPEC.md、docs/coop-architecture-2026-10-13.md、docs/coop-development-plan.md 和 docs/DEVELOPMENT-HANDOFF.md，并检查工作区变化。从 M1“正式联机契约、适配接口与真实 WebSocket 双客户端测试入口”开始，再逐步接 M2 完整检查点。架构为 Node.js 权威结算，不是浏览器 P2P；接口先行，单端原版差分与双端恢复测试同时推进。保留 early 原规则、原图鉴和本地局外收藏，扩展优先移植上游；不重写简化游戏，不动 E:\pokeregue\pokerogue 的未上传内容。每批次更新模块进度与验证证据，区分文档、接口、运行器、UI 和双机验收的完成状态。
