# 局外第一批：原存档与个人资料审计

日期：2026-10-25。状态：第一批审计与设计完成，未实现新的档案、迁移、局外界面或桌面包。用户授权的范围为“审计原版存档和现有个人资料，确定数据结构、归属与迁移方案”。设计详见[本地局外架构与迁移方案](local-meta-architecture.md)。

## 1. 工作基线与并行边界

- 开始时分支 `feature/vs02b21-22-original-completion`，HEAD `38a06514acb4807db3fd9d5f99ecff3d043a6e96`，单 worktree。
- 实时只读远端核对：feature `f102fba96bb0b3ab7f20f9ce3e5c1b7529ee6146`；main `86798227ca995c4ff40043b99a0c6846ed177154`。首次受限网络查询失败，允许权限下重试成功；没有执行推送或更新远端引用。
- 开始时工作区已有第24批未提交修改：`src/battle-core/next-battle-runner.mjs`、`src/battle-scene.ts`、`src/battle.ts`、`src/coop/battle-presentation.ts`、`src/server/native-entry.ts`，以及 next-battle、presentation、forced-progression 的测试与新增 final-boss 测试。进程只读核对发现第24批 `target-b` 测试正在运行。
- 本批不修改这些源码、测试，不切换分支、不停止进程、不重建 runtime。涉及这些文件的存档结论对照已提交 HEAD；第24批后续交付须重新核对相关入口。
- 仅 early 目录；未访问另一份 pokerogue 工作内容，未创建或联系 agent，未读取真实存档、房间内容或凭据。
- 本批工程文件以本批显式提交清单为准；不声称整个共享工作区干净，也不把别的窗口的工作纳入本批。

## 2. 已有模型与复用清单

| 层次／来源 | 已核实内容 | 复用方式与缺口 |
|---|---|---|
| [GameData 系统数据](../src/system/game-data.ts) `SystemSaveData`、`DexEntry` | trainerId/secretId、gender、dexData、初始配招、蛋招、统计、模式与成就解锁、券、蛋、gameVersion/timestamp | 保留原字段和语义，外包一层本地档案标识、版本、revision；不是重写收藏 |
| 同文件 `setPokemonSeen`、`setPokemonCaught`、`setPokemonSpeciesCaught`、`updateSpeciesDexIvs` | 属性位、性格解锁、次数、IV最高值及进化前物种递归；捕获与孵化计数不同 | 后续永久事务调用原方法或提取同一逻辑；不能用一段简化 OR/max 算法取代全部联动 |
| 同文件 `getSpeciesStarterValue` | 原物种基础成本与本人捕获／孵化折扣 | 保留原计价，不新增局外精灵价格或永久等级 |
| 同文件 `SessionSaveData`、`getSessionSaveData/saveSession/getSession/loadSession` | 本局 seed、时长、模式、双方精灵、道具、arena、球、钱、分数、波次和训练家 | 单人保留原序列化与恢复；不是联机完整检查点，不能互换 |
| [local-save-store](../src/system/local-save-store.ts) | IndexedDB `pokerogue-early-local` v1、`saves` store；记录 `{schema:1,value:string,updatedAt}` | 复用事务提交、同快照读取、CAS与备份基础；schema:1仅为容器版本，不代表 payload 已完整校验 |
| [account](../src/account.ts)、[battle-scene](../src/battle-scene.ts) | `bypassLogin=true`；本地 `updateUserInfo` 扫描三个槽位，用户名为 `Local` | 已无强制在线账户依赖；这不是带昵称、头像和多档案切换的账户系统 |
| [home-phase](../src/home-phase.ts) | 原 Title 菜单入口、单人／联机／恢复、只读原 Starter/EggList/EggGacha | 已有大厅雏形，不从零制作；当前没有档案选择、本地主机管理和完整可写局外 |
| [original-profile-entry](../src/coop/original-profile-entry.ts) | profile v2：trainer、选择、最小 unlocks、成本计数、本人蛋镜像，严格校验和原计价 | 保留最小上传与各席私有性；不是整份个人档案、永久收藏或在线所有权认证 |
| [play-storage](../src/coop/play-storage.mjs) | 独立 IDB `coop-play-v1`，`seats/outbox`；按 origin/room/seat/actionId 保存席位、active与待发行动 | 复用重连、退出暂停、会话归属、outbox；新增档案绑定与主机标识须显式版本迁移 |
| [formal-coop-service](../server/formal-coop-service.mjs) | FormalRoomStore 同文件候选写入、file.sync、rename；房间含 runId/revision、席位、输入、回执、检查点、grants/grantAcks | 继续作为房主的权威房间存档；未见多代备份／整机掉电保证，不能宣称已有完整备份系统 |
| [coop-client](../src/battle-core/coop-client.mjs) | 实际模型重读校验→个人 grant 事务→grantAck/stateAck；失败不成功确认 | 复用确认顺序；不是另外做一套收包／确认协议 |
| [original-client-model](../src/coop/original-client-model.mjs) | `applyGrantsTransaction` 对非空 grants 抛 `PERMANENT_GRANTS_UNAVAILABLE` | 正式永久入账尚未实现，不能把接口存在或空 grants ACK 当成成果已落收藏 |
| [original-coop-adapter](../server/original-coop-adapter.mjs)、HEAD 的 native-entry | 保存 seen、dex-ivs、capture/evolution/voucher/completion 等 pending intents，正常返回空 grants | 保留既有事实；需后续规范归属、run 范围唯一性、payload完整性和原规则转换，不能批量无条件发奖 |
| [egg-hatch-runner](../src/battle-core/egg-hatch-runner.mjs)、[原 codec](../src/original-phase-checkpoints.ts) | 原蛋镜像／生成结果与 `hatch-commit` 停点；decision v6/v7兼容 | 生成、消费蛋、蛋招解锁、收藏提交是不同步骤；未知旧蛋库存不得补成空数组 |
| [local-profile](../src/coop/local-profile.ts)、[旧 client](../src/coop/client.mjs) | 旧实验页使用 lease、实验收藏和实验 seen/caught 去重事务 | 只借鉴事务／故障测试，实验规则与简化授予不接入正式收藏，不删除旧数据 |

