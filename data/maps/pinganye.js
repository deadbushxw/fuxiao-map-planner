/* 拂晓：胜利之刻 —— 活动地图数据
 * 地图: 平安夜的小惊喜 / 地狱EX
 * 数据来源: 游戏内逐节点点击读取（点节点 -> 「起始点 / 战斗点 / 战斗点(BOSS) / 补给点」面板）
 *          采集流程与复查方法见 tools/README.md
 *
 * 图结构性质（已校验）:
 *   - 有向图，无双向边（不存在 A->B 同时 B->A）
 *   - 不存在环：所有边的目标节点严格位于「起点一侧」更深处
 *   - 起点 START 有 3 条出边（A/B/C，按舰队里 战列/重巡/航母 各≥1 分流）
 *   - 终点共 5 个：I、Q（补给点）、J（普通战斗点，走到这里是死路）、S、T（BOSS）
 *     注意 J 是「普通战斗点却没有出边」，这不是漏采：
 *     H 点用「舰队中 驱逐 数量<2」把人送进 J，进去之后就没有后续了。
 *     同理 I、Q 是补给点，面板上只有「可取得50%燃料」一行，没有后续节点行。
 *
 * 条件语义（key.cond 为单谓词，不存在"且"）:
 *   scope: "旗舰" | "舰队"
 *     - "旗舰": 对两队的旗舰计数。如 {scope:"旗舰",kind:"舰种",key:"战巡",op:"=",n:1}
 *               = 两个旗舰中舰种为战巡的数量 = 1
 *     - "舰队": 对两队合并计数（舰灵数/索敌/均速也是两队合并值）
 *   kind:  "舰种" | "阵营" | "舰灵数" | "均速" | "索敌"
 *   key:   舰种(驱逐/轻巡/重巡/战列/战巡/航母/轻母/装母/…)、阵营(尤奈特/洛蒙瑞亚/…)，或 null
 *
 * 掉落稀有度横条颜色: 金 > 紫 > 蓝 > 绿（头像顶端横条）。本图两个 boss 各只有 1 个金色掉落。
 *
 * ★ 这张图属于「档案」，但数据按「限时活动」版本记录（重要）
 *   本图最初是限时活动，经过一次复刻、一次闪回后转成了常驻活动（游戏内命名「档案」）。
 *   档案**没有**对应的代币商店、也**没有**掉落加成，所以现在进游戏看这张图：
 *     - 掉落列表第 0 槽直接就是舰灵，没有活动代币卡；
 *     - 金色头像右上角没有「掉落UP」绿标。
 *   这两点都是档案的正常样子，**不是数据缺失，也不是采集漏了**。
 *   按项目约定，地图数据一律按「限时活动」版本记录（保留 token、金色掉落 up=true），
 *   页面上切到「档案」模式时会自动忽略代币与掉落加成，详见 README「限时活动与档案」。
 *   （首次活动 / 复刻 / 闪回 在地图掉落上完全一致，本工具不再细分这三种。）
 */

