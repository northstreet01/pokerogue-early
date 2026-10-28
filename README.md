# PokéRogue Early — 本地程序与双人局域网合作

基于 [pagefaultgames/pokerogue](https://github.com/pagefaultgames/pokerogue) 的 early 版本，保留原版单人玩法，开发玩家自己托管房间的 LAN Host-Client 双人合作。资源与个人存档保存在各自设备，房主电脑运行原规则 Worker 并保存合作冒险，不依赖开发者服务器计算对局。

更新日期：2026-10-28。当前已交付 Windows x64 测试程序、本地 SQLite 存档和原版联机可玩流程，仍处于开发与手测阶段；不是全部原版功能或所有设备环境均已验收。

本轮已修复六位房间码输入、单人选队后开局中断和存档槽鼠标操作；删除旧存档维护页、实验联机引擎及废弃组件，统一正式入口和房主配置。切换场景在保存未确认时停留原界面；发行更新先准备完整候选包，替换失败时恢复旧包。代码审查已纳入构建与 CI。

最新修复联机入口反复返回大厅时的空背景停留：退出检查失败保留可操作界面并允许重试，已暂停的旧席位不再误报冲突。移除顶部重复退出导航栏，通关与失败提示归入大厅。

新版新建联机房间支持临时共享双方图鉴选队范围，同一物种跨席互斥（形态/闪光算同种），取消后释放；永久图鉴仍各自独立。双方需使用同版程序，旧房继续原选队方式。本人战斗HP数字和经验条也已恢复显示。

开局进入战斗时提前收起等待房间并显示加载提示；合作行动因没有有效目标而取消时，会显示对应精灵的“攻击打空了”提示。

## 已实现与后续范围

| 部分 | 当前实现 |
| --- | --- |
| Windows 程序 | Electron EXE，游戏图片、音乐及其他资源随程序本地加载，无需玩家安装 Node 或开启外部浏览器 |
| 玩家托管 LAN 房主 | 局域网自动发现，远程填写IP/域名；连接后用房间码加入；房主运行原 Worker，客户端接收快照与事件 |
| 大厅与准备 | 同一程序内切换单人／合作；双方各一排队伍预览；完成选队只保存队伍，全员手动准备并同步完成后开始 |
| 局内流程 | 已接战斗、捕获、换人、战后奖励／共享限量商店、升级学招与进化等主要原版链路；特殊分支和道具仍有缺口 |
| 原版道具与形态 | 回忆蘑菇、剩饭等常规道具，Mega／极巨化／太晶化，以及本人队伍内DNA融合与解除；未接机制从新抽取奖励中排除 |
| 局内信息 | 本人道具图标、数量、原效果说明、携带者及剩余次数；连接、加载、行动和整备状态提示 |
| 个人本地资料 | 桌面 SQLite 保存档案、单人进度、设置、席位及待发行动，保留原校验、档案版本、单写者与历史备份 |
| 迁移与恢复 | 旧桌面 IndexedDB 确认迁移且保留原库；个人数据库备份／恢复；合作局按已保存检查点与原席位恢复 |

新房间的联机永久成果现已接通：捕获、遇见、IV、进化、原成就和券等分别写回本人档案，重连不重复发放；房间共享选队不会解锁永久图鉴。开始前先在大厅创建或选择个人档案，双方使用新版并新建房间；旧房保留原恢复方式，不补发旧奖励。保存失败可点击“重试保存成果”。

单人与联机使用同一个人档案时共用图鉴。大厅“宝可梦图鉴”使用原版精灵网格、形态/特性/性格详情与IV图；“个人资料”提供原版成就和统计等界面；档案管理的三槽一览复用原存档卡片。图鉴不需要等通关才更新，具体保存时机与入口见[使用说明](docs/desktop-lan-usage.md)。

后续仍包括：蛋进度与终局孵化／扭蛋闭环、更多特殊道具与道具转移、Android 和队友鼠标提示。当前没有改为各客户端独立运行整套战斗规则。

DNA融合按原版先选主体、再选本人队伍内第二只：第二只离队，技能进入原学招流程，持有物按原规则转移；解除融合不会返还第二只。形态、融合及本人图鉴成果继续沿原检查点和成果事务保存，不另建一套规则或收藏。

## 运行 Windows 测试程序

本机最新产物：

```text
build/desktop/release/PokeRogue-LAN-win32-x64/PokeRogue-LAN.exe
```

双击 EXE，必须保留整个发行文件夹，不能只复制 EXE。`build/` 不纳入 Git；拉取源码后需按下方步骤构建，不会随源码推送取得二进制程序。

后续统一使用上述固定目录。更新前退出旧程序，新包验收后清理旧发行包和临时副本；个人存档目录独立保留，不随安装包清理。

1. 同网玩家进入“联机冒险 → 局域网联机”，房主点击“启动本机房主”（默认 TCP 18735），再创建房间。
2. 队友从局域网搜索结果选择房主，再输入房间码，无需手填IP。异地玩家切到“远程联机”，输入房主IP/域名；如 `172.16.2.5` 默认18735，也可填写 `example.com:映射端口` 或完整HTTP/HTTPS地址。
3. 双方选择本人精灵并确认“完成选队”，返回房间查看两排队伍，再各自点击“提交准备”。已准备后需先取消准备才能重新编辑队伍。
4. 房主退出会使队友断线；保留原房主数据目录，重新启动后恢复原局与席位。首版不提供自动房主迁移。

程序的资源入口固定为 `127.0.0.1:18734`，只监听本机；LAN 房主端口默认为 `18735`，可在界面选择。自动发现使用UDP18736；隔离网络或浏览器可展开手动连接。远程联机由玩家自行使用端口映射或 n2n 等组网工具：端口映射时连接映射后的房主地址；虚拟局域网时连接房主的虚拟网卡 IP。游戏不负责配置隧道或运营中继，不能直接把 n2n 协调服务器 IP 当作游戏房主地址。

一个人可先用 EXE 开房，再用独立浏览器访问 `http://127.0.0.1:18734` 作为另一玩家，两端都连接房主 `http://127.0.0.1:18735`。这只能辅助测试双端操作，不代替真实两设备和穿透验收。

## 存档与数据目录

Windows 正常数据目录为 `%APPDATA%\PokeRogue-LAN`，程序菜单可以打开：

| 路径 | 用途 |
| --- | --- |
| `storage/personal.sqlite` | 本人的档案、单人存档、偏好、私有席位与待发行动 |
| `storage/backups/` | 菜单生成的个人数据库一致备份 |
| `hosts/formal-rooms/` | 房主保存的合作局、检查点及主机身份 |

个人数据库与房主房间备份不能互相替代。使用菜单备份个人库；备份完整房主目录或整个数据目录前先退出程序。运行中不要只复制 SQLite 主文件而遗漏 WAL。备份含私有恢复凭据，不要当房间邀请码分享。升级替换程序目录，保留数据目录。

桌面首次检测到同一应用来源的旧资料时请求确认迁移；取消不创建空档替代。外部浏览器资料不会被直接读取：应在原浏览器的当前大厅中迁移旧资料、导出个人档案，再在桌面大厅导入。已有早期备份 JSON 仍可预览导入，无需恢复旧维护页。普通浏览器继续使用 IndexedDB／localStorage，资料按浏览器和访问来源隔离；旧合作实验资料保持隔离。

## 从源码构建桌面版

建议使用已验证的 Node.js 24.15.0 与 npm；玩家使用 EXE 无需这些依赖。先准备依赖和固定版本的 Electron 运行时：

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run review:code
npm run typecheck
$env:POKEROGUE_DESKTOP_OUTPUT='build/desktop'
npm run build:desktop
npm run package:desktop
```

输出包含独立原 Worker、前端与完整素材，不覆盖原 `dist` 或 `build/coop-runtime`。开发运行该产物可执行 `.\node_modules\electron\dist\electron.exe build/desktop/app`。省略输出环境变量时，构建／封装默认使用 `build/desktop`；`npm run start:desktop` 也固定运行该默认目录。

## 浏览器开发入口

```powershell
npm run start
```

默认开发地址 `http://localhost:8020/`，监听本机。根路径为统一大厅；`/coop-play.html` 为正式原版联机界面；旧实验页和独立存档维护页已删除，档案统一从大厅管理。普通 `start`／`start:server` 未启用 profile adapter 时，正式 WS 返回 `ADAPTER_UNAVAILABLE`。

需要运行正式浏览器合作入口时：

```powershell
npm run build:coop-runtime
npm run build
npm run start:local
```

`start:local` 显式启用正式 profile 大厅，默认监听本机 8020；需要 LAN 监听时执行 `npm run start:local -- --host`。与 Vite 开发服务择一运行，不能只上传静态 `dist` 代替 Node 服务。桌面、开发和独立服务使用同一正式房主配置。

## 验证与代码审查

每次交付先审查真实调用链、模块归属、失败保存边界和资源生命周期，再运行结构检查、类型、相关回归及实际EXE验证。替换旧实现时同时删除废弃入口、依赖和测试；仅供测试的驱动放tests/helpers。新包验证后清理旧发行包，不再逐批堆目录与报告。

```powershell
npm run review:code
npm run typecheck
```

结构检查覆盖全部第一方模块的语法、相对依赖和生产可达性，并限制发行页面；它不替代人工代码审查或玩法验证。相关测试按修改范围选择，不自动跑全套或200波。当前详细结果见[验收与审查](docs/desktop-lan-review.md)。

上一轮457个模块结构检查、类型检查、相关定向回归、原Worker／前端构建及实际封装EXE隔离验证通过；包括单人开局、原存档读取、旧页面拒绝、保存失败保护、六位输入与原Worker双客户端连接。最新大厅返回修复通过456模块审查、类型检查、151项定向回归，以及实际EXE三次进出与失败重试验证。正常前台、声音、真人两设备及长局仍待手测，不把隔离测试当作全面验收。

- [使用与手测](docs/desktop-lan-usage.md)
- [当前架构](docs/desktop-lan-transition.md)与[存档约束](docs/local-meta-architecture.md)
- [维护与交付要求](docs/DEVELOPMENT-HANDOFF.md)
- [后续计划](docs/coop-development-plan.md)

## 原版来源与许可证

源码与资源基线为固定历史提交 `ec9365a8bffd8fa0dc050e71ef3eb177e63bc1e9`。该提交标识来源与规则对照，不据此限制精灵种类、世代或数量。

保留原版 AGPL-3.0 许可证、资源与贡献者说明。以下为该历史快照的原版 README，其功能、环境与部署描述属于历史记录；本项目当前运行方式以上文为准。

---

<picture><img src="./public/images/logo.png" width="300" alt="PokéRogue"></picture>

PokéRogue is a browser based Pokémon fangame heavily inspired by the roguelite genre. Battle endlessly while gathering stacking items, exploring many different biomes, fighting trainers, bosses, and more! 

# Contributing
## Development
If you have the motivation and experience with Typescript/Javascript (or are willing to learn) please feel free to fork the repository and make pull requests with contributions. If you don't know what to work on but want to help, reference the below **To-Do** section or the **#vote** channel in the discord. 

### Environment Setup
node: 18.3.0

1. Clone the repo and in the root directory run `npm install`
    - *if you run into any errors, reach out in the **#dev-corner** channel in discord*
2. Run `npm run start` to locally run the project in `localhost:8000`

### FAQ

**How do I test a new ability/move?**
- In the `pokemon.ts` file there are overrides you can set to apply the new move/ability to your active pokemon

**How do I test a specific seed/wave?**
- In the `battle-scene.ts` file there are overrides for seed, starting level, starting wave, starting biome, and starting money


## To Do

- Add carry-over starter mechanic
- Moves
  - Complete move logic
- Abilities
  - Complete ability logic
- Pokemon summary screen
  - Add IV screen
- Capture logic
  - Critical capture
- Modifiers
  - Various mainline game items for various enhancements
- Trainers
  - Finish party pools
  - Add dialogue
  - Add reward for gym leader victories
- Battle animations
  - Fix broken battle animations (mostly ones with backgrounds)
- Modes
  - Add random mode
  - Add Nuzlocke mode

# Credits
> If this project contains assets you have produced and you do not see your name here, **please** reach out.

### BGM
  - Pokémon Mystery Dungeon: Explorers of Sky
    - Arata Iiyoshi
    - Hideki Sakamoto
    - Keisuke Ito
    - Ken-ichi Saito
    - Yoshihiro Maeda
  - Pokémon Black/White
    - Go Ichinose
    - Hitomi Sato
    - Shota Kageyama
  - Pokémon Mystery Dungeon: Rescue Team DX
    - Keisuke Ito
    - Arata Iiyoshi
    - Atsuhiro Ishizuna
  - Pokémon Black/White 2

### Sound Effects
  - Pokémon Emerald
  - Pokémon Black/White

### Backgrounds
  - Squip (Paid Commissions)
  - Contributions by Someonealive-QN

### Game Logo
  - Gonstar (Paid Commission)

### Trainer Sprites
  - GAMEFREAK (Pokémon Black/White 2, Pokémon Diamond/Pearl)
  - kyledove
  - Brumirage
  - pkmn_realidea (Paid Commissions)

### Trainer Portraits
  - pkmn_realidea (Paid Commissions)

### Pokemon Sprites
  - GAMEFREAK (Pokémon Black/White 2)
  - Smogon Sprite Project (Various Artists)
  - Skyflyer
  - Nolo33
  - Ebaru
  - EricLostie
  - KingOfThe-X-Roads
  - kiriaura
  - Caruban
  - Sopita_Yorita
  - Azrita
  - AshnixsLaw
  - Hellfire0raptor
  - RetroNC
  - Franark122k
  - OldSoulja
  - PKMarioG
  - ItsYugen
  - lucasomi
  - Pkm Sinfonia
  - Poki Papillon
  - Fleimer_
  - bizcoeindoloro
  - mangalos810
  - Involuntary-Twitch

### Move Animations
  - Pokémon Reborn
