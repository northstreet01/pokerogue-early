# PokéRogue Early — 单人游戏与双人合作开发

基于 [pagefaultgames/pokerogue](https://github.com/pagefaultgames/pokerogue) 的 early 版本，保留原版单人游戏、本地收藏和存档，逐步接入服务器权威的双人合作。

**当前仍处于合作开发阶段，尚未完成原画面双浏览器可玩的 MVP。** 独立合作实验页可以运行；原类联机链路已经通过真实 WebSocket 和磁盘恢复测试，但原合作 UI、真实个人选队及跨设备验收仍待完成。

## 当前进度

更新日期：2026-10-18。

| 部分 | 当前状态 |
| --- | --- |
| 单人游戏与本地存档 | 保留原版入口，支持本地存档及备份管理 |
| 合作实验页 | 独立有限实验引擎，可验证房间、选队、战斗和整备；不代表原版合作已完成 |
| 原规则运行器 | 房间独立 Worker 调用原类，固定夹具已走通首战→整备→战前换人／拒绝→第二战 FIGHT |
| 正式联机接缝 | 正式协调器、八方法 adapter、shared／personal 投影、本人原模型恢复和 consumer ACK 已贯通 |
| 入局与基础续局 | 内部 lobby 与 envelope 已接；真实双 WS 验证关服重启、席位恢复、回执重放和只结算一次 |
| 原合作界面与跨设备 | 尚未接通；真实个人资料／原收藏选队、IndexedDB outbox 与连续游玩验收待完成 |
| 永久收藏事务 | M6 未完成，捕获／孵化结果尚不能通过正式链路永久授予 |

最新源码验收：**完整串行回归 935/935、退出码 0；定向 35/35；类型检查和生产构建通过**。这是 2026-10-18 已验收版本的实际结果，不代表任意后续修改自动通过，也不代表全部机制或双设备游玩验收完成。证据见 [发布记录](docs/coop-progress-release-2026-10-18.md) 与 [VS-02 维护者验收](docs/mvp-vs-02-review-2026-10-18.md)。

当前原类链路仍使用内部测试身份、队伍和种子，其他可达机制可能在未支持的原 Phase 安全停止。正式 `/coop/v1/ws` 在默认开发／服务入口未注入 adapter 时仍返回 `ADAPTER_UNAVAILABLE`；构建运行器不会自动启用正式合作。

## 本地运行

需要 Node.js 和 npm。项目声明 Node.js >=18；最近一次完整验收使用 Node.js 24.15.0，未单独验证全部旧版本环境。

```sh
npm ci --ignore-scripts
npm run start
```

默认地址：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:8020/` | 原版单人游戏 |
| `http://localhost:8020/save-tools.html` | 本地存档与备份管理 |
| `http://localhost:8020/coop.html` | 独立合作实验页 |

开发服务监听局域网地址；实验双端连接方法和限制见 [COOP.md](COOP.md)。该页面使用实验协议／引擎，与正式原类联机链路分开。

构建后使用 Node 服务提供静态页面与实验 WebSocket：

```sh
npm run build
npm run start:server
```

默认端口同为 8020，与开发服务择一启动。服务需要项目中的 Node 服务代码及依赖，不能仅上传 `dist`。原类 Worker bundle 可通过 `npm run build:coop-runtime` 单独生成，当前主要用于内部接缝与回归验证。

## 存档与数据边界

收藏、图鉴、扭蛋数据和单人进度保存在浏览器 IndexedDB；设置和教程使用 localStorage。存档按浏览器和访问地址隔离，localhost、局域网 IP 与域名之间不会自动共享数据，迁移时使用备份工具。

合作实验收藏与正式收藏隔离，不将实验捕获结果写回正式图鉴。正式房间检查点由服务器保存，个人收藏仍由本人浏览器保存；两种备份不能互相替代。仓库不包含个人存档、房间凭据、依赖目录或构建产物。

## 验证与开发记录

```sh
npm run typecheck
npm run build
npm run build:coop-runtime
node --test --test-concurrency=1 tests/battle-core*.test.mjs tests/coop*.test.mjs tests/local-save.test.mjs tests/localization.test.mjs tests/outsourcing-locale-placeholders.test.mjs
```

完整回归包含真实 Worker、WebSocket 和临时文件原子保存，用时约 15 分钟；环境需要允许本机回环连接及测试目录读写。单项命令见 package.json。

- [开发交接与当前缺口](docs/DEVELOPMENT-HANDOFF.md)
- [模块计划](docs/coop-development-plan.md)
- [最快双端可玩架构](docs/mvp-delivery-architecture-2026-10-18.md)
- [原 UI 接入资料](docs/outsourcing/MVP-UI-01-reuse-inventory.md)
- [本地基础与历史记录](LOCAL-FOUNDATION.md)
- [原版来源调查](docs/early-baseline-2026-10-13.md)

## 原版来源与许可证

源码与资源基线为固定历史提交 `ec9365a8bffd8fa0dc050e71ef3eb177e63bc1e9`。该提交用于标识来源和规则对照，项目不据此限制精灵种类、世代或数量；尚未接入内容属于开发缺口。

保留原版 AGPL-3.0 许可证、资源与贡献者说明。以下是该历史快照的原版 README，其功能、环境与部署描述属于历史记录；本项目当前运行方式以上文为准。

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