原收藏按**物种累计解锁**保存；不是永久逐只仓库。本局六只队伍与本局等级／HP／道具不直接写入局外收藏。昵称、头像、profileId、档案切换目录等是新设计元数据，不能说原系统已经有了。

用户在本批追加确认的目标规则：联机只推进蛋进度，达到条件保留为待孵化，合作冒险正式结束并返回局外后再孵化；临时退出／断线／暂停不触发，单人沿原版。原EggLapse当前会在达到条件时插入EggHatch，因此需要后续适配持久延迟队列；本批只更新契约，没有实现或宣称已解除实际孵化停点。终局暂按通关或双方全灭结束理解，详见设计第5节。

## 3. 当前实际存储与备份范围

| 实际位置／键 | 用途 | 迁移处置 |
|---|---|---|
| `pokerogue-early-local/saves/data` | 正式个人原系统资料 | 原样备份后包装成新 profile 的 originalSystem；身份字段保持不变 |
| `sessionData/sessionData1/sessionData2` | 单人槽位0/1/2 | 三份全部保留；新大厅默认继续一份，其他放入“旧冒险”，不自动合并或删除 |
| 上述 `:backup` | 上一份成功覆盖前的记录 | 保留为候选恢复点；不等于多代自动备份，也不自动替换坏主档 |
| `coop-experiment-data/coop-experiment-grants` | 旧实验收藏／实验账本 | 隔离归档，不与正式 data 合并，不按实验次数补发 |
| `coop-grants` | 旧工具预留／兼容键 | 有则原样保留，不能假定是正式 M6 账本 |
| `coop-seats` | 旧实验恢复凭据 | 私密兼容归档；不当作正式 `coop-play-v1` 席位 |
| `coop-profile-lease` | 旧实验页30秒租约，旧 client 每10秒续期 | 迁移需等待旧写者退出；锁不带到新设备或作为永久身份 |
| localStorage `settings/tutorials/prLang` | 偏好、教程、语言（见[language](../src/system/language.mjs)） | 保留实际原键；这些键与IDB当前没有跨存储原子事务 |
| `coop-play-v1/seats,outbox` | 正式联机 active、凭据、未确认行动 | 当前通用备份未覆盖这套库；须专项迁移，不能改地址后直接重放所有旧行动 |
| 房主 FormalRoomStore 目录 | 正式合作完整状态 | 单独备份；个人导出文件不等于合作完整存档 |
| 旧 localStorage `data/sessionData` | 旧代码仍有 Consolidate/debug 读取路径 | 仅显式旧格式导入候选；本地正常 loadSystem 不自动扫描迁移，不从 debug 推断支持 |

已有两种用户导出方式：

1. 原 `GameData.tryExportData/importData` 的 `.prsv`：单份系统／单人进度／设置／教程，系统数据含短键转换和原 AES 包装。其格式包装不等于身份认证，保持兼容。
2. [local-save-tools](../src/local-save-tools.ts) 的 `pokerogue-early-backup` v1 JSON：列举第一套IDB主键及上一份备份，附 settings/tutorials。**不包含正式 `coop-play-v1` 或房主房间文件。** 页面[save-tools](../save-tools.html)仍有“合作房间尚未开放”的历史文字，后续界面批修订。

