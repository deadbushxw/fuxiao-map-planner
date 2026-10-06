# AGENTS.md —— 给 AI 助手的仓库入口

> **读者：AI 助手。** 人看的入口是 [README.md](README.md)。
> 动手改这个仓库之前，先读完本文件：它是「约定 + 操作手册」，写完改完怎么验也在里面。

## 一、这个仓库是什么

《拂晓：胜利之刻》活动地图的**路线规划器**，纯静态网页：

- **零依赖、零构建、零网络请求**：没有 `npm install`、没有打包、没有后端；`package.json` 里只有几个跑脚本的命令
- **打开方式就是双击 `index.html`**（`file://`）。为此全部用经典 `<script>` 标签加载，
  不用 ES module、不用 `fetch`，就是为了绕开 Chrome 在 `file://` 下的 CORS 拦截
- 数据是 `.js` 文件里赋值全局变量（`window.FX_SHIPS` 等），不是 JSON

核心链路：`data/maps/*.js`（图 + 每段的条件）→ `app/graph.js`（枚举路线）→
`app/conditions.js`（判带路条件 / 冲突）→ `app/oil.js`（油耗 / 弹药 / 代币）+ `app/coverage.js`（覆盖规划）
→ `app/map-ui.js` / `app/fleet-ui.js` / `app/main.js`（渲染与装配）。

## 二、文档地图（谁写给谁看）

改动涉及文档时，**保持「读者」标注准确**：每篇开头第一行都有 `> **读者：人 / AI**` 横幅。

| 文件 | 读者 | 内容 |
|---|---|---|
| [README.md](README.md) | 人 | 入口：下载打开 + 选路线 / 带路条件 / 覆盖规划 |
| [docs/使用详解.md](docs/使用详解.md) | 人 | 全部界面细节、条件全表、油耗、覆盖规划选项、路线历史、启动排查、已知空缺 |
| [docs/进阶-舰灵库录入.md](docs/进阶-舰灵库录入.md) | 人 | 舰灵字段与录入、数据三层、导出导入 |
| [docs/进阶-编队.md](docs/进阶-编队.md) | 人 | 建编队、选船、合并统计、条件实时对比 |
| [local/README.md](local/README.md) | 人 | 本机私有数据覆盖层 |
| **AGENTS.md**（本文件） | AI | 仓库约定、命令、不变量 |
| [tools/README.md](tools/README.md) | AI | 采集与校验工具链、地图采集流程 |
| [docs/舰灵库批量录入.md](docs/舰灵库批量录入.md) | AI | 从游戏截图批量建舰灵库的采集流程 |
| `local/docs/*` | AI | 本机私人笔记，**不进 git**，不要引用进仓库文档 |

## 三、目录结构

```
index.html              入口（script 标签顺序即加载顺序）
app/
  conditions.js         带路条件求值 + 冲突检测
  graph.js              图模型：路线枚举 + 路线分析
  oil.js                油耗/弹药/一轮代币 + 出战队伍自动分配
  coverage.js           覆盖规划（位掩码 DP）
  store.js              状态持久化 + 文件/草稿按 id 合并 + 导出导入
  map-ui.js             地图 SVG 渲染与交互
  fleet-ui.js           舰灵库与编队编辑界面
  history-file.js       路线历史落盘（手动导出 / 绑定 local/ 目录自动写）
  main.js               装配与启动（含模块自检 + 补载）
  style.css
data/
  maps/index.js         地图清单（新增活动加一行）
  maps/*.js             每张活动图的数据
  factions.js           阵营 ↔ 国家 映射
  shiptypes.js          舰种/吨位枚举
  ships.js              舰灵库（仓库里是空模板，必须保持）
  fleets.js             编队（仓库里是空模板，必须保持）
docs/                   人看的文档 + AI 看的采集流程
local/                  本机私有覆盖层，只有 README.md 进 git
tools/                  采集与校验脚本（见 tools/README.md）
shots/ tools/preview/ tools/batches/   采集中间产物，gitignore，绝不要提交
```

## 四、常用命令

```bash
npm test                        # = validate_map + validate_ships + test_core（零依赖，不需要 install）
node tools/validate_map.js       # 图校验 + 路线枚举，要 0 错误 0 警告
node tools/validate_ships.js     # 舰灵库校验（舰种/国籍逐字、油耗、id 重复）；空库放行
node tools/test_core.js          # 核心逻辑单测（210 项）
node tools/plan_coverage.js --allow-retreat --verify   # 覆盖规划命令行版 + 暴力枚举交叉验证
npm run privacy                  # 发布前自查：本机路径 / 账号数据 / 私人口吻，命中即非 0
node tools/check_privacy.js --list   # 只列出会被提交的文件
python tools/serve.py            # http 预览（带 Cache-Control: no-store），可选
```

