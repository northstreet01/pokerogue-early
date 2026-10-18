# OUT-02B1 独立验收记录

- 日期：2026-10-17；审核：主维护 agent。
- 交付完整 SHA：`a28801af6ea7067acede144d4cebab76b8fb4d2f`。
- 基线完整 SHA：`5c67d745248d1146b4d2f06ed89ffb6c53e501a5`。
- 接手时分支：`outsourcing/out-02b1-string-compare`，工作区干净；main 仍为 `51de6356`，未合入、未推送。
- 评审文档另存 `review/out-02b1-mvp-qa`，保留交付分支。此分支记录不是 main 合并。

## 范围和代码

相对实际基线只修改约定三个文件，无新增文件：交付说明 +56；工具 +40/-2；测试 +105/-1，合计 +201/-3。未涉及生产源码、语言／资源、依赖或配置。

直接复用 `extractPlaceholders`，没有新增正则。用现有 TypeScript AST 读取交付前后 `extractPlaceholders` 和 `createPlaceholderPattern` 的声明，规范化换行后函数体一致；原 15 项测试保留。B1 先检查双方原始字符串类型，再提取；损坏项优先且顺序固定，合法集合比较保持方向。返回对象和变量数组独立，模块无 IO 或执行副作用。

## 实际独立执行

| 检查 | 结果 |
| --- | --- |
| `node --test tests/outsourcing-locale-placeholders.test.mjs tests/localization.test.mjs` | 退出 0；33/33（交付 28＋既有语言 5），fail／skip 0，约 4.5 秒 |
| 独立 `node --input-type=module` 断言 | 退出 0；12 组额外文本对、5 类异常输入分别放两边共 10 次、返回值隔离，以及 A 函数体比对通过 |
| `npm run typecheck` | 退出 0 |
| `git diff --check <BASE>...<DELIVERY>` | 退出 0 |
| 运行前后工作区 | 均干净，没有业务文件变化 |

额外文本对覆盖：格式名不同而变量相同、点与下划线变量不同、单／双边损坏时压制集合差异、多空白、普通嵌套翻译文本、变量排序／重复／方向、非法变量名。类型检查使用 boolean、Symbol、BigInt、String 对象和禁止隐式转换的对象，左右参数分别验证。保留旧结果、修改另一结果的字段和数组后交错调用，旧结果与新调用均正确。

## 结论和下一步

**OUT-02B1 通过独立验收，未合入 main、未推送。** A／B1 通过只代表两个约定纯函数，完整 OUT-02 的递归 JSON／目录扫描／报告／CLI 仍未完成，不代表全 i18next 语法或语言资源验收。

用户希望增加工作量并直接促进近期 MVP，因此暂停 OUT-02B2／B3，切换到 MVP-QA-01 原生产运行器黑盒边界矩阵与完整回归。主维护者保留规则修复、生产 adapter／私有投影、双端 WS 接线与原 UI 集成责任；不把测试工具挂生产。
