# VS-02B-19维护者验收：统一入口与个人局外原界面

2026-10-23。用户明确“开始”，本片仅在early实施，未创建/联系agent、未合并/推送。统一入口与个人只读原UI的A/B代码已完成，真实双浏览器未执行，不能关闭用户实测。手测步骤见[清单](vs02b19-manual-acceptance.md)。最终冻结源码完整单次串行1263/1263、退出0、1835508.6714ms（约30分35.5秒），fail/cancelled/skipped/todo均0；18批1244/1244只作历史。

## 实际起点与提交

只读核对初始feature/vs02b18-persistent-berry、工程文档HEADf3c152deb45726dd68d8b50c35b37050edb22ac6、18源码/测试cff4152b0640ee30939b8ed225ce27257c6787ce；tracked干净、单worktree，可见任务列表无其他活跃项目开发。main/origin/main及只读实时远端均86798227ca995c4ff40043b99a0c6846ed177154。从18分支继续建立feature/vs02b19-home，保留14–18全部生产链。

- A：3d349b2329defccc3737c0f9bb685f9eda7a2ca1，统一Home/直接单人登录、正式fresh及主动恢复席位，原Title返回首页。
- B：d1cfa43297413bacfd2749b9220a0ec17116e0e0，原收藏/蛋/券只读浏览、原GameData只读视图和异步生命周期、真实IDB/双WS/Worker联测。
- 收尾修复及最终源码/测试：a6f8b73b823823629765cfd878c7c05dba10eef6，原Starter再次打开时重置未见物种图标颜色，防止继承旧解锁显示；17/17本批定向通过后重新冻结和构建。

SPEC和全部AGENT/PROMPT只保留本地忽略，未暂存/提交；日志、运行时、生产构建和测试服务资料均位于忽略目录。后续文档提交不改变本次冻结源码/测试。

## 复用与实际行为

入口复用原TitleUiHandler/OptionSelect的布局、键盘和指针，不另写主菜单渲染器。根地址先进入HomePhase，不启动Login的原性别/教程或个人保存；单人选择转`/?solo=1`，沿原Login/Title/继续/新游戏/槽位。原Title补明确回首页；正式联机转`/coop-play.html?fresh=1`，原生产CoopPlayPhase、profile/outbox/模型核验继续使用。桌面入口改正式联机，旧实验室地址仍可直接使用。

“恢复已有联机”先只读列出本origin房间/席位，用户选择后才重新激活指定本地席位；URL不含令牌。主动退出暂停、独立fallback和fresh优先继续保留；仅查看列表不恢复，不复制/清除旧房outbox，也不移动到新房。现有直达正式页面保留原恢复路径，退出后必须显式新建/加入或主动恢复。没有新增服务器leave协议或私有资料共享。

个人收藏复用原StarterSelect的解锁、形态/能力/性格循环、详情和IV；只读选项阻断SUBMIT/tryStart、选队编辑通知和原Add/Manage Moves路径，隐藏开始/预算标签。原单人和合作选队默认路径保持可写；Home的M键走返回，不开放单人存档/抽蛋菜单。原异步物种资源在clear后取消，失败可重新选择/返回。

蛋复用原EggList/原Egg及EggData转换、来源/日期/剩余进度；修复空数组的无效cursor，原99枚布局和键盘边界保留，补原指针绑定选蛋。券复用原EggGacha已有四种券图标/数量，隐藏消费选择；只读ACTION、pull、consumeVouchers及clear后的旧调用均不消费。正常单人Gacha在show后仍可沿原路径消费已有券，不全局禁用。

GameData使用原解析、旧数据补全、dex合并和蛋恢复，显示层只建立隔离的原GameData视图。只读构造不读取/重设场景settings，不生成身份RNG，load不写性别设置、不输出完整个人资料；saveSystem/saveSetting拒绝该视图写入。无档提示尚无资料；损坏JSON/缺身份或dex的资料报错并保留原字节。浏览不创建默认存档，不修改已有收藏/蛋/券/槽位/v6-v7/pending，也不提交profile-ready或道具行动。

