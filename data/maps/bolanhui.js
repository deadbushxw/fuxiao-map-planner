/* 拂晓：胜利之刻 —— 活动地图数据
 * 地图: 博览会的奇妙相遇 / 地狱EX
 * 版本形态: 限时活动 —— 有活动代币（掉落列表第0槽）和金船掉落UP。
 *          档案（常驻）图这两项都没有，页面上的「限时活动 / 档案」开关就是干这个的，
 *          见 README「限时活动与档案」。地图数据一律按限时活动版本记录。
 * 数据来源: 游戏内逐节点点击读取（点节点 -> 「战斗点/战斗点(BOSS)/补给点/起始点」面板）
 *          采集流程与复查方法见 tools/README.md
 *
 * 图结构性质（已校验）:
 *   - 有向图，无双向边（不存在 A->B 同时 B->A）
 *   - 本图是无环的（按最长路深度分层，所有边严格递增），但数据结构不依赖无环假设
 *   - 终点节点（O/Q/S）没有 next，面板上也没有条件行
 *
 * 条件语义（key.cond 为单谓词，不存在"且"）:
 *   scope: "旗舰" | "舰队"
 *     - "旗舰": 对两队的旗舰计数。如 {scope:"旗舰",kind:"舰种",key:"战列",op:"<",n:2}
 *               = 两个旗舰中舰种为战列的数量 < 2
 *     - "舰队": 对两队合并计数（舰灵数/索敌/均速也是两队合并值）
 *   kind:  "舰种" | "阵营" | "舰灵数" | "均速" | "索敌"
 *   key:   舰种(驱逐/轻巡/重巡/战列/战巡/航母/…)、阵营(奥鲁加/洛蒙瑞亚/…)，或 null
 *
 * 掉落稀有度横条颜色: 金 > 紫 > 蓝 > 绿（头像顶端横条），右上角绿色斜标 = 掉落UP
 *   本图三个 boss 各自只有 1 个金色掉落，且都带 UP。
 *   注意: 有些活动的 boss 会有 2 个金色掉落（可能一UP一非UP），非UP的会稀释掉落池（见 polluted 字段）。
 */