`restoreLocalSaves` 当前是允许列表内的整包替换：未提供的主键也会删除，有旧值时保存为 backup；不能复用于新“只导入一个档案／一个单人槽位”的增量导入。它主要校验 JSON/键和部分页面版本条件，尚非新档案的完整严格 codec。

## 4. 链路结论与待补缺口

### 单人

原 Login/Title → 本地 `loadSystem` → 原槽位恢复／新开 → 原 `saveSystem/saveSession`。`saveSystem` 串行CAS写，`saveSession`目前没有同等档案revision／单写者防覆盖。系统与session分别写，并非一次整体提交。新方案必须防止两个页面同时推进、切换档案后旧回调写错档，以及恢复一个旧session后重复发长期资源。

### 正式联机

本地 GameData → 原 Starter → 最小 profile v2 → 正式房间／原 Worker → 候选房间落盘 → 私有投影 → 原模型apply/capture → 空 grants 接口 → ACK。恢复席位token不等于本地profileId；当前正式客户端也没有旧实验租约那样的完整个人档案写锁。不能宣称单人与联机永久写入已并发安全。

永久成果目前主要保留在房间 pending intents；缺正式转换、客户端原收藏事务与恢复对账。转换前要核对每条事实实际字段、owner和事件唯一性，例如目前部分意图ID未包含runId，且同波次同种类事实能否多次出现需要具体审计。不能仅将数组映射为 grant。

### 无中央服务器的本地联机

[server/start](../server/start.mjs) 已可在用户电脑运行权威服务并绑定局域网；无需在线账户。当前正式页面 WS 固定使用 `location.host`，恢复存储也绑定origin。双方“各自本地启动→输入房主地址”的产品流程**尚未接入**，后续必须做可配置连接端点、稳定主机／冒险标识、凭据归属和跨源握手。

本地客户端需要可用的 `crypto.randomUUID`／`crypto.subtle`（会话与模型摘要），不能为LAN联机删掉校验；打包／本地可信页面与远程WS的来源策略须实际验证。n2n只解决可达性，不自动提供游戏启动、身份、存档或房间发现。真实同LAN不需n2n；异地组网可能依赖第三方／自建节点，产品无需我们运营节点。

### 完整离线

`bypassLogin=true`证明本地账户分支，不证明完整冷启动离线。HEAD 单人 preload 仍从 GitHub 加载 rextexteditplugin；素材、音频、字体、目录索引及其他请求需要打包审计和断网冷缓存测试。当前未发现项目已配置的桌面打包／Service Worker交付，不把浏览器缓存当正式离线安装。

## 5. 本批验证与证据限制

实际执行：`node --test --test-concurrency=1 tests/local-save.test.mjs tests/coop-profile.test.mjs`。

独立一次 **14/14通过，退出0，1834.7762ms**，fail/cancelled/skipped/todo均0。只用fake-indexeddb合成资料，未接触真实档案，也不重建runtime。覆盖IDB事务、备份、槽位隔离、非法JSON拒绝、CAS、旧实验租约与实验账本去重／回滚。旧实验7项通过不代表正式联机永久入账通过。

本批没有生产源码改动，未运行类型／Worker／生产构建或旧完整回归；第23批1402/1402仅是历史基线。未执行真实浏览器、双设备、断网启动、n2n、桌面文件保存或任何迁移。设计中所有新schema、文件目录、锁和迁移步骤均为后续实现契约。

第一批交付门槛：已有模型、存储边界、原版复用、正式／实验差异、新结构、归属、迁移与失败恢复，以及第二批范围均已记录。代码实现和产品可用性留待后续批次验收。

审计期间另一个窗口已提交 `a1600e8fa6cc874328abaa2da15a453c9891cad3`（第24批单Boss生产改动），本批不对该交付作战斗验收；本批提交仅包含两份新局外文档以及主交接／计划中的局外追加头。该状态覆盖第23批记录中的“24未实施”，不表示24全部验收结束。第二批完整任务书只保存在本地忽略文件 `docs/AGENT-LOCAL-META-02-PROMPT.md`，未自动执行。

工程检查：两份新增文档21处本地链接全部存在；本批新增文档与主交接／计划追加diff的窄凭据模式无匹配（非全仓库或绝对隐私保证）。上述14项所用两个实现文件和两个测试文件与开始基线零差异，未沿用其他窗口测试数字。忽略证据在 `build/local-meta-01/evidence.json`，不提交。