Home沿现有原UI模式，用epoch及串行转场保护：原界面clear后恢复场景GameData，再绑定下一视图；迟到读盘只完成隔离对象，旧返回/选择回调失效。独立DOM返回按钮只负责导航，在读盘和资源失败时仍可操作，场景shutdown/离开时移除。没有第二库存、第二规则或实际核验模型的动画式篡改。

## 自动证据

渲染/资源端口明确为headless，IndexedDB使用fake-indexeddb的实际事务。新首页→个人券原GameData读取→返回→fresh正式入口→原profile→真实IDB/双WS/完整原Worker→真实模型ACK→原Command/FIGHT在两个席位通过。未用源码提取或替代规则driver。

| 验证 | 结果 |
|---|---|
| 新Home/原UI/既有选队、捕获、商店及持久道具UI→WS联测 | d1cfa432，130/130，退出0，50739.3282ms，fail/cancelled/skipped/todo均0 |
| 收尾未见图标修复及本批全部定向 | a6f8b73b，17/17，退出0，7980.1589ms，无失败/取消/跳过/todo |
| 最终typecheck | a6f8b73b，退出0 |
| 最终build:coop-runtime | a6f8b73b，退出0 |
| 最终生产build | a6f8b73b，退出0，48.41s |
| 最终冻结源码完整单次串行回归 | a6f8b73b，1263/1263，退出0，1835508.6714ms；fail/cancelled/skipped/todo均0 |

最终原始证据仅本地build/vs02b19：home-ui-ws-final.log/.exit、home-icons-final.log/.exit、typecheck-final2、worker-final2、build-final2、frozen-head-final.txt、frozen-blobs-final.txt及full-final-owned.log/.exit。构建/运行时重建均串行，最终全套期间不改源码/测试。生产build保留既有大chunk/动态导入提示，不当作错误隐藏。

失败历史独立保存：home-red缺Home模块为预期红测；home-a首次缺测试location；home-b1缺headless原随机上下文，补用原withStarterRandomContext；一次新增fixture重复导出及一次测试间席位残留已修正。最初WS沙箱被EACCES拒绝，两次停止日志独立保存退出1，第二次为限定名称诊断，不当完整证据；允许本机连接环境首轮129条128通过/1失败是单人Title测试遗漏原updateUserInfo初始化，修正后130/130。没有skip、弱化、修改冻结旧对照或拼接通过日志。图标修复前构建0（53.34s）只作前版证据，最终以final2和完整回归为准。

## 结论与停点

A/B代码及本批自动验收、最终完整回归通过。**真实双浏览器、两台设备与视觉排版尚未执行**；第1代码和自动推进，第2/3/4/6/7仍须真实双端确认，第5战斗展示仍部分。原捕获用户错误文字不详，不以新增自动链关闭原次“选球后报错/无反应/卡住”。

未启用合作永久捕获/IV/孵化/券授予M6，不决定券归属/时机或同回合敌我全倒。糖果成长/全队复活/TM/进化/融合/复杂转移/持有物捕获、特殊Boss/地图/部署和完整经验升级/双Trainer动画仍后续。每人6只、个人10/共享14、原取舍、个人蛋与pending全部保留。

下一独立片20只备“原战斗HP与离场动画时序”的完整本地忽略任务书，未实施；需要用户另行授权。剩余分组不是固定几批工期。收尾核对单worktree，源码/测试blob与冻结a6f8b73b共0差异，main/origin/main及本次实时远端main仍86798227ca995c4ff40043b99a0c6846ed177154。五份工程文档的200个本地链接均存在；显式清单暂存、空白和凭据模式检查见本地证据。未合并/推送，最终文档HEAD由本地Git记录；文档提交不改变冻结源码。
