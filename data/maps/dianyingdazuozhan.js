/* 拂晓：胜利之刻 —— 活动地图数据
 * 地图: 电影大作战 / 地狱EX
 * 版本形态: 限时活动 —— 掉落列表第 0 槽是首通卡（标「已领取」；普通战斗点 80、BOSS 180），
 *          金色掉落头像右上角带「掉落UP」绿标。
 * 数据来源: 手机（USB adb）游戏内逐节点点击读取（点节点 -> 「起始点 / 战斗点 / 战斗点(BOSS) / 补给点」面板）
 *          采集于 2026-10-22，地图界面显示「剩余时间 21天」「等级需求 Lv.35」。
 *          采集设备是 2316x1080 横屏，所以 screen 记的是这个尺寸，节点坐标就是截图原图像素
 *          （app/map-ui.js 与 app/coverage.js 都按 map.screen 的坐标系画图 / 采样）。
 *
 * 图结构性质（已校验）:
 *   - 有向图，无双向边；无环：每条边都朝终点一侧推进
 *   - 起点 START 只有 1 条出边（A，无条件）
 *   - 岔口 6 处：B、E、H、J、L、O
 *   - 终点共 4 个：I（普通战斗点，没有出边 = 死路）、M（补给点，面板只有「可取得50%燃料」一行）、
 *     P / Q（BOSS，面板上只有大卡片 + 掉落列表 + 敌人列表）
 *   - 补给点 3 个：F / M 是油点（面板「可取得50%燃料」，绿色油罐图标），
 *     G 是回血点（面板「可回复血量」，绿色爱心图标）—— 游戏里都叫「补给点」，靠 effect.kind 区分
 *
 * 条件语义（next[].cond 为谓词数组）:
 *   scope: "旗舰" | "舰队"
 *     - "旗舰": 对两队的旗舰计数。如 {scope:"旗舰",kind:"舰种",key:"战列",op:"≥",n:1}
 *               = 两个旗舰里舰种是战列的数量 ≥1
 *     - "舰队": 对两队合并计数（舰灵数/均速/索敌也是两队合并值）
 *   kind:  "舰种" | "阵营" | "舰灵数" | "均速" | "索敌"
 *   key:   舰种(驱逐/轻巡/重巡/战列/战巡/航母/轻母/…)、阵营(列加杜/…)，或 null
 *
 *   本图每条岔口都只有一条谓词（不存在「且」）。
 *   E 点的两条分支原文是「旗舰为 战列≥1」/「旗舰不为 战列」：
 *   前者按 旗舰中舰种=战列 的数量 ≥1 求值，后者 = 两个旗舰都不是战列（数量 <1 = 0），
 *   两者合起来正好切分。
 *
 * 掉落稀有度横条颜色: 金 > 紫 > 蓝 > 绿（头像顶端横条）。本图 P、Q 各只有 1 个金色掉落，
 * 且都带「掉落UP」绿标（已用 scan_dropbars.ps1 扫横条 + 点开「信息」窗读出舰名确认）。
 */

