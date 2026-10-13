# 上游语言资源来源

- 来源项目：<https://github.com/pagefaultgames/pokerogue>。
- 本轮使用的原版参考代码树：`d95670171eb71143c1385222c95be97271944baf`，从本地新版 checkout 读取；复制范围没有未提交改动。未声称这是 GitHub 当前最新提交。
- `en/*.json` 与 `zh-Hans/*.json` 复制自上游同名目录，JSON 内容保持一致；仅清理 `en/ability.json` 和 `en/move.json` 共 4 处行尾空白，不补写 early 独有翻译。
- `public/fonts/pokemon-emerald-pro.ttf`、`public/fonts/pkmnems.ttf` 来自同一代码树的 `assets/fonts/`，支持中文字符。
- `src/i18n.ts`、`src/system/language.mjs` 适配上游 i18next 初始化、命名空间、英文回退、插值及 `prLang` 偏好约定。界面调用复用上游语言键。
- 沿用项目 `LICENSE` 及原资源归属；本适配不主张对 Pokémon 及其素材的所有权。

适配差异：固定默认简体中文，只随包带入中英资源，离线初始化不使用远程 HTTP 语言加载和浏览器自动语言检测。早期设置界面增加语言行；切换只保存 `prLang`，刷新后载入，避免自动刷新丢失未保存的回合。

翻译只用于显示，精灵/招式/特性 ID 与原数值保留。招式和特性说明只有在上游英文与 early 原说明相符时才复用对应翻译，否则显示 early 原说明。实现标记 `(N)` / `(P)` 保留。部分旧文字及图片仍待适配，不将当前范围标为完整汉化。
