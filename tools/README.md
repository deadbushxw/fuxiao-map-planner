# tools/ —— 拂晓活动地图采集工具链

> **读者：AI 助手。** 这是采集 / 校验工具链的操作手册，主要给按步骤执行的 AI 用，人也可以照着手动跑。
> 只是**用**这个工具的话，看 [README.md](../README.md) 和 [docs/使用详解.md](../docs/使用详解.md) 就够了。

## 运行环境

**用 PowerShell 7 (`pwsh`)，不要用 Windows PowerShell 5.1。**

```bash
pwsh -File tools/detect_nodes.ps1 -Image <截图路径>
```

本机 pwsh 在 `C:\Program Files\PowerShell\7\pwsh.exe`（已在 PATH 上，版本 7.6.6）。

为什么必须用 7：Windows PowerShell 5.1 默认按 GBK 解码 `.ps1` 文件，脚本里的中文注释（UTF-8 字节）可能被错误解码，**吃掉紧随其后的换行符**，导致 `param()` 那一行被并入注释块、参数绑定全部失效。这个坑跟具体是哪些汉字有关，同一个脚本换个词就从"能用"变成"不能用"，很难排查。pwsh 7 默认 UTF-8，不存在这个问题。

若确实要用 5.1，脚本必须存成**带 BOM 的 UTF-8**（所有工具脚本目前都带 BOM，两种 shell 都能跑）。

## 另一个坑：Git Bash 的路径转换

在 Git Bash 里调 adb 时，`/sdcard/xxx.png` 这类参数会被 MSYS 自动转换成 `D:/Program Files/Git/sdcard/xxx.png`，导致 `screencap` / `pull` 静默失败。必须加：

```bash
export MSYS_NO_PATHCONV=1
# 目标路径要写成 Windows 风格（正斜杠即可）
adb -s emulator-5556 pull /sdcard/_cap.png "<项目目录>/shots/A.png"
```

## adb 在哪

`tools/dock.js` 与 `tools/adbcap.sh` 都按同一套顺序找 adb，**不要把绝对路径写进代码**：

1. 环境变量 `ADB`（可执行文件全路径）
2. `ANDROID_HOME` / `ANDROID_SDK_ROOT` 下的 `platform-tools/adb`
3. `PATH` 里的 `adb`

设备 serial 默认 `emulator-5556`，模拟器重连后可能变；`adbcap.sh` 用 `ADB_SERIAL` 覆盖，`dock.js` 会自动挑一个在线设备。

## 工具清单

| 工具 | 用途 |
|---|---|
| `detect_nodes.ps1` | 按图标颜色自动定位节点中心坐标（蓝=战斗点六边形 / 红=boss骷髅 / 绿=油罐爱心 / 灰=未探明）。加 `-Overlay` 出叠加图复核，加 `-Loose` 打印全部候选簇排查漏检 |
| `calibrate_colors.ps1` | 采样指定坐标周围的真实 RGB 直方图。新活动图标配色可能变化，先用它采样再改 `detect_nodes.ps1` 里的 `Get-Class` 阈值 |
| `crop_grid.ps1` | 裁剪指定区域并叠加"设备像素坐标"网格，用于肉眼读取节点坐标 |
| `compose_rows.ps1` | 把多个面板截图的指定横带纵向拼成长图，一次读图录入多条数据（省 context 的关键） |
| `scan_dropbars.ps1` | 扫描掉落列表头像顶端"品质横条"颜色，判定 金/紫/蓝/绿 |
| `validate_map.js` | 校验地图数据（目标合法、无双向边、可达性、终点一致性）并枚举全部路线 |
| `validate_ships.js` | 校验 `data/ships.js` 舰灵库（舰种/国籍是否逐字匹配、油耗是否合法、id 是否重复），并打印舰种/国籍分布 |
| `plan_coverage.js` | 覆盖规划命令行版：最少总战数走遍未通过的战斗节点。求解逻辑在 `app/coverage.js`，和网页端共用 |
| `test_core.js` | 核心逻辑单测（条件/冲突/油耗/自动分配/覆盖规划/阵营表/像素分类/编队占用/搜索排序/BOSS 装甲/一轮代币/路线历史/未绑定横幅），210 项 |
| `check_privacy.js` | 发布前自查：扫描**已入库**的文件，看有没有混进本机路径、账号数据或个人进度。有命中就非 0 退出 |
| `fixtures/` | 测试夹具。`node-icon-samples.json` 是从真实游戏截图采样的节点像素，用于回归测试"已通过"颜色分类器 |

## 覆盖规划命令行

```bash
node tools/plan_coverage.js --allow-retreat --verify
node tools/plan_coverage.js --done=A,C,F,G,J --allow-retreat
node tools/plan_coverage.js --exclude-boss --objective=runs
```

`--verify` 会用暴力枚举交叉验证 DP 的结果，改过求解逻辑后建议带上。

## 采集新活动地图的流程