window.FX_MAPS = window.FX_MAPS || [];
window.FX_MAPS.push({
  id: "dianyingdazuozhan-dex",
  event: "电影大作战",
  difficulty: "地狱EX",
  levelRequirement: 35,
  screen: { w: 2316, h: 1080 },
  start: "START",

  nodes: {
    // 起始点。面板原文: 可是这儿什么都没有～ (ノ>ω<)ノ
    // 图标是地图右侧的蓝色 pin（上方「▶ STORY」之类的 HUD 覆盖层不是节点本身）
    START: {
      label: "起点", type: "start", icon: "pin", x: 1757, y: 555,
      next: [
        { to: "A", prob: "大", raw: "无条件", cond: [] }
      ]
    },

    A: {
      label: "A", type: "battle", icon: "hex", x: 1662, y: 758, lv: 65,
      next: [ { to: "B", prob: "大", raw: "无条件", cond: [] } ]
    },

    B: {
      label: "B", type: "battle", icon: "hex", x: 1518, y: 560, lv: 65,
      next: [
        { to: "C", prob: "中", raw: "舰队中<列加杜>数量≥2", cond: [ { scope: "舰队", kind: "阵营", key: "列加杜", op: "≥", n: 2 } ] },
        { to: "D", prob: "中", raw: "舰队中<列加杜>数量<2", cond: [ { scope: "舰队", kind: "阵营", key: "列加杜", op: "<", n: 2 } ] }
      ]
    },

    C: {
      label: "C", type: "battle", icon: "hex", x: 1613, y: 376, lv: 65,
      next: [ { to: "E", prob: "大", raw: "无条件", cond: [] } ]
    },

    D: {
      label: "D", type: "battle", icon: "hex", x: 1375, y: 755, lv: 65,
      next: [ { to: "H", prob: "大", raw: "无条件", cond: [] } ]
    },

    E: {
      label: "E", type: "battle", icon: "hex", x: 1421, y: 423, lv: 65,
      next: [
        { to: "F", prob: "中", raw: "旗舰为 战列≥1", cond: [ { scope: "旗舰", kind: "舰种", key: "战列", op: "≥", n: 1 } ] },
        { to: "G", prob: "中", raw: "旗舰不为 战列", cond: [ { scope: "旗舰", kind: "舰种", key: "战列", op: "<", n: 1 } ] }
      ]
    },

    // 补给点: 返还「上一个战斗节点出战队伍」的一半油（面板原文「可取得50%燃料」）
    F: {
      label: "F", type: "supply", icon: "can", x: 1230, y: 270,
      effect: { kind: "fuel", percent: 50, basis: "上一战斗节点的出战队伍油耗" },
      next: [ { to: "J", prob: "大", raw: "无条件", cond: [] } ]
    },

    // 补给点: 回血（面板原文「可回复血量」），不进油耗 / 弹药模型
    G: {
      label: "G", type: "supply", icon: "heart", x: 1231, y: 421,
      effect: { kind: "heal", raw: "可回复血量" },
      next: [ { to: "J", prob: "大", raw: "无条件", cond: [] } ]
    },

    H: {
      label: "H", type: "battle", icon: "hex", x: 1085, y: 802, lv: 65,
      next: [
        { to: "I", prob: "中", raw: "舰队中 驱逐 数量<2", cond: [ { scope: "舰队", kind: "舰种", key: "驱逐", op: "<", n: 2 } ] },
        { to: "K", prob: "中", raw: "舰队中 驱逐 数量≥2", cond: [ { scope: "舰队", kind: "舰种", key: "驱逐", op: "≥", n: 2 } ] }
      ]
    },

    // 终点（普通战斗点，没有出边）。面板是「大卡片 + 掉落列表 + 敌人列表」的终点版式。
    // 敌人: 装母×4 雷巡×4 驱逐×4 轻母×3 战巡×2，敌人等级 LV.65，建议索敌 407 / 建议制空 199
    I: {
      label: "I", type: "battle", icon: "hex", x: 1230, y: 895, lv: 65,
      terminal: true,
      next: []
    },

    J: {
      label: "J", type: "battle", icon: "hex", x: 1036, y: 378, lv: 65,
      next: [
        { to: "L", prob: "中", raw: "舰队中 重巡 数量≥2", cond: [ { scope: "舰队", kind: "舰种", key: "重巡", op: "≥", n: 2 } ] },
        { to: "N", prob: "中", raw: "舰队中 重巡 数量<2", cond: [ { scope: "舰队", kind: "舰种", key: "重巡", op: "<", n: 2 } ] }
      ]
    },

    K: {
      label: "K", type: "battle", icon: "hex", x: 895, y: 752, lv: 65,
      next: [ { to: "L", prob: "大", raw: "无条件", cond: [] } ]
    },

    L: {
      label: "L", type: "battle", icon: "hex", x: 892, y: 520, lv: 65,
      next: [
        { to: "M", prob: "中", raw: "舰队均速值>30",  cond: [ { scope: "舰队", kind: "均速", key: null, op: ">",  n: 30 } ] },
        { to: "O", prob: "中", raw: "舰队均速值≤30", cond: [ { scope: "舰队", kind: "均速", key: null, op: "≤", n: 30 } ] }
      ]
    },

    // 终点（补给点）。面板上只有「可取得50%燃料」，没有任何后续节点行。
    M: {
      label: "M", type: "supply", icon: "can", x: 705, y: 515,
      effect: { kind: "fuel", percent: 50, basis: "上一战斗节点的出战队伍油耗" },
      terminal: true,
      next: []
    },

    N: {
      label: "N", type: "battle", icon: "hex", x: 893, y: 329, lv: 65,
      next: [ { to: "O", prob: "大", raw: "无条件", cond: [] } ]
    },

    O: {
      label: "O", type: "battle", icon: "hex", x: 750, y: 396, lv: 65,
      next: [
        { to: "P", prob: "中", raw: "舰队中没有 航母", cond: [ { scope: "舰队", kind: "舰种", key: "航母", op: "<", n: 1 } ] },
        { to: "Q", prob: "中", raw: "舰队中 航母 数量≥1", cond: [ { scope: "舰队", kind: "舰种", key: "航母", op: "≥", n: 1 } ] }
      ]
    },

    // BOSS 点。敌人列表里只有 1 个带红色 BOSS 横幅的敌人（航母×2），卡片与盾牌都是中甲（金）。
    P: {
      label: "P", type: "boss", icon: "skull", x: 606, y: 432, lv: 65,
      bosses: [ { type: "航母", count: 2, armor: "中甲" } ],
      token: "活动代币（限时活动版）：第0槽是首通卡 180（只发一次）；可重复获得的那张在掉落列表靠后位置（滑到不能再滑一般能看到）",
      goldDrops: [ { name: "利托里奥", faction: "列加杜", shipType: "战列", shipClass: "维内托级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    },

    // BOSS 点。敌人列表里只有 1 个带红色 BOSS 横幅的敌人（轻母×3），卡片与盾牌都是轻甲（白）。
    Q: {
      label: "Q", type: "boss", icon: "skull", x: 655, y: 311, lv: 65,
      bosses: [ { type: "轻母", count: 3, armor: "轻甲" } ],
      token: "活动代币（限时活动版）：第0槽是首通卡 180（只发一次）；可重复获得的那张在掉落列表靠后位置（滑到不能再滑一般能看到）",
      goldDrops: [ { name: "维内托", faction: "列加杜", shipType: "战列", shipClass: "维内托级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    }
  },

  /* 已知空缺 / 待确认:
   *  1. 本文件只录「地狱EX」。同一活动在游戏里还有「普通 / 困难 / 地狱」三档，
   *     按仓库既有约定（bolanhui / pinganye / luoxiafengying 同样只录地狱EX）只录这一档；
   *     其他档的图结构未采集，不要拿这份数据的节点字母去套其它难度。
   *  2. 普通战斗点只记了 敌人等级 LV.65（与既有图一致），编成没有逐个录入：
   *     实测「建议索敌」全为 407，「建议制空」0~367（A=80 B=367 C=92 D=0 E=195 H=199
   *     J=80 K=0 L=0 N=80 O=0）。终点 I 的编成已读全，写在 I 的注释里。
   *  3. 代币：首通卡读到 普通战斗点 80（A / I）、BOSS 180（P / Q），只发一次。
   *     可重复获得的那张（一轮收益）没有逐点滑到底读，页面按 app/oil.js 的 TOKEN_REWARD
   *     估算（普通战斗点 40 / BOSS 90）；若实测与估算不符改那一处。
   *  4. 采集设备是 2316x1080 横屏手机，所以 screen 是 2316x1080。页面画图与拖截图识别
   *     都按这个坐标系走（见 app/map-ui.js / app/coverage.js）；换设备截图要同比例才能识别。
   *  5. node coords 已用「把 now.png 丢给 coverage.sampleVisited 复算已通过状态」验证过：
   *     同一张截图算出的 已通过 = A B C E J N O P、未通过 = D H I K L Q，与画面一致。
   *  6. I（战斗点终点）和 M（补给点终点）都写了 terminal: true —— 这两个点面板上确实
   *     没有后续节点行，不是漏采；validate_map 靠这个标记把它们和"真的漏了出边"区分开。
   */
});
