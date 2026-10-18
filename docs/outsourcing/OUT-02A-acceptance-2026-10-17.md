# OUT-02A 独立验收记录

- 日期：2026-10-17；审核：主维护 agent。
- 交付完整 SHA：`e3c840f8a788099afa3665140940b9a323dd499c`。
- 基线完整 SHA：`51de6356df27a32c91f083ee0f4c1d161cde6602`。
- 接手时分支：`outsourcing/out-02a-placeholders`；工作区干净。main 仍为基线，未合并、未推送。
- 验收后在 `review/out-02a-next-task` 单独记录结果和下一项提示词，保留原交付分支；这不等于合入 main。

## 范围与实现审查

`git diff --name-status <BASE>...<DELIVERY>` 仅有三个约定新增文件，181 行：工具 63、测试 52、交付说明 66。未涉及游戏、服务器、资源、语言 JSON、package.json 或锁文件。

实现无 import、无文件或网络操作、无动态求值；每次调用新建 sticky 正则和 Set，返回独立数组。格式名不参与变量集合；变量大小写保留，非法原始输入拒绝，不隐式调用 toString。测试固定期望值与原任务书一致，无删减任务书样例。

## 独立运行结果

| 检查 | 实际结果 |
| --- | --- |
| `node --test tests/outsourcing-locale-placeholders.test.mjs tests/localization.test.mjs` | 退出 0；20/20（交付 15＋既有语言 5），fail 0、skip 0，约 1.5 秒 |
| 独立 `node --input-type=module` 额外断言 | 退出 0；16 组字符串、5 类额外非字符串及结果隔离／严格返回字段检查通过 |
| `npm run typecheck` | 退出 0 |
| `git diff --check <BASE>...<DELIVERY>` | 退出 0 |
| 测试前后 Git 状态 | 均干净；未修改真实语言或业务文件 |

额外文本覆盖：多空白／换行、不转义前缀、带点与下划线变量、合法格式名、格式函数拒绝、非法格式名、空格式名、重复变量、损坏表达式前后仍能提取合法变量、杂散闭合括号、单个大括号、普通 `$t(...)` 文本。额外类型包括 boolean、Symbol、BigInt、String 对象和带有危险 toString 的对象；均按契约抛 TypeError，没有触发转换。

另外保留第一次返回对象，交错执行其他输入后比对原结果；修改另一次返回的变量数组后再次调用，结果仍独立。测试期望手写，不用被测函数生成期望。

## 结论与边界

**OUT-02A 通过独立验收。** 当前尚未合入 main，未推送；没有修改交付实现或代做下一阶段代码。

仅验收当前约定的简单占位符语法与纯函数；不验收完整 i18next 语法、JSON／目录扫描、问题报告、CLI 或真实语言资源完整性。游戏 M3／M4／M5 状态不变，不因此放行 MVP。

下一项缩为 OUT-02B1 两字符串比较，继续复用 A。B1 完成后仍须独立验收，B2 结构比较与 B3 文件扫描／CLI 尚未安排。