1. **定位坐标**：对地图截图跑 `detect_nodes.ps1`，蓝色节点和油点/boss 能自动出来；灰色六边形与地图虚线同色、无法自动分离，用 `crop_grid.ps1` 出网格图肉眼读。
2. **批量采面板**：用 adb 循环对每个坐标 `tap → screencap → pull → BACK`。注意 **面板是模态的，必须 BACK 关闭才能点下一个**；并且用截图体积判断面板是否真的打开（地图态约 2.0MB，战斗点约 1.3MB，boss 约 1.46MB，补给点约 1.08MB），**只有确认打开才按 BACK**，否则会误触把游戏推离地图。
3. **读数据**：`compose_rows.ps1` 把各面板的"标题+条件行"横带拼成 5 个一组的几张长图，逐张读图录入。
4. **boss 掉落**：先用 `scan_dropbars.ps1` 扫出哪个槽位是金条（一般第 1 槽，第 0 槽是活动代币卡），再点击该头像弹出「信息」窗读出舰名/国籍/舰种。注意金色掉落判据是**头像顶端金色横条**，不是"金发角色"。
5. **boss 装甲与数量**：面板上那张大卡片**只显示第一个 BOSS 的装甲类型**，但一个 boss 点可能有**多个 BOSS 敌人**、装甲类型可能不止一种（本图 S 点就是 轻巡=轻甲 + 战巡=中甲）。要点：
   - 数「敌人列表」里带红色 `BOSS` 横幅的条目才算 BOSS 敌人（普通敌人没有横幅）
   - 每个敌人头像**左上角的小盾牌颜色 = 装甲类型**，这是唯一能拿到第二个 BOSS 装甲的途径：
     **白 ≈(237,237,237) = 轻甲　金 ≈(255,228,71) = 中甲　红 ≈(255,79,82) = 重甲**
     已用三个 boss 点交叉验证：O 卡片写「重甲」而它的 BOSS 盾牌是红、Q 卡片「中甲」盾牌金、S 卡片「轻甲」盾牌白
   - 盾牌颜色可直接程序化采样：本图敌人列表第一、二个图标左上角的盾牌中心约在 (467,763) 与 (622,763)
   - 数据里用 `bosses: [{type, count, armor}]` 数组记录，**不要只写一个 `armor` 字符串**，否则会丢掉多余 BOSS 的信息
6. **校验**：`node tools/validate_map.js` —— 0 错误 0 警告才算通过，同时会输出全部路线（含战斗数、油点在第几战后、终点装甲）。

原始面板截图与读图中间产物**都不入库**（`shots/`、`tools/preview/` 已在 `.gitignore` 里）：
它们体积大，而且截图文件名和内容会带出账号信息。自己采集时照这两个目录名放即可。

## 舰灵库采集流水线

> 想用这条流水线批量建库，先看 [../docs/舰灵库批量录入.md](../docs/舰灵库批量录入.md) —— 读图规则和范围约定都在那里。
> `tools/batches/` 与 `tools/raw_ships.json` 是从**你自己账号**采出来的中间数据，已 gitignore，不进仓库。

船坞 →「属性 TYPE 2」数值卡视图（显示 装填/机动/命中/索敌/幸运/**消耗**/**航速**），
用「筛选」分批：**轴A 按 13 个舰种**（一次拿到 舰名+消耗+航速+舰种），
**轴B 按 10 个国籍**（拿 舰名+国籍）。两轴按舰名交叉验证。

```bash
node tools/dock.js state                      # 看当前界面
node tools/dock.js sel                        # 看筛选面板勾了什么
node tools/dock.js mode 2                     # 切到 属性 TYPE 2 (下拉第 2 项)
node tools/dock.js sweep shiptype 驱逐,轻巡    # 逐批: 设筛选 -> 回顶 -> 滚动采集 -> 出读图长条
node tools/dock.js sweep faction 八咫
node tools/ingest_batches.js                  # tools/batches/*.txt -> raw_ships.json
node tools/build_ships.js                     # raw_ships.json -> data/ships.js
node tools/validate_ships.js
```

数据源是 `tools/batches/<舰种>.txt`（每行 `舰名 消耗 航速`）和
`tools/batches/fac_<国籍>.txt`（每行 `舰名`），改完跑 ingest + build 即可。

### 采集上踩过的坑（都在 dock.js 里处理了）

1. **筛选面板是「全部 + 多选」语义**：点具体项会追加；点「全部」会重置成全部，
   而「全部」被选中时点一个具体项会变成只选那一项。所以要精确选单项，固定走
   「点全部 → 点目标」。另外**两条轴是叠加的**，切换轴前必须把另一轴复位，
   否则 `舰种=水母 ∩ 国籍=沃尔克` 这种组合会把列表清空，看着像"这批没船"。
2. **按钮正中央是文字**（白字/深字），单点采样颜色会判错，必须按区域取比例。
3. **滚动位移会飘**（实测 300~848px）。一张卡片要被完整读到，行顶必须落在
   ~562px 宽的窗口内；某步 >562px 且不是 424 的整数倍时就会**整排漏掉**
   （曾经因此丢掉一整排航母、以及好几艘驱逐，逐批核对数量才发现）。
   现在用小步滑 + 逐步测量，步长超过安全窗口会打印 ⚠。
4. **测量位移不能用纯 SAD**：行距 424 是周期性的，纯 SAD 会锁到相邻行报出假的
   ~424，凭空多出一行。现在先用两次截图里第一张完整卡片的
   行顶相位算出余数，只在该余数的三个候选里比 SAD。
5. **不做画布拼接**：接缝正好压在某一行的「消耗」上会把数字切掉。改成每一行都从
   "把它摆得最好"的那一屏单独取带。
6. **模拟器重连后 serial 会变**（`emulator-5556` ↔ `127.0.0.1:7555`），dock.js 会
   自动挑一个在线设备。
