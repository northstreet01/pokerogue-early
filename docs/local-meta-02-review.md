# 局外第二批：本地档案与迁移基础验收

实施：2026-10-25至26日。用户已授权推进实现。启动基线 `c55c3bf989990b8bd187922fe02fde50e4eea77b`，主实现 `367dc803`，最终源码／测试 `23ef759c4d1531999f7d676d3e7f09a4d641e8dd`。仅 early；没有创建或联系 agent，没有改真实存档、房间、游戏服务或隧道，未合并／推送／部署。

## 结果与范围

本批已实现可调用、可持久化的新档案基础，尚未接入游戏启动／大厅／原单人保存入口。导入模块不会自动打开旧库或迁移资料。当前正常游玩的存档行为保持原样；不能将本批称为局外全部上线、桌面存档已实现或联机成果已入收藏。

新库为 IndexedDB `pokerogue-local-meta` v1、`records` store，与 `pokerogue-early-local` 和 `coop-play-v1` 独立。档案、目录、上一版本备份和写者锁在同一事务处理。任一步失败则整个事务回滚，只有 transaction.oncomplete 才成功返回。

已实现：

- 明确版本的档案与目录校验，原trainer身份与新profileId分离，原系统资料不重算／补奖。
- 旧正式收藏与三个单人槽位复制预检，原始记录保留在isolated，旧实验资料不合入正式收藏；旧槽位标记为归属未确认。
- 迁移预览、摘要校验、持久暂存、重读验证、原子发布和去重记录。发布前崩溃后，可以重新从同源预览取回原暂存方案，不依赖旧窗口内存中的UUID。
- 档案revision CAS、跨窗口租约与token围栏、过期写者拒绝、续租和安全释放。只读操作不创建空档覆盖坏主档。
- 最近5份自动快照、独立保留的首次迁移／导入快照、恢复前当前有效快照。坏主档不会自动顶替好备份，必须显式恢复。
- 完整个人包校验和导入导出；同档覆盖需要持有写者锁与正确revision；余额、蛋和去重账本一起恢复，不取各版本最大值。
- 原 `.prsv` 系统解包与单人档预览、旧 backup v1声明范围的导入。单人单文件无本人系统资料时保持未绑定候选，不伪造收藏。
- `deferredHatches`持久字段与终局类型校验，保留“合作满进度等待终局”的结构；没有实际生成、消费蛋或释放待孵化队列。

## 原版复用与实现入口

| 文件 | 职责／复用 |
|---|---|
| [codec](../src/local-meta/codec.mjs) | 新包／目录结构、JSON边界、大整数可恢复表示、各席本人归属、ledger与待孵化结构；复用正式canonical序列化 |
| [IDB端口](../src/local-meta/idb-store.mjs) | 独立库的同快照读取和原子同步事务，延续原local-save-store先提交后成功原则，不改旧库version |
| [repository](../src/local-meta/repository.mjs) | 迁移／档案／CAS／写者／备份／恢复／活动档案；未接任何网络或grant效果执行 |
| [原资料适配](../src/local-meta/original-save-codec.ts) | 实际原物种、招式、道具、训练家目录及原owned egg codec；复用GameData原reviver／短键转换，不复制收藏更新／伤害／孵化规则 |
| [旧资料入口](../src/local-meta/legacy-source.ts) | 显式只读旧库快照／旧租约检查、偏好捕获、原prsv系统和孤立session预览 |
| [原版测试入口](../tests/fixtures/local-meta-original-entry.mjs) | 独立原运行器构造、原初始化资源、原GameData实际系统序列化与session序列化；仅合成资料 |
| [测试](../tests/local-meta.test.mjs) | 22项新增场景，包含独立压缩版适配器、真正IDB多记录写入后配额异常与事务回滚 |

原适配器没有创建战斗场景实例来执行验证，按需调用原 `initSpecies/initMoves/initAbilities`。其原GameData依赖仍会加载原引擎模块图；轻量repository／IDB／包校验不依赖Phaser。后续大厅应按需加载原适配器，不把它误称为已经拆出的微型纯JSON解析器。

原 `.prsv` wire key没有独立导出，因此新适配器保留同一格式常量，解密仍使用原crypto-js；短键与reviver调用原方法。测试从原GameData导出常量生成实际兼容包再校验，防止两处格式漂移。它是旧文件格式包装，不是在线身份认证。

原SystemSaveData原样保存；GameStats原reviver存在历史默认行为，验证调用后返回未改写的原JSON，避免顺带改玩家统计。未知顶层／包版本与非法目录ID拒绝；原session的复杂summonData／arena tags及道具生成参数作为有界JSON保留，不在本批执行／迁移到联机检查点，不能将原宽松session恢复说成全机制严格恢复。

## 最终验证