window.FX_MAPS = window.FX_MAPS || [];
window.FX_MAPS.push({
  id: "bolanhui-dex",
  event: "博览会的奇妙相遇",
  difficulty: "地狱EX",
  levelRequirement: 35,
  screen: { w: 1920, h: 1080 },
  start: "START",

  nodes: {
    START: {
      label: "起点", type: "start", icon: "pin", x: 383, y: 512,
      next: [ { to: "A", prob: "大", raw: "无条件", cond: [] } ]
    },

    A: {
      label: "A", type: "battle", icon: "hex", x: 537, y: 531, lv: 65,
      next: [
        { to: "B", prob: "中", raw: "旗舰为 战列<2", cond: [ { scope: "旗舰", kind: "舰种", key: "战列", op: "<", n: 2 } ] },
        { to: "C", prob: "中", raw: "旗舰为 战列=2", cond: [ { scope: "旗舰", kind: "舰种", key: "战列", op: "=", n: 2 } ] }
      ]
    },

    B: {
      label: "B", type: "battle", icon: "hex", x: 662, y: 391, lv: 65,
      next: [
        { to: "D", prob: "中", raw: "舰队中<奥鲁加>数量≥4", cond: [ { scope: "舰队", kind: "阵营", key: "奥鲁加", op: "≥", n: 4 } ] },
        { to: "E", prob: "中", raw: "舰队中<奥鲁加>数量<4",  cond: [ { scope: "舰队", kind: "阵营", key: "奥鲁加", op: "<", n: 4 } ] }
      ]
    },

    C: {
      label: "C", type: "battle", icon: "hex", x: 660, y: 658, lv: 65,
      next: [
        { to: "D", prob: "中", raw: "舰队均速值<34",  cond: [ { scope: "舰队", kind: "均速", key: null, op: "<", n: 34 } ] },
        { to: "G", prob: "中", raw: "舰队均速值≥34", cond: [ { scope: "舰队", kind: "均速", key: null, op: "≥", n: 34 } ] }
      ]
    },

    D: {
      label: "D", type: "battle", icon: "hex", x: 780, y: 533, lv: 65,
      next: [
        { to: "F", prob: "中", raw: "舰队中 航母 数量<3",  cond: [ { scope: "舰队", kind: "舰种", key: "航母", op: "<", n: 3 } ] },
        { to: "I", prob: "中", raw: "舰队中 航母 数量≥3", cond: [ { scope: "舰队", kind: "舰种", key: "航母", op: "≥", n: 3 } ] }
      ]
    },

    E: {
      label: "E", type: "battle", icon: "hex", x: 904, y: 377, lv: 65,
      next: [ { to: "H", prob: "大", raw: "无条件", cond: [] } ]
    },

    F: {
      label: "F", type: "battle", icon: "hex", x: 1010, y: 481, lv: 65,
      next: [ { to: "H", prob: "大", raw: "无条件", cond: [] } ]
    },

    G: {
      label: "G", type: "battle", icon: "hex", x: 780, y: 822, lv: 65,
      next: [
        { to: "I", prob: "中", raw: "舰队中 轻巡 数量<3",  cond: [ { scope: "舰队", kind: "舰种", key: "轻巡", op: "<", n: 3 } ] },
        { to: "J", prob: "中", raw: "舰队中 轻巡 数量≥3", cond: [ { scope: "舰队", kind: "舰种", key: "轻巡", op: "≥", n: 3 } ] }
      ]
    },

    H: {
      label: "H", type: "battle", icon: "hex", x: 1087, y: 363, lv: 65,
      next: [
        { to: "K", prob: "中", raw: "舰队中 重巡 数量<3",  cond: [ { scope: "舰队", kind: "舰种", key: "重巡", op: "<", n: 3 } ] },
        { to: "L", prob: "中", raw: "舰队中 重巡 数量≥3", cond: [ { scope: "舰队", kind: "舰种", key: "重巡", op: "≥", n: 3 } ] }
      ]
    },

    I: {
      label: "I", type: "battle", icon: "hex", x: 933, y: 641, lv: 65,
      next: [ { to: "K", prob: "大", raw: "无条件", cond: [] } ]
    },

    J: {
      label: "J", type: "battle", icon: "hex", x: 1000, y: 878, lv: 65,
      next: [ { to: "M", prob: "大", raw: "无条件", cond: [] } ]
    },

    K: {
      label: "K", type: "battle", icon: "hex", x: 1155, y: 636, lv: 65,
      next: [ { to: "M", prob: "大", raw: "无条件", cond: [] } ]
    },

    L: {
      label: "L", type: "battle", icon: "hex", x: 1272, y: 318, lv: 65,
      next: [
        { to: "N", prob: "中", raw: "舰灵数量<10",  cond: [ { scope: "舰队", kind: "舰灵数", key: null, op: "<", n: 10 } ] },
        { to: "P", prob: "中", raw: "舰灵数量≥10", cond: [ { scope: "舰队", kind: "舰灵数", key: null, op: "≥", n: 10 } ] }
      ]
    },

    M: {
      label: "M", type: "battle", icon: "hex", x: 1222, y: 801, lv: 65,
      next: [
        { to: "O", prob: "中", raw: "舰队中 驱逐 数量≥4", cond: [ { scope: "舰队", kind: "舰种", key: "驱逐", op: "≥", n: 4 } ] },
        { to: "Q", prob: "中", raw: "舰队中 驱逐 数量<4",  cond: [ { scope: "舰队", kind: "舰种", key: "驱逐", op: "<", n: 4 } ] }
      ]
    },

    N: {
      label: "N", type: "battle", icon: "hex", x: 1305, y: 505, lv: 65,
      next: [
        { to: "P", prob: "中", raw: "舰队索敌值<800",  cond: [ { scope: "舰队", kind: "索敌", key: null, op: "<", n: 800 } ] },
        { to: "S", prob: "中", raw: "舰队索敌值≥800", cond: [ { scope: "舰队", kind: "索敌", key: null, op: "≥", n: 800 } ] }
      ]
    },

    // 终点（boss）。next 为空 —— 面板上没有条件行。
    // 注意: 一个 boss 点可能有多个 BOSS 敌人，装甲类型可能不止一种。
    // S 点就是两个（轻巡=轻甲、战巡=中甲），所以这里用 bosses 数组而不是单个 armor。
    O: {
      label: "O", type: "boss", icon: "skull", x: 1357, y: 641, lv: 65,
      bosses: [ { type: "战列", count: 1, armor: "重甲" } ],
      token: "活动代币（掉落列表第0槽 / 首通卡）",
      goldDrops: [ { name: "约克公爵", faction: "洛蒙瑞亚", shipType: "战列", shipClass: "英王乔治五世级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    },

    P: {
      label: "P", type: "battle", icon: "hex", x: 1452, y: 312, lv: 65,
      next: [ { to: "R", prob: "大", raw: "无条件", cond: [] } ]
    },

    Q: {
      label: "Q", type: "boss", icon: "skull", x: 1396, y: 850, lv: 65,
      bosses: [ { type: "战巡", count: 1, armor: "中甲" } ],
      token: "活动代币（掉落列表第0槽 / 首通卡）",
      goldDrops: [ { name: "沙恩霍斯特", faction: "奥鲁加", shipType: "战巡", shipClass: "沙恩霍斯特级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    },

    // 补给点: 返还"上一个战斗节点出战队伍"的一半油（面板原文"可取得50%燃料"）
    R: {
      label: "R", type: "supply", icon: "can", x: 1620, y: 405,
      effect: { kind: "fuel", percent: 50, basis: "上一战斗节点的出战队伍油耗" },
      next: [ { to: "S", prob: "大", raw: "无条件", cond: [] } ]
    },

    S: {
      label: "S", type: "boss", icon: "skull", x: 1534, y: 546, lv: 65,
      // 这个点有两个 BOSS：轻巡(轻甲) + 战巡(中甲)。装甲类型不止一种，组队时要都考虑。
      bosses: [ { type: "轻巡", count: 1, armor: "轻甲" }, { type: "战巡", count: 1, armor: "中甲" } ],
      token: "活动代币（掉落列表第0槽 / 首通卡）",
      goldDrops: [ { name: "格奈森瑙", faction: "奥鲁加", shipType: "战巡", shipClass: "沙恩霍斯特级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    }
  },

  /* 已知空缺 / 待确认:
   *  1. 掉落列表第0槽（活动代币）的具体数量只确认了 S 点是 180；O/Q 未逐个读，
   *     普通战斗点读到的是 80（A、D）。若需要精确值可再采一轮。
   *  2. 本图 3 个 boss 各只有 1 个金色掉落且都带 UP，故 polluted 全为 false。
   *     若某活动出现"两个金色掉落"，把非 UP 的放进 otherDropsGold 并把 polluted 置 true。
   */
});
