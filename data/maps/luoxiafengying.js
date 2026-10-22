/* 拂晓：胜利之刻 —— 活动地图数据
 * 地图: 落霞枫影 / 地狱EX
 * 版本形态: 限时活动 —— 有活动代币（第0槽是首通卡、只发一次；可重复获得的那张在掉落列表靠后位置）和金船掉落UP。
 *          地图数据一律按限时活动版本记录（页面上的「限时活动 / 档案」开关负责切换）。
 * 数据来源: 游戏内逐节点点击读取（点节点 -> 「起始点 / 战斗点 / 战斗点(BOSS) / 补给点」面板）
 *          采集流程与复查方法见 tools/README.md
 *
 * 图结构性质（已校验）:
 *   - 有向图，无双向边（不存在 A->B 同时 B->A）
 *   - 本图无环：每条边都严格向终点一侧推进
 *   - 起点 START 只有 2 条出边（A/B，按舰队里 航母 数量分流）
 *   - 终点共 3 个：H（补给点，面板只有"可取得50%燃料"一行，没有后续节点行）、
 *     L / M（BOSS，面板上没有出边行）
 *   - D 是「有出边的补给点」（D -> E），和 H 这种纯终点补给点不同
 *
 * 条件语义（next[].cond 为谓词数组）:
 *   scope: "旗舰" | "舰队"
 *     - "旗舰": 对两队的旗舰计数。如 {scope:"旗舰",kind:"舰种",key:"驱逐",op:"=",n:1}
 *               = 两个旗舰中舰种为驱逐的数量 = 1
 *     - "舰队": 对两队合并计数（舰灵数/均速/索敌也是两队合并值）
 *   kind:  "舰种" | "阵营" | "舰灵数" | "均速" | "索敌"
 *   key:   舰种(驱逐/轻巡/重巡/战列/战巡/航母/轻母/…)、阵营(八咫/…)，或 null
 *
 *   ★ G -> I 是**两个谓词同时成立**（游戏面板上分两行显示，语义为"且"）：
 *       舰队中 驱逐 数量≥3  且  舰队中<八咫>数量≥4
 *     这两条放进同一个 cond 数组；app/main.js 逐条求值后按"任一 fail 即不满足"处理，
 *     所以双谓词不需要改求值逻辑。本图是仓库里第一张带双谓词的图。
 *
 * 掉落稀有度横条颜色: 金 > 紫 > 蓝 > 绿（头像顶端横条），右上角绿色斜标 = 掉落UP。
 *   本图两个 boss 各自只有 1 个金色掉落，且都带 UP（已采样确认：UP 徽标处绿色像素
 *   L=39 / M=31，作为对照的普通战斗点 F=0）。
 */

