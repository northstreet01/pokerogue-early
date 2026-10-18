# VS-02B 零代码报告核对与任务范围纠正

日期：2026-10-18。实际 main／代码基线 871c5f183118ad0dea5eb4694ae4f94de6f68d87。报告后工作区干净，没有实现提交，因此本次不做功能验收通过，不新增测试数量。

## 独立核对

- server/start.mjs 和 Vite 默认未注入正式 adapter，coop-play.html 不存在，原个人资料／StarterSelect／行动 UI／outbox 未接。这些主要缺口属实。
- 旧 6617871d 是等价源码来源，不是当前发布 main 的原样祖先。2891f174 汇总发布后，内部 SPEC／任务书已从远端最新树移除，本地忽略保留；不能合并旧评审历史来补祖先。
- 维护者以单次禁用失效代理的只读命令查到实时远端仍为 871c5f18；本机代理失败不是本地开发阻断。不修改全局 Git 配置。
- 没有浏览器自动化 npm 依赖并不自动意味着无法浏览器验收；可用浏览器控制工具或人工隔离档案均需按实际权限使用。确实无法操作时列为待验；不影响纯模型／构造前置代码。

## 纠正

前任务把真实资料、原选队语义、页面、存储、原 BattleScene／行动输入和双浏览器放在同一交付范围，粒度仍过大。范围问题由维护者调整，不能要求执行者假造 UI 或宣称未运行的浏览器通过。

但仅因为完整任务需要较长时间、原页面尚不存在而零代码停止，没有证明不能完成任何前置切片；原任务已经允许交付可审查子集。本次仅接受现状审计，不接受为功能交付，也不将其评为运行器缺陷。

## 收窄后的路线

1. 原选队结果最小 JSON 描述＋原 PlayerPokemon 构造差分；无需页面／账号／WS 接线。
2. 读取本人最小档案镜像，按连接席位持久化完整选择；替代 species-only lobby，保留真实库存来源和版本边界。
3. 原 StarterSelect 与原战斗显示／行动输入，实际双浏览器首战。
4. outbox／刷新续局与普通整备到下一波 UI，逐项收敛连续游玩缺口。

下一实际批只执行第 1 项。已核对 Starter interface／回调、SelectStarterPhase.start、GameData.getSpeciesDexAttrProps／getFormIndex／getFormAttr、BattleScene.addPlayerPokemon 与原 PlayerPokemon／tryPopulateMoveset，以及现有 Worker／construct 失败 RNG 回滚。复用原 getter／工厂与原配招，不重写公式；原单人 Phase 本片保持。

需保留的语义包括 dexAttr 的 bigint 传输、本人该物种 IV、nature、moveset 可选语义、form／ability／gender／shiny／pokerus。特别要在调用原 getFormIndex 前拒绝缺形态位的非法 attr，避免扫描无法终止。不是可信账号或永久授予实现。

## 本次验证与边界

本次只调整任务和工程记录，检查 Git／原调用点／文档链接与空白，不改运行源码、不运行新的回归。935/935 是上一验收源码结果，不是本次新增验证。内部提示词及 SPEC 不提交，不推送；工程记录提交后交给执行者完成实际代码。
