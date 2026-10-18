# OUT-02A 交付说明：占位符提取纯函数

## 任务与状态

- 任务：OUT-02A，仅完成 `extractPlaceholders(text)` 纯函数及固定样例测试。
- 状态：**OUT-02A 已通过维护者独立验收**，见 [验收记录](OUT-02A-acceptance-2026-10-17.md)。完整 OUT-02 尚未完成，本交付不代表 OUT-02 或 OUT-02B 已验收；尚未合入 main、未推送。
- 本轮未实现：`checkLocalePlaceholders`、语言目录扫描、语言文件配对、JSON 比较、问题报告、CLI 及退出码。

## 基线与变更

- 基线完整 SHA：`51de6356df27a32c91f083ee0f4c1d161cde6602`
- 工作分支：`outsourcing/out-02a-placeholders`
- 运行环境：Node.js v24.15.0；未安装依赖，未使用 npm。
- 实际变更文件（仅此三个，均为新增）：

```text
scripts/outsourcing/check-locale-placeholders.mjs
tests/outsourcing-locale-placeholders.test.mjs
docs/outsourcing/OUT-02-delivery.md
```

- 实现提交完整 SHA：见交付消息（本文件随实现提交一起提交，无法写入自身哈希）。

## 实现内容与明确不支持的格式

- 输入必须是原始字符串；`null`、`undefined`、数字、对象、数组等非字符串抛 `TypeError`，不做隐式转换。
- 返回普通对象，只有 `variables` 与 `malformed` 两个字段；`variables` 去重后按 JavaScript 默认字符串顺序排序，区分大小写。
- 支持 `{{name}}`、`{{ name }}`、`{{- name}}`、`{{count, number}}`，空白可变化；格式名称不进入变量集合。
- 变量名只接受 `[A-Za-z_][A-Za-z0-9_.]*`（如 `user.name`、`item_id`）；格式名只接受 `[A-Za-z_][A-Za-z0-9_]*`；不解析格式函数、括号或表达式。
- 未被合法占位符匹配消耗的 `{{` 或 `}}` 令 `malformed` 为 `true`，同时仍返回其他成功识别的变量名。
- 每次调用新建正则、返回新数组，没有模块级游标或共享结果；模块 import 不读写文件、不联网、不使用 `eval`／动态函数／i18next，也不依赖全局状态。
- 明确不支持：目录扫描、JSON 解析与类型比较、语言文件缺失／损坏报告、`PLACEHOLDER_MISMATCH`、`UNPARSED_INTERPOLATION`、CLI 参数与 0／1／2 退出码；这些属于 OUT-02B，本轮未实现。

## 实际执行与结果

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `node --test tests/outsourcing-locale-placeholders.test.mjs` | 0 | tests 15，pass 15，fail 0，cancelled 0，skipped 0，todo 0（约 136ms） |
| `git diff --check` | 0 | 无输出 |
| `git status --short` | 0 | 提交前仅显示本任务三个新增文件，见下 |

提交前 `git status --short` 输出：

```text
?? docs/outsourcing/OUT-02-delivery.md
?? scripts/outsourcing/
?? tests/outsourcing-locale-placeholders.test.mjs
```

（`scripts/outsourcing/` 下只有本任务新增的 `check-locale-placeholders.mjs`；使用 `git status --short --untracked-files=all` 可看到该文件全路径。）

测试用例为任务书表格中的 13 个固定样例，加两组补充测试（非字符串抛错；重复／穿插调用结果稳定且不共享返回数组），共 15 项。期望值全部直接写在测试文件中，未由实现生成。

## 复现命令

```powershell
node --test tests/outsourcing-locale-placeholders.test.mjs
git diff --check
git status --short
```

## 已知问题与未完成项

维护者于 2026-10-17 复核原交付提交 `e3c840f8a788099afa3665140940b9a323dd499c`，20 项（交付 15＋既有语言 5）、额外 16 组文本／5 类输入及结果隔离、类型与空白检查通过。下列“自测”段落保留为原交付历史；完整结论及当前合入状态以独立验收记录为准。

- 自测未发现失败；没有放宽或改写任务书期望值。
- 按任务书要求停止在 A 阶段，未做真实语言文件扫描、真实数据检查或报告生成；B 阶段应复用本函数，不另造一份占位符规则。
- 本轮只修改上述三个文件，未改 `src/`、`server/`、`locales/`、`public/`、`package.json`、锁文件或主交接文档；未提交其他文件，未推送、未合并主线。