**改任何核心逻辑后必须跑 `npm test`。** 只改文档也要跑 `npm run privacy`。

## 五、不许破坏的不变量（硬约束）

1. **`data/ships.js` / `data/fleets.js` 必须是空模板**（`window.FX_SHIPS = [];` / `window.FX_FLEETS = [];`）。
   `check_privacy.js` 会直接检查这两行；把真实数据写进去 = 泄露账号数据
2. **同一艘船不能编入两个队伍**。重复编入会让「两队合并」的计数重复、条件和油耗静默算错，
   增删必须走 `FX.store`
3. **带路条件是单谓词**（一条岔口一条 `cond`），求值基准是**两队合并**；运算符要同时认全角
   `≥ ≤` 和半角 `>= <=`（游戏原文是全角，曾因只认半角导致条件恒判失败）
4. **油耗**：油点返还取「上一个战斗节点出战队伍」的一半、向下取整；三倍是**先乘三再取整**
   （F=55 时一倍返 27、三倍返 82）；每队每轮 ≤5 战；BOSS 点必须强队
5. **阵营名逐字**：`凤棲` 是「木 + 妻」不是「凤栖」（AI识别错过）；`纳榭尔` 的「榭」是「木 + 射」。
   地图数据引用的阵营必须都在 `data/factions.js` 里
6. **`file://` 兼容**：不许引入 ES module / `fetch`（除非带降级）；`<script src>` 在 `file://` 下
   **不能带查询串**（会被当成文件名的一部分）
7. **`local/` 下只有 `local/README.md` 能进仓库**，其余全部 gitignore；`shots/`、`tools/preview/`、
   `tools/batches/`、`tools/raw_ships.json` 同理
8. **文件层与草稿层按 id 合并**（草稿优先 / 文件补充 / 墓碑挡删除），别改成「二选一」覆盖
9. **模块自检机制**：`index.html` 里的静态标签只是首选，`app/main.js` 会检查并补载缺失模块。
   新增模块要登记进那套机制，而不是只加一行 `<script>`

## 六、改哪里

| 想改的东西 | 文件 |
|---|---|
| 条件语义 / 冲突检测 / 取值区间 | `app/conditions.js` |
| 路线枚举、节点可达性 | `app/graph.js` |
| 油耗 / 弹药 / 代币 / 出战分配 | `app/oil.js`（代币单价在 `TOKEN_REWARD`） |
| 覆盖规划 | `app/coverage.js`（网页端与 `tools/plan_coverage.js` 共用） |
| 界面 | `app/map-ui.js`、`app/fleet-ui.js`、`app/main.js`、`app/style.css` |
| 持久化 / 合并 / 导出导入 | `app/store.js` |
| 历史落盘 / 目录绑定 | `app/history-file.js` |
| 地图数据 | `data/maps/*.js`（新增图见下） |

## 七、新增一张活动地图

1. 照 `data/maps/bolanhui.js` 的格式新建 `data/maps/<活动名>.js`，用 `window.FX_MAPS.push({...})` 注册
2. 在 `data/maps/index.js` 的文件名数组里加一行
3. 采集节点坐标 / 面板 / 掉落的方法见 [tools/README.md](tools/README.md)（含坑与自动化脚本）
4. `node tools/validate_map.js` 必须 **0 错误 0 警告**
5. 条件里的阵营名逐字核对；BOSS 用 `bosses: [{type, count, armor}]` 数组（一个点可能有多个 BOSS）

## 八、文档写作约定

- **每篇文档开头第一行**写读者横幅：`> **读者：人。** …` 或 `> **读者：AI 助手。** …`；
  混合受众写「人 / AI」并说明主读者
- **尽量不要用 emoji**：标「谁看」用文字「读者：人 / AI 助手」，不要用人物 / 机器人图标；
  正文只保留 UI 或脚本**真实输出**的符号（`✓` `✗` `?` `→` `⚠`），不要拿它们当装饰
- 只写**相对路径**链接；不要写本机绝对路径、用户名目录、个人游戏进度、私人笔记口吻
  （`npm run privacy` 会因为这些直接失败）
- 不要在 `.md` 里堆放**整份私有舰灵库**（≥5 个真实舰名会被判为泄露）；讲规则时用 `某舰` 这类占位
- 文档里的结论要能被命令验证（测试项数、路线条数、覆盖规划战数等），**数据变了要同步更新**

## 九、提交前

```bash
npm test && npm run privacy     # 两条都过
node tools/check_privacy.js --list   # 肉眼确认没有采集产物混进来
```

**推送 / 提交由人决定**：没有明确指示就不要 `git push`。
