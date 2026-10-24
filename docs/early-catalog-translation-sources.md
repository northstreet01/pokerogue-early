# Early 招式与特性说明来源

本批只补显示资源，原招式/特性的ID、英文原字段、数值、条件、N/P标记及规则实现不变。已有中文名称与现代描述资源继续沿用[VS07来源记录](mvp-vs-02b07-ui-text.md)。现代英文与early英文不匹配时，不直接使用其中文说明。

审计发现701条招式说明、260条特性说明回退英文。新增locales/en/early-catalog.json和locales/zh-Hans/early-catalog.json共961项：848项从PokeAPI同ID、同版本组的英文/简体中文成对提取；只允许空白和直弯引号归一化后英文完全一致。其余81条招式、32条特性由维护者按保留的early英文翻译，逐项标为maintainer translation。THIEF/COVET的30%及DYNAMAX_CANNON对等级高于200目标的加倍条件保留early语义，未套现代描述。

外部只读参考为[PokeAPI/pokeapi提交2bf639e](https://github.com/PokeAPI/pokeapi/tree/2bf639e5572812a67d2b94903fdcb9d095f5aeb2)。只读取data/v2/csv/move_flavor_text.csv、ability_flavor_text.csv、languages.csv和LICENSE.md；语言ID9为英文、12为简体中文。原始文件保留在ignored build/ref-pokeapi-2bf639e，不修改另一份pokerogue目录。

文件SHA256、每条目录ID/枚举名/字段/版本组和英文/中文摘要见[逐条机器可读清单](early-catalog-translation-sources.json)。完整源许可原样保存在[public/licenses/pokeapi.txt](../public/licenses/pokeapi.txt)，生产构建随public目录分发。原项目的AGPL许可不变。

自动验收检查全部原目录的中文名称/说明、英文归一化一致、原目录对象序列化不变，以及961条资源摘要和源许可摘要。清单中的versionGroup只说明译文配对来源，不替换early的战斗规则版本。未实现招式的占位说明明确写“占位数据（未实现）”，未移除实现状态标记。