最终独立三文件串行：`tests/local-meta.test.mjs tests/local-save.test.mjs tests/coop-profile.test.mjs`，日志 `build/local-meta-02/target-archive-final.tap/.exit`。

**36/36通过，退出0，49986.2974ms**，fail/cancelled/skipped/todo均0；其中22项新增、14项原存档／旧实验事务。旧实验结果不证明正式M6入账。最终测试会单独构建压缩版原资料适配器并作为repository的实际校验端口，不依赖已创建的游戏场景。

- 最终类型检查 `type-standalone` 退出0。其后修订仅为独立repository的.mjs和测试；原适配器等最终TS内容无变化。
- 独立生产Worker入口构建 `runtime-final` 退出0；使用与正式脚本相同的入口、显示端口别名和无测试依赖守门，输出到 `build/local-meta-02/runtime`，没有改写另一窗口使用的 `build/coop-runtime`。
- 生产构建 `build-final` 退出0，50.71秒，`build/local-meta-02/dist`。其入口尚未导入本批新模块，不能把构建成功当成新大厅已经接通。构建后最终改动仅在独立档案模块及其测试；旧生产入口及其依赖相对c55c3bf9无改动。
- 专门的独立压缩版最初失败已保留在 `minified-final.log/.exit`（退出1）；修复后由最终36项中的独立压缩版端口覆盖，未覆盖失败日志或合并计数。

没有重跑旧完整套件或1—200强通，本批不改变战斗链。没有真人浏览器、多设备、系统掉电、文件后端、n2n或真实迁移验收。全部新测试在fake-indexeddb与隔离bundle中执行，不能当作磁盘掉电保证。

## 保留的失败与修订

1. `target-a` 0/15退出1：原引擎循环依赖入口顺序导致DexAttr初始化前访问，改为遵守原BattleScene初始化顺序。
2. `target-b` 1/15退出1：测试构造了原精灵却没有调用原资源初始化，实际序列化缺少球库存；夹具改用原 `initializeRunResources`，不放宽存档必需字段。
3. `target-c` 13/15退出1：两个独立测试环境使用相同伪UUID，且测试给未拥有对应形态的物种填过大属性。改为各环境独立ID，以及原目录最大形态和原getFormAttr产生的合法大整数；不放宽目录位掩码。
4. `target-d` 15/15；扩展并发、配额故障、恢复与坏锁后，候选 `target-e/target-final`各35/35，`target-verified/target-release`各36/36，均为各自独立运行，不能相加或当最终源码结果。
5. `type-a`因测试入口误用.ts位于src之外退出2，改为既有测试约定的.mjs。`type-b`因bigint参数推断与ES2020 Object.hasOwn类型退出2；显式类型和兼容hasOwnProperty修复，后续类型退出0。
6. 独立压缩版加载时目录尚未初始化，原先依赖场景已创建才可校验。显式复用原目录初始化，并把压缩版独立端口加入最终完整定向36项。最终类型重新执行通过。
7. 压缩版修复后 `target-standalone`独立36/36退出0、51058.8397ms。收尾审查发现，较旧本机导入较新同档案且带高revision账本时，简单current+1会使合法账本版本高于包版本。23ef759c改为显式恢复取两者较大版本再+1，并保留receipt原revision；新增同一用例内的合成新设备备份断言，最终重新独立运行 `target-archive-final` 36/36退出0、49986.2974ms。未把前轮数字当修订后结果。

## 后续接入与边界

第二批基础已完成，使用方法与人工门槛见[接口与验收说明](local-meta-02-usage.md)。第三批才接档案选择、迁移预览确认与原风格局外大厅，并绑定原单人读写；不能做出“读新档／仍写旧data”的双轨进度。

新档案锁目前只保护新repository，原单人／正式联机仍使用原保存入口。迁移是显式复制；操作前关闭旧写者，复制后旧入口继续游玩产生的变化不会自动同步到新库。当前正常启动不会自动切换到新档案。

正式联机非空grants、蛋库存跨冒险对账、合作延迟孵化执行、终局释放与原动画、文件存档／桌面发行和主机端点仍留后续批次。已有旧hatch-commit／房间文件不在本批导入范围，原数据没有被删除或重抽。

另一窗口第24批在本批期间继续验收；本批未动其源码／测试、私有构建输出或暂存内容。主交接／计划只追加本批状态，不把第24批未完成过程误写为已验收。SPEC及AGENT/PROMPT本地忽略，证据和构建均不提交。

最终工程审计：7个本批源码／测试blob与23ef759c一致，旧生产源码相对c55c3bf9零差异；17处明确范围文档链接无缺失，本批源码／测试及新验收／接口文档的窄凭据模式无匹配（非绝对隐私保证）。实际退出、日志哈希与最终HEAD记录于本地忽略 `build/local-meta-02/evidence.json`。
