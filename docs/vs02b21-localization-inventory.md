2026-10-25 VS23最终覆盖：源码/测试8ba311f8完整1402/1402退出0。TM/进化道具及整备本人队伍重新开启进化的中英入口已接，原目录ID、存档与N/P标记保留，原UNPAUSE消息复用。真实双端/排版待验；下面进行中和旧未接说明为当时状态。见[最终验收](mvp-vs-02b23-growth-items-review.md)。

2026-10-25 VS23补充（完整回归进行中）：原TM/进化道具入口和整备期本人队伍重新开启进化已接，新增中英coop:personalParty、coop:resumeEvolutionSubmitted，更新两种语言coopPausePrompt说明整备入口。原TM名字、招式N/P标记、目录ID和存档结构未改；原UNPAUSE消息继续沿用partyUiHandler资源。见[VS23验收](mvp-vs-02b23-growth-items-review.md)和[双端手测](vs02b23-manual-acceptance.md)。真实双浏览器和英文长文排版仍待验，下方旧“未接”均对应当时基线。

# VS21 中文迁移清单

本清单覆盖用户实际可进入的路径，不以几处按钮替换作为全面完成。冻结源码83ae8614完整回归1314/1314通过；真实双浏览器尚未验收。中文默认沿用prLang；英文仍可选，中文不写入catalogId、个人存档或客户端行动ID。

沿用early已有src/i18n.ts、src/system/localized-catalog.ts、locales/en、locales/zh-Hans及原ui/text。既有资源来源和AGPL-3.0参考记录见[07文字来源](mvp-vs-02b07-ui-text.md)。本批新增PokeAPI固定提交的中文描述对照，见[来源与许可](early-catalog-translation-sources.md)及[逐条清单](early-catalog-translation-sources.json)；没有读取或修改另一份pokerogue工作树。原版早期数值与现代文案不一致时，提供early语义显示覆盖，不能修改规则来迁就译文。

| 路径 | 代码/资源来源 | 当前情况及缺口 | 验证要求 |
|---|---|---|---|
| 首页、单人入口与联机入口 | home-phase、home/title资源 | 原i18n及可达存档/入口错误已补查，标题台词按原索引翻译 | Home/只读资料/返回与英文切换；真实浏览器待验 |
| 局外收藏、蛋列表、扭蛋 | GameData、EggList/Gacha、原资源 | 原界面复用，仍需核对券名与异常文案 | 只读存档字节不变、空/旧/损坏资料 |
| 大厅、选队同步、恢复、退出 | coop/play-phase、play/exit页面 | 多处硬编码中文和少量英文术语，尚未全部迁移资源 | 两席独立消息、旧回调、宽窄窗口 |
| Starter与详情 | 原Starter、物种/招式/性格资源 | 名字与说明目录已清点，伙伴解锁、蛋招式及Starter改招提示已迁移 | 中英文长名、N/P标记、ID不变；真实排版待验 |
| Command/Fight/Target/Ball | 原UI、原战斗资源 | 已有键，球名/剩余数/帮助文本需补查 | 原输入、返回、非法/迟到行动 |
| Party/Summary、携带道具 | 原UI、modifier-type | 已接显示专用名字和描述；原name、codec和ID不变；全静态及实际工厂变种中英文自动覆盖 | 真实窗口排版待验 |
| 常规战斗/训练家对话 | 原Phase、battle/trainer/abilityTrigger等 | 已迁移常规状态/特性/招式附效/天气/场地，非Boss训练家标题及全部实际支持对白；服务端记录原i18n key/参数来源，浏览器重渲染，不反查整句英文 | 自然Worker消息、本人问句隔离；Boss对白仍在未接机制范围 |
| 招式/特性/状态/能力阶级 | localized-catalog、status-effect、battle-stat、原资源 | 全目录名称与说明CJK审计通过；961条early描述补齐，英文严格匹配保护保留；原状态/能力文字复用 | 不改变数值/条件；原数据序列化、N/P标记不变 |
| 免费奖励/付费商品/重抽/目标/错误 | ModifierType、原ModifierSelect/Party | 共享库存/跳过新增coop资源；全部静态商品与生成变种显示已迁移；商店旧索引不变 | 原价格/实际扣款、个人钱包、并发抢同项及故障重启 |
| HP/EXP、升级能力值、学招、进化 | BattleInfo、BattleMessage、原Phase/Evolution | 原UI已接；新增evolutionPhase资源和成长结构化消息，原学招资源及必要确认已接 | 原双页、原进化场景、取消/退出、模型不重算；真实音画待验 |
| Summary性格/相遇、经验标签与统计 | 原Summary、Nature、GameStats | 已补原BBCode中文、原相遇字段、EXP/下级标签；35项统计按原稳定key翻译，读取不改存档 | 原统计真实updateStats及只读事实校验；浏览器排版待验 |
| 标题台词、存档错误与满层替代 | 原Title、GameData、BattleScene | 30条原目录台词、旧存档/导入错误、道具满层原回调提示、Starter改招已补中文；原英文与存档处理不变 | 原目录英文逐项不变、实际满层消费及旧保存失败保护 |

HP、EXP、PP、Lv.、数字、版本/物种/行动ID、随机人名和原开发日志属于合法缩写、专名或工程数据，不按英文漏译处理。未接通机制（融合、转移、特殊遭遇和Boss对白）仍明确不可用；其可见候选名称/说明已纳入目录检查，不把候选可读当机制已接通。联机外围一些状态/错误解释原本硬编码中文，英文模式仍显示中文；这属于英文资源统一的剩余工作，不能宣称全界面双语已完成。真实浏览器的长文裁切、中文字体和音画时序仍待用户实测。
