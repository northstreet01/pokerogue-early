# M3 原持久道具领取与更新

本批接续个人奖励效果。HEAD `5c9f3e34`，保留此前全部未提交修改，未提交／未推送；仅在 early 开发，实时远端未核对。

## 实际范围

适配测试链路已直接执行原持久道具领取、原 add／incrementStack、原最大堆叠检查和原 updateModifiers／updatePartyForModifiers。持有物归操作席所选个人队员；全局道具归本人 modifiers。维生素通过原 Pokemon.calculateStats 实际重算能力值和 HP。领取与资源／个人菜单标志同一候选保存，恢复和重复回执不重复叠层。

满栈持有物由原 selectFilter 拒绝；可领取的满栈全局道具沿原 addModifier 的同品质默认奖励路径替代。测试用满栈 GOLDEN_POKEBALL 验证保留原三层、本人获得原 ULTRA_BALL 五个，伙伴资源不变。两个分支没有另写上限或替代规则。

当前允许常规全局加成、持有物、维生素／属性增强／树果／临时能力加成等获取。代表差分覆盖 EXP_CHARM、HEALING_CHARM、EXP_SHARE、GOLDEN_POKEBALL、AMULET_COIN、LUCKY_EGG、BASE_STAT_BOOSTER、ATTACK_TYPE_BOOSTER、BERRY、TEMP_STAT_BOOSTER、SOUL_DEW。其余已允许类型见测试 effects driver；允许领取不等于所有对应战斗机制已验收。测试目录和显式奖励选项是分支夹具，不是产品种类限制。

## 复用与适配

| 来源 | 本批复用 | 适配与边界 |
| --- | --- | --- |
| early SelectModifierPhase 的原选择回调、BattleScene.addModifier | 前批命名回调直接恢复，整个原 addModifier 方法继续调用，包含持久道具分支和满栈递归替代 | 本批没有改写原方法体；不重新 start 旧菜单，不通过 M2 测试效果再次发物或扣款 |
| early modifier.ts／modifier-type.ts | 原工厂、筛选、PersistentModifier.add／incrementStack／上限、持有物原实例 | 持有物筛选需要 pokemon.scene，纯校验在独立原模型副本上绑定既有个人场景后调用，不给输入模型挂 scene、不消费 RNG |
| 原 BattleScene 更新方法与 Pokemon.calculateStats | 直接共用战后 driver 已解析的原 findModifiers／removeModifier／updateModifiers／updatePartyForModifiers 及冻结原版方法 | 新增共享绑定函数，展示条仅 hook；updateInfo 异步任务由既有任务观察器等待并记录失败，无永久统计／收藏写入 |
| 既有 M1/M2、preparation effects runner、codec、私有视图和 WS harness | 独立候选、个人资源、原类恢复、双端 ACK、去重、输入先落盘及结果后发布 | 本人新道具会改变组件索引，保护检查改为去除本人资源的投影按实际内容比较；伙伴／敌方／蛋／队列不变，并保护 roster 可变对象共享分组，禁止跨席别名注入 |
| 原规则 VM 测试设施 | 原维生素的 instanceof Array 检查继续执行 | 原目录 baseStats 和 codec 数组来自宿主 VM，向 modifier 测试 VM 绑定同一 Array 构造器，修正跨 VM 类型不一致；没有修改生产公式或用假筛选替代原规则。明确断言 maxHP 增长，避免只检查道具层数 |

未移植另一套道具、奖励或房间系统，因为 early 原实现及当前基础可以直接复用。此前 pokerogue 副本未操作。

## 验证

本批新增 **26 项**（18 单端、8 真实双端 WS）。定向 41 项通过（包含前批 15 项消耗品效果）；最终完整串行回归 **491/491**（约 511 秒）、`npm run typecheck`、`npm run build`、`git diff --check` 及新增文件空白检查均通过。构建仅有既有混合导入／大包警告，原实验整备测试完整保留。

- 原冻结回调／addModifier／更新方法连续执行，与当前 JSON 恢复后执行逐字段一致；原堆叠、满栈替代和维生素实际能力值变化。
- 已获得原治疗加成作用于后续原药水，原金钱加成作用于受控下一奖励；GOLDEN_POKEBALL 作用于单独调用的下次原菜单。后两项是后续效果／菜单提供者验证，不代表 NewBattle 已接通。
- 纯筛选拒绝外席和满栈目标，原输入不挂 scene、菜单和 RNG 不变；本人新增组件后伙伴投影、原类恢复保持。
- 原 updateInfo 失败、伙伴道具／HP 越权修改或跨席可变数组别名注入不能发布候选。
- WS 两席分别领取后重启、重复回执、维生素／满栈替代的结果写盘失败、已收输入重启后只生效一次、原更新任务失败后修复恢复、非法目标接收前拒绝、单 ACK 屏障和两房间隔离。

所有用例使用合成模型、内存存储与随机 loopback 端口，不读取真实存档／房间／令牌，不占用 8020。日志在系统临时目录；node_modules／dist／临时输出不纳入提交。

```powershell
node --test --test-concurrency=1 --test-reporter=tap tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs
npm run typecheck
npm run build
git diff --check
```

## 剩余与下一批

下一批优先接原成长奖励引发的 LevelUp／学招／进化子决策，并复用已有 M2 停点与升级 runner，再接原 NewBattle／遭遇到下一战真实行动输入。糖果、TM／回忆、进化／融合、道具转移／备用换队、自动奖励与特殊战后仍未完整接入。本批不把取得持久道具写成所有持有物机制完成。

M3 仍有战后闭环、非 FIGHT、复杂机制、生产运行器四类；完整创建／孵化和 M6 原子消费蛋／收藏仍待接，保留 hatch-commit。券归属及敌我同时全倒下最终顺序仍未确认。RNG 只验收同房间既定持久化顺序的恢复，个人独立随机流及生产全 RNG 未验收。PLAY-15 继续排除三种合作诱饵。正式 `/coop/v1/ws` 默认仍 ADAPTER_UNAVAILABLE，测试 driver 不挂生产；`/` 与 `/coop.html` 保留各自入口。

用户要求：每批完成的回复都说明实际完成与验证，并明确下一步要开发什么。