## OUT-02B1：两字符串占位符比较

### 任务与状态

- 任务：OUT-02B1，仅新增 `comparePlaceholderStrings(english, chinese)` 及固定测试；保留 A 的实现与 15 项测试。
- 状态：**B1 已通过维护者独立验收**，见 [B1 记录](OUT-02B1-acceptance-2026-10-17.md)，尚未合入 main、未推送；完整 OUT-02 仍未完成（后续结构比较、文件扫描、报告与 CLI 未开始）。OUT-02A 已由维护者验收，见 [验收记录](OUT-02A-acceptance-2026-10-17.md)。
- 本轮未实现：JSON 递归比较、文件／目录扫描、语言文件配对、完整报告、CLI 及退出码；未新增文件。

### 基线与变更

- 基线完整 SHA：`5c67d745248d1146b4d2f06ed89ffb6c53e501a5`（包含 A 交付 `e3c840f8` 与本任务书；A 交付未合入 main）。
- 工作分支：`outsourcing/out-02b1-string-compare`
- 运行环境：Node.js v24.15.0；未安装依赖，未使用 npm。
- 实际变更文件（仅三个已有文件，未新增）：

```text
scripts/outsourcing/check-locale-placeholders.mjs
tests/outsourcing-locale-placeholders.test.mjs
docs/outsourcing/OUT-02-delivery.md
```

- 实现提交完整 SHA：见交付消息（本文件随实现提交一起提交，无法写入自身哈希）。

### 实现内容

- 直接调用 A 的 `extractPlaceholders`，未复制或修改 A 的占位符正则与识别规则。
- 两个输入都必须是原始字符串，否则抛 `TypeError`；不做类型转换。
- 英文损坏返回 `{ code: 'UNPARSED_INTERPOLATION', language: 'en' }`，中文损坏返回 `{ code: 'UNPARSED_INTERPOLATION', language: 'zh-Hans' }`；两边都损坏时英文项在前、中文项在后；任一边损坏时只返回损坏项，不再比较变量集合。
- 两边合法且变量集合一致返回 `[]`；集合不同只返回一个 `{ code: 'PLACEHOLDER_MISMATCH', expectedVariables, actualVariables }`，`expectedVariables` 来自英文、`actualVariables` 来自中文，沿用 A 的去重与默认排序。
- 不比较句子内容或出现次数，不附加 `file`／`keyPath` 等上下文字段；每次调用返回独立数组、独立问题对象和独立变量数组；无文件、网络、全局状态或先前结果副作用。
- 明确不支持：JSON、目录扫描、报告与 CLI（后续阶段）。

### 实际执行与结果

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `node --test tests/outsourcing-locale-placeholders.test.mjs` | 0 | tests 28，pass 28，fail 0，cancelled 0，skipped 0，todo 0（约 160ms） |
| `git diff --check` | 0 | 无输出 |
| `git status --short` | 0 | 提交前只显示本任务修改的三个文件，见下 |

提交前 `git status --short` 输出：

```text
 M docs/outsourcing/OUT-02-delivery.md
 M scripts/outsourcing/check-locale-placeholders.mjs
 M tests/outsourcing-locale-placeholders.test.mjs
```

测试为 A 的 15 项加 B1 新增 13 项，共 28 项；期望值全部直接写在测试文件中，未由实现生成。

### 已知问题与未完成项

- 自测未发现失败；未删除或放宽 A 的测试与期望值。
- 只覆盖任务书规定的两字符串比较；JSON 递归、文件／目录扫描、报告与 CLI 属后续阶段，未实现。
- 未改 `src/`、`server/`、`locales/`、`public/`、`package.json`、锁文件、任务书或主交接文档；未新增文件；未推送、未合并 main。

### B1 主维护者独立验收（2026-10-17）

交付 a28801af 的三个文件范围符合要求；28＋既有语言 5 项共 33/33、额外 12 组文本对／10 次异常参数、返回值隔离、A 函数体 AST 比对、类型及空白检查通过，详见 [B1 验收记录](OUT-02B1-acceptance-2026-10-17.md)。仅验收纯函数，未合入 main、未推送。按用户新优先级，语言工具 B2／B3 暂缓，下一项为 MVP-QA-01。