window.FX_MAPS = window.FX_MAPS || [];
window.FX_MAPS.push({
  id: "luoxiafengying-dex",
  event: "落霞枫影",
  difficulty: "地狱EX",
  levelRequirement: 35,
  screen: { w: 1920, h: 1080 },
  start: "START",

  nodes: {
    // 起始点。面板原文: 可是这儿什么都没有～ (ノ>ω<)ノ
    // 图标是地图右上角的蓝色 pin（上方叠着「▶ STORY」剧情标记，那是剧情标记不是节点本身）
    START: {
      label: "起点", type: "start", icon: "pin", x: 1568, y: 208,
      next: [
        { to: "A", prob: "中", raw: "舰队中 航母 数量<2", cond: [ { scope: "舰队", kind: "舰种", key: "航母", op: "<", n: 2 } ] },
        { to: "B", prob: "中", raw: "舰队中 航母 数量=2", cond: [ { scope: "舰队", kind: "舰种", key: "航母", op: "=", n: 2 } ] }
      ]
    },

    A: {
      label: "A", type: "battle", icon: "hex", x: 1694, y: 350, lv: 65,
      next: [ { to: "C", prob: "大", raw: "无条件", cond: [] } ]
    },

    B: {
      label: "B", type: "battle", icon: "hex", x: 1456, y: 350, lv: 65,
      next: [ { to: "E", prob: "大", raw: "无条件", cond: [] } ]
    },

    C: {
      label: "C", type: "battle", icon: "hex", x: 1642, y: 510, lv: 65,
      next: [ { to: "D", prob: "大", raw: "无条件", cond: [] } ]
    },

    // 补给点，但效果不是返油：面板原文只有一行红字「弹药-1」，地图图标是**金色子弹**
    // （油点是绿色油罐，回血点是绿色爱心，三类在游戏里都叫「补给点」）。
    // effect.kind='ammo' ⇒ graph.supplyKind() 返回 'ammo'，于是：
    //   - 不进 oilPoints，不参与"返上一战油耗的一半"；
    //   - 进 ammoPoints，oil.js 的弹药台账**扣**"该点前一个战斗节点（=C）的出战队伍"1 发，
    //     也就是那一队少一次作战次数：过完 D 之后它最多只能再打 4 战（若此前没打过）。
    // 谁挨这一发由 oil.js 的穷举按"净油耗最小"自己定，不写死规则。
    D: {
      label: "D", type: "supply", icon: "can", x: 1587, y: 645,
      effect: { kind: "ammo", delta: -1, raw: "弹药-1" },
      next: [ { to: "E", prob: "大", raw: "无条件", cond: [] } ]
    },

    E: {
      label: "E", type: "battle", icon: "hex", x: 1384, y: 510, lv: 65,
      next: [ { to: "F", prob: "大", raw: "无条件", cond: [] } ]
    },

    F: {
      label: "F", type: "battle", icon: "hex", x: 1097, y: 410, lv: 65,
      next: [ { to: "G", prob: "大", raw: "无条件", cond: [] } ]
    },

    G: {
      label: "G", type: "battle", icon: "hex", x: 811, y: 495, lv: 65,
      next: [
        { to: "H", prob: "中", raw: "舰队中 轻母 数量<1", cond: [ { scope: "舰队", kind: "舰种", key: "轻母", op: "<", n: 1 } ] },
        // ★ 双谓词（面板两行，且）：舰队中 驱逐 数量≥3  且  舰队中<八咫>数量≥4
        { to: "I", prob: "中", raw: "舰队中 驱逐 数量≥3 且 舰队中<八咫>数量≥4", cond: [
          { scope: "舰队", kind: "舰种", key: "驱逐", op: "≥", n: 3 },
          { scope: "舰队", kind: "阵营", key: "八咫", op: "≥", n: 4 }
        ] }
      ]
    },

    // 终点（补给点）。面板上只有「可取得50%燃料」一行，没有后续节点行。
    H: {
      label: "H", type: "supply", icon: "can", x: 402, y: 355,
      effect: { kind: "fuel", percent: 50, basis: "上一战斗节点的出战队伍油耗" },
      terminal: true,
      next: []
    },

    I: {
      label: "I", type: "battle", icon: "hex", x: 480, y: 705, lv: 65,
      next: [
        { to: "J", prob: "中", raw: "旗舰为 驱逐=1", cond: [ { scope: "旗舰", kind: "舰种", key: "驱逐", op: "=", n: 1 } ] },
        { to: "K", prob: "中", raw: "旗舰为 战列=1", cond: [ { scope: "旗舰", kind: "舰种", key: "战列", op: "=", n: 1 } ] }
      ]
    },

    J: {
      label: "J", type: "battle", icon: "hex", x: 636, y: 835, lv: 65,
      // 阈值是半整数 35.5（游戏原文如此）。均速是实数，conditions.rangeOf 已按实数维度
      // 取开边界（<35.5 → 上限 35.49，>35.5 → 下限 35.51），与 evaluate 判定一致。
      next: [
        { to: "L", prob: "中", raw: "舰队均速值<35.5", cond: [ { scope: "舰队", kind: "均速", key: null, op: "<", n: 35.5 } ] },
        { to: "M", prob: "中", raw: "舰队均速值≥35.5", cond: [ { scope: "舰队", kind: "均速", key: null, op: "≥", n: 35.5 } ] }
      ]
    },

    // 补给点（有出边）。面板原文「可取得50%燃料」，另有 K -> M 一行。
    K: {
      label: "K", type: "supply", icon: "can", x: 982, y: 608,
      effect: { kind: "fuel", percent: 50, basis: "上一战斗节点的出战队伍油耗" },
      next: [ { to: "M", prob: "大", raw: "无条件", cond: [] } ]
    },

    // 终点 BOSS。敌人列表里只有 1 个带红色 BOSS 横幅的敌人：装母×1（盾牌红 = 重甲）。
    L: {
      label: "L", type: "boss", icon: "skull", x: 783, y: 1015, lv: 65,
      bosses: [ { type: "装母", count: 1, armor: "重甲" } ],
      token: "活动代币：第0槽是首通卡（只发一次，逐点不同）；可重复获得的那张在掉落列表靠后位置（滑到不能再滑一般能看到）",
      goldDrops: [ { name: "苍龙", faction: "八咫", shipType: "航母", shipClass: "苍龙级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    },

    // 终点 BOSS。卡片与盾牌都是中甲；敌人列表: 航母×1（BOSS）驱逐×18 轻母×6，敌人等级 LV.65。
    // 图标上叠着「▶ STORY」横幅（剧情标记）。
    M: {
      label: "M", type: "boss", icon: "skull", x: 1190, y: 862, lv: 65,
      bosses: [ { type: "航母", count: 1, armor: "中甲" } ],
      token: "活动代币：第0槽是首通卡（只发一次，逐点不同）；可重复获得的那张在掉落列表靠后位置（滑到不能再滑一般能看到）",
      goldDrops: [ { name: "飞龙", faction: "八咫", shipType: "航母", shipClass: "飞龙级", up: true } ],
      otherDropsGold: [], polluted: false,
      next: []
    }
  },

  /* 已知空缺 / 待确认:
   *  1. 本文件只录「地狱EX」。同一活动在游戏里还有「普通 / 困难 / 地狱」三档，
   *     它们的图结构**不一样**（普通档实测是 START->A->B->C->D->E 的 6 节点图，
   *     节点字母与位置都不同）。仓库既有的 bolanhui / pinganye 也只录地狱EX，故只录这一档。
   *  2. D 点效果「弹药-1」已接入 planning：oil.js 的沿途弹药台账在"该点前一个战斗节点"
   *     的出战队伍头上多扣 1 发（= 那一队少一次作战次数），界面「油耗与弹药」会列出扣弹明细。
   *     口径: 同一场战斗后面若跟了多个弹药点就各扣 1（本图只有一个弹药点，未实测）。
   *  3. 地图上的金色「S」气泡与白色气泡是右下角「离线委托」的路线标志（已确认），
   *     属于 HUD 覆盖层而不是地图节点：实测点它们没有任何反应（点击前后截图同为
   *     地图态 2.04MB，无面板弹出），故一律不入数据，采集时也不要当成掉落/补给标记。
   *  4. 代币有两个不同的数，别混：
   *     - 掉落列表**第 0 槽是「首通」卡**（标着「已领取」），逐点不同：普通战斗点 80（F）、
   *       BOSS 160（L）/ 180（M）。那是**首通奖励**，只发一次，不是一轮收益。
   *     - **可重复获得**的代币卡在掉落列表**靠后**的位置：把列表滑到不能再滑，一般就在最靠后
   *       那几格里（**不一定是最末尾那一格** —— 本图 J 点后面还跟着 3 个材料箱）。
   *       普通战斗点读到 40、BOSS 读到 90，与 app/oil.js 的 TOKEN_REWARD 一致
   *       （已在游戏内实测确认，与上一次活动观察相同）。
   *  5. 普通战斗点只记了 敌人等级 LV.65 / 建议索敌 189 / 建议制空 0~86，
   *     编成没有逐个录入（与 bolanhui 一致，只有 boss 记 bosses[]）。
   *  6. 活动时间：活动主界面读到 10/15 ~ 10/22（地图界面显示"剩余时间 6天"）。
   *  7. H 是补给点做终点（面板上没有后续节点行），数据里写了 terminal: true 明确标记，
   *     所以 validate_map 不再对它报"没有出边但不是 boss"的确认警告。
   */
});
