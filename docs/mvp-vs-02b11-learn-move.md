# VS-02B-11：升级学招正式链路（A/B 代码部分完成，验证不足）

日期：2026-10-21。基线：`2c66bd32b12e56fd0180fcbe85d2e260b3c1f742`（源码基点 `7e1ad8c3`），分支 `feature/vs02b11-learn-move`；本地／实时 main 仍 `86798227ca995c4ff40043b99a0c6846ed177154`。本批只接普通升级学招，不扩进化、永久收藏、购物或孵化。

## 实际完成

### A 提交 `985d4e86`

- `runNativeUntilBoundary` 识别原 `LearnMovePhase`：
  - 已会：原 phase 直接结束。
  - 有空槽：原 `LearnMovePhase.start` 的 `setMove` 分支执行。
  - 满四招：**不启动**原确认 UI，保存原 `LearnMovePhase` 为 `currentPhase(remaining='learn-apply')`，用 `createLearnDecision` 生成一席的稳定 `pokemonId/moveId` 与 slot/null options。
- 复用原 `forgetMove` 回调：`chooseNativeProgression` 调用既有 `advanceProgressionChoice`／`resumeLearning`，选择 slot 走原 `forgetMove`，null 结束原 phase；随后原队列继续。
- 纯校验 `progressionContext` 检查保存 phase 类型、scope、personal partyMemberIndex、decision owner/moveId；`native-validate-progression` 不执行。
- 正式 adapter 增加 `learn-move` 的 describe/validate/advance 路由；Worker host 允许 `native-progression`、`native-validate-progression`。
- `projectNativeSnapshot` 补 `personal.decision.learn`，客户端显示副本能读到 pokemonId/moveId。

### B 提交 `e568e4e8`

- `openDecisionInput` 识别 learn-move，优先打开原 `Mode.CONFIRM`，确认后打开原 `Mode.SUMMARY`＋`SummaryUiMode.LEARN_MOVE`。
- 使用本人 codec 显示副本与原四招/新招；只提交稳定 `pokemonId` 和服务器 slot/null；不调用本地 `setMove`。
- 走既有 outbox/receipt/ACK/epoch/revision 门控；收到 learn 动作后关闭菜单。
- 未实现额外的本地 Summary 编辑或新 HTML 结算面板。

## 实际验证与失败边界

- `tests/battle-core-level-up.test.mjs`＋`battle-core-learn-state.test.mjs` **18/18 通过**（约 15.4s）；这些是既有测试 driver，不是生产 native 证据。
- `npm run typecheck` 退出 0；`npm run build:coop-runtime` 退出 0；`npm run build` 退出 0（最终约 48.55s，既有警告）。
- 完整串行回归：`1..1046`，pass **1046**，fail／cancelled／skipped／todo 均 0，`1071437.5483ms`（约 17m51s）；运行时 HEAD `51ee4ea1`。detached 进程未捕获 shell 退出码，TAP 无失败，不伪造 exit 0。该全套只覆盖既有测试，**没有新增生产 LearnMove 用例**，不能当作本批 A 通过。
- **没有完成**：
  - 从真实普通战斗经验自然触发 LevelUp→LearnMove 的生产 Worker 用例；
  - 满四招替换/放弃的正式双 WS／FormalRoomStore、落盘失败重试、同目录重启、去重、房间隔离；
  - 新招实际 FIGHT；
  - 原 Confirm/Summary UI 的自动交互测试和双浏览器验收。
- 因此 A 只能算“代码接入与类型/构建通过的可审查子集”，**不能算生产链路通过**；B 也不能算 UI 完成。

## 已知风险

- `LearnMovePhase` 自动分支的 `initMoveAnim`／原 UI 端口在 headless native 中尚未实际跑通验证；可能还需要显示端口。
- `LevelUpPhase` 在学招后可能排队 `EvolutionPhase`；本批没有接进化，遇到时会按 native 不支持阶段失败，不能自动取消或吞掉。
- `advanceProgressionChoice` 的 `forgetMove` resume 目前只有测试 driver 证据；生产 Worker 未验证。
- `projectNativeSnapshot` 的 learn 字段是刚补的，没有生产快照测试。

## 用户待测（未执行）

本批没有可交给用户的双浏览器成功路径；在上述生产用例完成前不要按“学招已完成”测试。后续至少需要：
1. 真实战斗自然升级到可学招；
2. 满四招原 Confirm→Summary 选择替换/放弃；
3. 刷新/重启后原四招与待学招一致；
4. 新招实际 FIGHT；
5. 失败/拒绝/outbox 写盘失败恢复。

## 共同缺口

- 生产级 LevelUp/LearnMove 原生测试、正式双 WS、重启/去重/房间隔离。
- 进化边界、永久收藏 M6、完整成长子决策。
- 完整回归未跑；不能沿用历史 1046 或 1006。

工作区在本记录前只有本批源码修改；未合并、未推送。

## 维护者后续复验
原交付失败和未执行情况保留。维护者已直接修复生产阻断并补真实Worker及正式WS学招事务，准确范围、失败历史和最终验证见 [VS-02B-11维护者记录](mvp-vs-02b11-review.md)。上文‘完整回归未跑’是早期残留，与交付新增1046项记录冲突；其实际历史是TAP1046无失败但未捕获shell退出码，且无新增生产学招用例。当前自然触发链仍未关闭，不能把合成起点验证写成全部A通过；浏览器待用户。
