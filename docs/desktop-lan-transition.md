# 当前桌面与 LAN 架构

更新：2026-10-27。当前采用玩家托管的 LAN Host-Client；没有中央战斗服务器。资源、个人资料和单人冒险在各自设备；房主额外托管合作房间和原规则 Worker。玩家自行使用虚拟局域网或 TCP 映射，游戏不配置穿透或中继。

## 运行链路

| 模块 | 职责 |
| --- | --- |
| desktop/main.cjs、preload.cjs | Electron主进程与受限桥接；渲染器无Node权限，IPC核对主窗口、主frame和本机来源 |
| desktop/runtime.mjs | 本机资源127.0.0.1:18734；按需LAN房主0.0.0.0:18735；资源与房间接口分离 |
| src/app-navigation.mjs、main.ts | 同一Phaser.Game内切Scene；离开前确认保存，清理旧场景的音轨、输入和资源生命周期 |
| src/home-phase.ts | 唯一局外大厅：单人、正式合作、恢复席位、收藏与档案导入导出 |
| server/formal-coop-service.mjs | 身份、房间、串行提交、回执、状态确认、可靠检查点 |
| server/original-coop-adapter.mjs | 正式房主统一配置与原规则桥；固定队伍夹具只存在tests/helpers |
| server/original-rule-host.mjs、worker.mjs | 每房间独立原规则运行器；前端只提交意图、应用快照与展示事件 |
| src/coop/play-phase.ts | 连接、等待房间、选队确认、全员手动准备、原战斗展示和恢复 |
| desktop/storage.mjs | 主进程独占SQLite；通过有限scope、读取集合和revision CAS提交 |
| src/local-meta | 原存档codec、个人repository、固定档案IO、租约、迁移与备份 |

## 单一入口与兼容边界

发行文档只有 index.html 与 coop-play.html；前者承载大厅和单人，后者提供正式合作的直接启动入口。切换走同一受保存保护的导航，不能再从底栏跳到另一套存档页面。服务器拒绝其他HTML，即使旧文件残留在资源目录。

实验联机页、10波简化引擎、实验WebSocket服务、旧整库HTML恢复页及无调用调试工具已退出源码与构建。旧数据兼容仅保留在严格codec、显式导入预览和原单收藏读取边界：不自动覆盖、不合并实验奖励、不复制私有席位给另一玩家。

原规则运行器保留完整early目录、原Phase、随机消费顺序和序列化校验；不是复制一套简化规则。测试参考驱动与原规则差分放tests/helpers，不参与生产依赖图，Worker构建拒绝test依赖。

## 保存与同步

正式服务先可靠保存候选结果，再发布快照和回执；同actionId重发只对账。客户端应用投影并计算摘要后确认，双方同步/准备屏障保持。动画进度不决定权威结果；玩家鼠标和逐帧画面不写存档。

单人通过固定个人IO保存原SystemSaveData和冒险数据；合作冒险由房主保存，个人长期成果完整事务仍待后续。正常退出排空已接受的写入，未确认保存时停留原场景，只有明确放弃流程可丢弃未确认状态。

## 当前限制

尚未完成永久合作成果、蛋进度/终局孵化/扭蛋完整闭环、Android、队友鼠标、自动房主迁移或双端独立规则模拟。规则/内容指纹仍须完善，不把纯美术变更等同存档不兼容。冷启动解码、声音、真人两设备与长局以真实验收为准。

设计参考见[杀戮尖塔2对照](slay-the-spire-2-reference.md)，操作见[使用说明](desktop-lan-usage.md)。
