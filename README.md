# PokéRogue Early — 本地存档与合作开发基础

项目需求、真实进度、原版保留边界及后续验收统一见 [SPEC.md](SPEC.md)。独立合作验证页尚未接入原游戏，实验内容限制不是正式玩法需求。

新窗口继续开发先读 [交接说明](docs/DEVELOPMENT-HANDOFF.md)，核对 Git 状态，再按 [模块计划](docs/coop-development-plan.md) 继续。M1 契约及协议测试已完成，M2 检查点与 M3 原版运行器部分完成；[架构文档](docs/coop-architecture-2026-10-13.md) 定义服务器权威、检查点与确认边界。

基于 [pagefaultgames/pokerogue](https://github.com/pagefaultgames/pokerogue) 的固定历史提交
`ec9365a8bffd8fa0dc050e71ef3eb177e63bc1e9`，从较早版本逐步开发独立成长、共同战斗的合作游戏。

**项目没有因版本而限制精灵种类、世代或数量。** 上述历史提交用于标识代码来源和规则对照基线，不是精灵范围上限。尚未接入的精灵或机制属于开发缺口，不能据此缩减正式玩法需求。

当前包含原版单人游戏、本地存档和独立合作实验页。实验页可验证建房/加入、各自选队、共同战斗、个人整备及保存恢复，但使用有限实验引擎，尚未接入完整原版战斗。其具体实现缺口见 [实验页说明](COOP.md)，不能作为正式合作的精灵或招式范围。

实验页的捕获记录现已隔离到独立收藏副本，不写回正式图鉴；实验内容限制不改变原游戏规则。审查结果见 [代码审查记录](docs/code-review-2026-10-13.md)。

原版接入 B1 已提取随机数、等级和捕获纯规则并回接单人，使用原函数对照验证。完整服务器战斗仍待接入，见 [原版战斗接入进度](docs/original-battle-integration-2026-10-13.md)。

M2 安全停点状态适配层已完成：原 Pokemon/Battle/Arena、个人资源、随机流、原 Phase 队列及选队/行动/替补/学招/进化/地图/整备/结束检查点，恢复失败保留旧状态。177 项测试、类型检查和构建通过，包括逐阶段重启的真实 WS 双端差分。完整权威运行器、原游戏合作 UI 与真实双机仍待 M3–M8；不因版本限制精灵范围。详见 [本批范围与证据](docs/m2-checkpoints-2026-10-14.md)。

当前工作区继续 M3：原出招→一次伤害与异步效果已有恢复验证，新增原 MoveEnd／TurnEnd 独立收尾差分和双端重启／写盘失败验证；decision v6，206 项回归、类型检查和构建通过；代码提交 `f2377193` 已于 2026-10-14 推送至 `origin/main`。完整回合、生产场景服务和全机制仍缺，见 [本轮复用与验证](docs/turn-end-m3-2026-10-14.md)。后续按 [SPEC 复用清单](SPEC.md#45-复用优先与后续开发约束)核对已有实现，减少重复开发。

```sh
npm ci --ignore-scripts
npm run start
```

游戏入口为 `http://localhost:8020/`，本地存档页面为 `http://localhost:8020/save-tools.html`。
独立合作实验页为 `http://localhost:8020/coop.html`，尚非原游戏正式合作入口。双端连接方法和实验实现现状见 [COOP.md](COOP.md)。
收藏、图鉴、扭蛋数据与单人进度保存在独立 IndexedDB 中；设置和教程使用 localStorage。
存档按浏览器和访问地址隔离，可导入、导出备份。仓库不包含个人存档、node_modules 或构建产物。

验证：`npm run typecheck`、`npm run test:local-save`、`npm run test:coop`、`npm run test:battle-core`、`npm run build`。

- [当前开发记录](LOCAL-FOUNDATION.md)
- [已确认需求与设计](docs/coop-game-design-2026-10-13.md)
- [早期版本调查](docs/early-baseline-2026-10-13.md)
- [当前联机版问题分析](docs/current-coop-root-causes-2026-10-13.md)
- [历史规模指标](docs/research/early-version-metrics.json)

保留原版 AGPL-3.0 许可证、资源与贡献者说明。以下是所选历史快照的原版 README，其功能与部署描述属于原版历史记录。

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