window.FX_MAPS = window.FX_MAPS || [];
window.FX_MAPS.push({
  id: "pinganye-dex",
  event: "平安夜的小惊喜",
  difficulty: "地狱EX",
  screen: { w: 1920, h: 1080 },
  start: "START",

  nodes: {
    // 起始点面板原文: 可是这儿什么都没有～ (ノ>ω<)ノ
    // 图标是地图右上角的蓝色 pin（上面叠着「经验UP」绿标，那是经验加成标记，不是节点本身）
    START: {
      label: "起点", type: "start", icon: "pin", x: 1605, y: 168,
      next: [
        { to: "A", prob: "中", raw: "舰队中 战列 数量≥1", cond: [ { scope: "舰队", kind: "舰种", key: "战列", op: "≥", n: 1 } ] },
        { to: "B", prob: "中", raw: "舰队中 重巡 数量≥1", cond: [ { scope: "舰队", kind: "舰种", key: "重巡", op: "≥", n: 1 } ] },
        { to: "C", prob: "中", raw: "舰队中 航母 数量≥1", cond: [ { scope: "舰队", kind: "舰种", key: "航母", op: "≥", n: 1 } ] }
      ]
    },

    A: {
      label: "A", type: "battle", icon: "hex", x: 1382, y: 176, lv: 65,
      next: [ { to: "D", prob: "大", raw: "无条件", cond: [] } ]
    },

    B: {
      label: "B", type: "battle", icon: "hex", x: 1486, y: 318, lv: 65,
      next: [ { to: "E", prob: "大", raw: "无条件", cond: [] } ]
    },

    C: {
      label: "C", type: "battle", icon: "hex", x: 1645, y: 462, lv: 65,
      next: [ { to: "F", prob: "大", raw: "无条件", cond: [] } ]
    },

    D: {
      label: "D", type: "battle", icon: "hex", x: 1157, y: 300, lv: 65,
      next: [
        { to: "G", prob: "中", raw: "舰灵数量<8",  cond: [ { scope: "舰队", kind: "舰灵数", key: null, op: "<", n: 8 } ] },
        { to: "I", prob: "中", raw: "舰灵数量≥8", cond: [ { scope: "舰队", kind: "舰灵数", key: null, op: "≥", n: 8 } ] }
      ]
    },

    E: {
      label: "E", type: "battle", icon: "hex", x: 1319, y: 450, lv: 65,
      next: [
        { to: "G", prob: "中", raw: "旗舰为 战巡=1", cond: [ { scope: "旗舰", kind: "舰种", key: "战巡", op: "=", n: 1 } ] },
        { to: "H", prob: "中", raw: "旗舰为 装母=1", cond: [ { scope: "旗舰", kind: "舰种", key: "装母", op: "=", n: 1 } ] }
      ]
    },

    F: {
      label: "F", type: "battle", icon: "hex", x: 1472, y: 633, lv: 65,
      next: [ { to: "H", prob: "大", raw: "无条件", cond: [] } ]
    },

    G: {
      label: "G", type: "battle", icon: "hex", x: 1068, y: 535, lv: 65,
      next: [
        { to: "K", prob: "中", raw: "舰队中<尤奈特>数量<2",  cond: [ { scope: "舰队", kind: "阵营", key: "尤奈特", op: "<", n: 2 } ] },
        { to: "M", prob: "中", raw: "舰队中<尤奈特>数量≥2", cond: [ { scope: "舰队", kind: "阵营", key: "尤奈特", op: "≥", n: 2 } ] }
      ]
    },

    H: {
      label: "H", type: "battle", icon: "hex", x: 1208, y: 687, lv: 65,
      next: [
        // 驱逐<2 会走进 J —— J 没有出边，这条路到此为止
        { to: "J", prob: "中", raw: "舰队中 驱逐 数量<2",  cond: [ { scope: "舰队", kind: "舰种", key: "驱逐", op: "<", n: 2 } ] },
        { to: "L", prob: "中", raw: "舰队中 驱逐 数量≥2", cond: [ { scope: "舰队", kind: "舰种", key: "驱逐", op: "≥", n: 2 } ] }
      ]
    },

    // 终点（补给点）。面板上只有「可取得50%燃料」，没有任何后续节点行。
    I: {
      label: "I", type: "supply", icon: "can", x: 958, y: 195,
      effect: { kind: "fuel", percent: 50, basis: "上一战斗节点的出战队伍油耗" },
      next: []
    },

    // 终点（普通战斗点，无出边）。面板是"大卡片 + 掉落列表 + 敌人列表"那种终点版式。
    // 敌人: 轻巡×6 雷巡×6 重巡×6 轻母×3 航母×3，敌人等级 LV.65，建议索敌 189 / 建议制空 389
    J: {
      label: "J", type: "battle", icon: "hex", x: 1115, y: 873, lv: 65,
      next: []
    },

    K: {
      label: "K", type: "battle", icon: "hex", x: 873, y: 583, lv: 65,
      next: [ { to: "N", prob: "大", raw: "无条件", cond: [] } ]
    },

    L: {
      label: "L", type: "battle", icon: "hex", x: 883, y: 768, lv: 65,
      next: [ { to: "O", prob: "大", raw: "无条件", cond: [] } ]
    },

    M: {
      label: "M", type: "battle", icon: "hex", x: 787, y: 355, lv: 65,
      next: [ { to: "P", prob: "大", raw: "无条件", cond: [] } ]
    },

    N: {
      label: "N", type: "battle", icon: "hex", x: 662, y: 605, lv: 65,
      // 三条分支按洛蒙瑞亚数量把 0 / 1 / ≥2 完整切分（注意 <1 就是 0）
      next: [
        { to: "R", prob: "中", raw: "舰队中<洛蒙瑞亚>数量≥2", cond: [ { scope: "舰队", kind: "阵营", key: "洛蒙瑞亚", op: "≥", n: 2 } ] },
        { to: "S", prob: "中", raw: "舰队中<洛蒙瑞亚>数量<1",  cond: [ { scope: "舰队", kind: "阵营", key: "洛蒙瑞亚", op: "<", n: 1 } ] },
        { to: "T", prob: "中", raw: "舰队中<洛蒙瑞亚>数量=1",  cond: [ { scope: "舰队", kind: "阵营", key: "洛蒙瑞亚", op: "=", n: 1 } ] }
      ]
    },

    O: {
      label: "O", type: "battle", icon: "hex", x: 670, y: 815, lv: 65,
      next: [
        { to: "Q", prob: "中", raw: "舰队索敌值<600",  cond: [ { scope: "舰队", kind: "索敌", key: null, op: "<", n: 600 } ] },
        { to: "S", prob: "中", raw: "舰队索敌值≥600", cond: [ { scope: "舰队", kind: "索敌", key: null, op: "≥", n: 600 } ] }
      ]
    },

    P: {
      label: "P", type: "battle", icon: "hex", x: 553, y: 425, lv: 65,
      next: [ { to: "R", prob: "大", raw: "无条件", cond: [] } ]
    },

    // 终点（补给点），同 I
    Q: {
      label: "Q", type: "supply", icon: "can", x: 482, y: 965,
      effect: { kind: "fuel", percent: 50, basis: "上一战斗节点的出战队伍油耗" },
      next: []
    },

    // 补给点: 返还"上一个战斗节点出战队伍"的一半油（面板原文"可取得50%燃料"）
    R: {
      label: "R", type: "supply", icon: "can", x: 396, y: 546,
      effect: { kind: "fuel", percent: 50, basis: "上一战斗节点的出战队伍油耗" },
      next: [ { to: "T", prob: "大", raw: "无条件", cond: [] } ]
    },

    // BOSS 点。敌人列表里只有 1 个带红色 BOSS 横幅的敌人，卡片与盾牌都是重甲。
    S: {
      label: "S", type: "boss", icon: "skull", x: 478, y: 777, lv: 65,
      bosses: [ { type: "装母", count: 1, armor: "重甲" } ],
      token: "活动代币（限时活动版：掉落列表第0槽 / 首通卡）",
      goldDrops: [ { name: "南达科他", faction: "尤奈特", shipType: "战列", shipClass: "南达科他级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    },

    // BOSS 点。只有 1 个 BOSS 敌人，卡片与盾牌都是中甲。
    T: {
      label: "T", type: "boss", icon: "skull", x: 355, y: 685, lv: 65,
      bosses: [ { type: "航母", count: 1, armor: "中甲" } ],
      token: "活动代币（限时活动版：掉落列表第0槽 / 首通卡）",
      goldDrops: [ { name: "新泽西", faction: "尤奈特", shipType: "战列", shipClass: "衣阿华级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    }
  },

  /* 已知空缺 / 待确认:
   *  1. 代币和「掉落UP」是按**限时活动版本**记的，属于推断而不是实测：
   *     本图现在已是档案，游戏内这两项都看不到（代币卡不显示、金色头像没有UP绿标），
   *     已经把档案态截图和上一期限时活动 bolanhui 的截图逐像素对照过，确认差异是模式造成的。
   *     本图金色掉落就这 2 只（S=南达科他 / T=新泽西），故都记 up=true；
   *     若你确认当年首次活动并非两只都带UP，把对应的 up 改回 false 即可。
   *  2. 活动代币的具体数量没有读到（档案态没有代币卡）。
   *     本工具也不需要这个数：一轮收益按 BOSS 90 / 普通战斗点 40 估算，
   *     数值集中在 app/oil.js 的 TOKEN_REWARD，实测有出入改那一处。
   *  3. 普通战斗点的敌人编成只读了 J 点（它是终点版式，能一次读全）；
   *     其余战斗点面板只列「敌人等级 LV.65 / 建议索敌 / 建议制空」，编成没有逐个录入
   *     —— 上一期 bolanhui 同样只给 boss 记 bosses[]，普通战斗点只记 lv。
   *  4. levelRequirement（进场等级门槛）地图界面上没有显示，未录入。
   */
});
