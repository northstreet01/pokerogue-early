# VS-02B-07 维护者验收（2026-10-19）

## 结论和实际起点

**A 文字基础、B 合作入口布局均部分通过；浏览器视觉及 Potion 原 Party 操作待用户验收。** 本批没有逐菜单重做布局，没有新玩法，不代表完整 M3／M4／M5／M6 或 MVP 上线通过。

独立核对时：交付分支 `feature/vs-02b07-ui-text`，HEAD `e29df197da1dcf9208839290e980cd98d225b532`，工作区干净、单一 worktree；没有遗留未提交开发文件。A `03264b78fc2d661e1545cb4e7faf0615cd78f41a` → B `0104af0c42ff3eb125bd257e387cb7650e537182` → 文档 `e29df197…` 连续依赖，父基线 `86798227ca995c4ff40043b99a0c6846ed177154`。本地 main／origin/main 和重新查询的实时远端 main 均为该基线；未以报告替代 Git 核对。

原交付仅五文件：`src/ui/text.ts`、`coop-play.html`、交接、模块计划、本批记录。未发现夹带规则／输入／codec 修改、断言弱化、skip 或冻结 fixture 变更。维护者在独立本地 `review/vs02b07-ui-text-fix` 修订；main 不变，不合并、不推送。旧评审历史不重新引入公开 main。

## 生产路径和范围

普通原 UI 仍从 `addTextObject`／`addBBCodeTextObject` 使用 early TextStyle、6 倍画布和原颜色。CJK 字号、阴影、padding、advanced wrap 为共用度量调整，英文字号保留但默认阴影变化。`setTextStyle` 是尚无生产调用者的工具，不代表现有菜单动态切换语言已接入。

B 只有合作页顶部、控制区及窄窗 CSS 调整；没有逐一实现原 StarterSelect／ModifierSelect／Party／BattleInfo 容器的重新排版，不能把“共用字号变小”当每个原菜单的视觉验收。`/`、`/coop.html`、`/coop-play.html` 仍独立。本批未改正式服务、native Worker、奖励规则、个人模型 apply→capture、ACK 或 outbox；这些依赖保持上一基线，本次没有把历史双浏览器结果列作新结果。

## 直接修复

1. 合作入口缺少原字体注册：`index.html` 的 @font-face 不会自动在另一 HTML 生效；main 中 `document.fonts.load` 也不能注册字体。补 `/fonts/pokemon-emerald-pro.ttf` 与 `/fonts/pkmnems.ttf` 的原本地声明，沿用已有资源，无外部字体下载。中文回退依赖用户系统，未打包 Noto 字体，实际字形仍待测。
2. Phaser 3.70 的 `Text.setStyle` 更新 TextStyle，不更新 Text 自身的 padding／lineSpacing。补 `setPadding`、统一显式行距和默认行距，包括合法 `lineSpacing:0`；普通中文由实际 5 修至交付声称的 6，BBCode 中文默认 8，英文保留 5／10。原交付“普通行距已6”的历史描述已追加更正。
3. 窄窗长错误信息允许断行，底部原控制区允许换行，避免单行挤出可用宽度；最终视觉效果待用户验证。
4. 用户启动清单补 `build:coop-runtime` 和隔离的实验数据目录，避免依赖已有 Worker bundle。原交付未执行的浏览器步骤继续保留。

增加三个文字 helper 回归，执行真实 TypeScript 工具函数，按已核对 Phaser 的对象／TextStyle 边界模拟渲染端口，覆盖复用对象与新建的一致性、显式零／自定义行距与换行回调、resolvedLanguage 回退一致性。它们不是 Canvas 视觉测试；未添加 CSS 数值镜像测试。

## 来源复核

通过官方 GitHub commit API 查询完整 SHA／日期／变更文件，参考结果仅保存在 ignored `build/vs02b07-review/`，未修改源目录。

- [6d9c6b425d9a99a714b43f2dbe762f9a66c9236c](https://github.com/pagefaultgames/pokerogue/commit/6d9c6b425d9a99a714b43f2dbe762f9a66c9236c)，2026-10-11：实际修复 Ideographic Space／ZWSP，涉及 text、message handler、text-wrap。本批没有移植其专用 callback；只适配语言／场景度量及 Phaser advanced wrap，不能声称该修复已经落地。
- [1c1d63a50f00630e506f447aece8e6d55a185346](https://github.com/pagefaultgames/pokerogue/commit/1c1d63a50f00630e506f447aece8e6d55a185346)，2026-10-02：提交本身引入 tutorial speaker box，并非交付所写的变化前基线。
- `1174d9f35fa350645a74244f6e55495aa6c4eedf` 是参考仓库可见上游点；SPEC 中 early 固定基线是 `ec9365a8bffd8fa0dc050e71ef3eb177e63bc1e9`，二者不能混称。

原源码／early 均 AGPL-3.0。保留原许可证；本批没有整套复制新版 globalScene、PhaseManager、设置系统、现代规则或依赖。新版说话者结构、特殊空格 callback 没有移植，原因是本批仅共用度量和入口收敛，尚未进行消息容器适配；这一缺口明确保留，不能算已完成复用。

## 独立验证

- `node --test --test-concurrency=1 --test-reporter=tap tests/localization.test.mjs tests/coop-play-entry.test.mjs`：退出0，正常 `1..35`，35通过，失败／取消／跳过／todo均0，15335.5002ms。
- 最终 `npm run typecheck`：退出0。
- 最终 `npm run build`：退出0，1m45s，既有 chunk 大小警告。
- 完整串行回归：本次未运行。仅文字 helper／HTML CSS 修改，采用相关定向及类型／生产构建；历史992项不属于本次结果。
- 双浏览器视觉、约800px窄窗、中文／英文长文本、Potion 取消重选／本人HP、刷新不重授予／下一战 FIGHT：本次均未执行，交用户按 [清单](mvp-vs-02b07-ui-text.md#用户浏览器验收清单待用户执行) 验收。没有使用 WS 模拟或函数端口回归冒充浏览器结果。

日志、退出码和最终三个源码／测试 blob 清单保存在 ignored `build/vs02b07-review/`。提交后按 blob 比对，不把文档提交时间替代源码一致证据；最终本地评审 SHA 由维护者交付报告给出。

## 下一批与停点

已有双端 FIGHT／整备／下一战有限闭环继续保留，球补给已具历史浏览器证据，Potion 原 UI 仍待用户。捕获、战斗内主动换人、本局备用、战后换队仍缺；普通奖励其它分支、购物／重抽／成长也未接，不降低 MVP 范围。

下一批只推进战斗内普通主动换人：A 正式 native／双 WS 事务链，B 原 Command→本人 Party→意图→原模型→后续 FIGHT。浏览器可由用户测试，不再以扩充外围测试／重复追随机奖励替代主链。详细任务书保存在本地 ignored `docs/AGENT-VS-02B-08-PROMPT.md`。UI 后续按用户实测界面与尺寸定点修，不因本次部分验收就认定观感问题已关闭。

维护者完成可定位修复、文档与提交后停止；不实施下一整批、不创建或联系其他 agent。
