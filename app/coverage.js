/* 覆盖规划：用最少总战数把所有「还没通过的目标节点」走一遍
 *
 * 背景: 地图上全部节点都走过一遍（非灰）才解锁自动作战（委托）。其中既有战斗节点，
 * 也有补给点这类**非战斗节点** —— 所以覆盖目标不能只按战斗点算（见 app/main.js 的
 * 「包括非战斗节点」开关，默认开着）。
 * 一次出击只能走一条从起点出发的路线，而图有分支，且像 O(驱逐≥4) 与 Q(驱逐<4)
 * 这种互斥分支一趟里不可能同时走到 —— 所以这是"多趟的集合覆盖"问题。
 *
 * 候选路线:
 *   默认只取「起点 -> 终点」的完整路线（任何前缀的节点集都是某条完整路线的子集）。
 *   允许撤退时（游戏里可以在任意节点返航），把每条路线的所有前缀也算进候选 ——
 *   实测本图最优解会从 28 战降到 25 战，所以这个开关很关键。
 *
 * 求解: 位掩码 DP（节点数 ≤ 20，状态数 ≤ 2^20），可给两种目标函数：
 *   'battles' 最少总战数；'runs' 最少趟数（同趟数下再比战数）。
 *   注意「覆盖了哪些目标」是按路线经过的**全部节点**算的，不是只算战斗点 ——
 *   否则非战斗节点永远标记不上，包含它们的规划会误判无解。
 *
 * 依赖 graph 模块，但通过参数注入，便于在 Node 里单测。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.FX = root.FX || {}; root.FX.coverage = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function countBits(x) { var n = 0; while (x) { x &= x - 1; n++; } return n; }

  /** 地图上「可以标记已通过 / 未通过」的节点: 除起点外的全部节点。
   *  起点每次出击必然经过，标记它没有意义。 */
  function nodeIds(map) {
    return Object.keys(map.nodes).filter(function (id) { return map.nodes[id].type !== 'start'; });
  }

  /**
   * 需要覆盖的目标节点: 从 nodeIds 里按选项挑，再去掉已经通过（非灰）的。
   * @param map     地图数据
   * @param graph   FX.graph 模块
   * @param visited { 节点id: true } 已通过的节点
   * @param opts    { includeNonBattle=true, includeBoss=true }
   *                includeNonBattle: 委托解锁要求走遍所有节点，默认含补给点等非战斗节点；
   *                显式传 false 才退回「只要求战斗节点」的老口径。
   *                起点永远不算目标（任何出击都经过它，算进去只会虚增目标数）。
   */
  function targets(map, graph, visited, opts) {
    opts = opts || {};
    visited = visited || {};
    var out = [];
    nodeIds(map).forEach(function (id) {
      var n = map.nodes[id];
      if (graph.isBattle(n)) {
        if (n.type === 'boss' && opts.includeBoss === false) return;
      } else if (opts.includeNonBattle === false) {
        return;
      }
      if (visited[id]) return;
      out.push(id);
    });
    return out;
  }

  /** 候选路线枚举。opts: { allowRetreat, filter(nodes)->bool } */
  function candidates(map, graph, opts) {
    opts = opts || {};
    var routes = graph.enumerateRoutes(map);
    var out = [], seen = {};
    function add(nodes) {
      var key = nodes.join('>');
      if (seen[key]) return;
      seen[key] = true;
      var an = graph.analyzeRoute(map, nodes);
      if (!an.battles.length) return;                 // 至少得打一场
      if (opts.filter && !opts.filter(nodes)) return; // 被编队条件过滤掉
      out.push({
        nodes: nodes, battles: an.battles.length,
        battleSet: an.battles, oilPoints: an.oilPoints
      });
    }
    routes.forEach(function (r) {
      if (opts.allowRetreat) {
        for (var e = 2; e <= r.length; e++) add(r.slice(0, e));
      } else {
        add(r);
      }
    });
    return out;
  }

  /**
   * 求解。
   * @param map      地图数据
   * @param graph    FX.graph 模块
   * @param targets  需要覆盖的节点 id 数组（可以含补给点等非战斗节点）
   * @param opts     { allowRetreat, objective:'battles'|'runs', filter }
   * @returns { ok, runs:[{nodes,battles,battleSet,newCovered}], totalBattles, runCount, totalOilPoints }
   *          或 { ok:false, reason, uncovered:[...] }
   *          newCovered 是本趟新覆盖的目标节点（按路线顺序，可能是非战斗节点）
   */
  function solve(map, graph, targets, opts) {
    opts = opts || {};
    if (!targets || !targets.length) {
      return { ok: true, runs: [], totalBattles: 0, runCount: 0, totalOilPoints: 0, empty: true };
    }
    var idx = {};
    targets.forEach(function (id, i) { idx[id] = i; });
    var N = targets.length;
    var FULL = (1 << N) - 1;

    var cands = candidates(map, graph, opts);
    cands.forEach(function (c) {
      /* 覆盖判定看「路线经过的全部节点」——目标可能是补给点这类非战斗节点，
       * 只按 battleSet 算的话这些目标永远覆盖不到，规划会误报无解。 */
      var mask = 0;
      c.nodes.forEach(function (id) { if (idx[id] !== undefined) mask |= (1 << idx[id]); });
      c.mask = mask;
      c.newNodes = countBits(mask);
    });

    // 诊断: 哪些目标节点任何候选路线都覆盖不到
    var coverable = {};
    cands.forEach(function (c) {
      c.nodes.forEach(function (id) { if (idx[id] !== undefined) coverable[id] = true; });
    });
    var uncovered = targets.filter(function (id) { return !coverable[id]; });
    if (uncovered.length) {
      return {
        ok: false, uncovered: uncovered,
        reason: '这些节点没有任何可走的路线能经过：' + uncovered.join('、') +
                (opts.filter ? '（可能是被当前编队的带路条件卡住了）' : '')
      };
    }

    // 位掩码 DP。掩码只会变大，所以按掩码升序推进就是合法的 DAG 最短路。
    var size = 1 << N;
    var dp = new Float64Array(size).fill(Infinity);
    var prevMask = new Int32Array(size).fill(-1);
    var prevRoute = new Int32Array(size).fill(-1);
    var cost = cands.map(function (c) {
      return opts.objective === 'runs' ? (1000 + c.battles) : c.battles;
    });

    dp[0] = 0;
    for (var m = 0; m < size; m++) {
      if (dp[m] === Infinity) continue;
      for (var i = 0; i < cands.length; i++) {
        var nm = m | cands[i].mask;
        if (nm === m) continue;
        var w = dp[m] + cost[i];
        if (w < dp[nm]) { dp[nm] = w; prevMask[nm] = m; prevRoute[nm] = i; }
      }
    }
    if (dp[FULL] === Infinity) {
      return { ok: false, uncovered: targets, reason: '没有任何路线组合能覆盖全部目标节点' };
    }

    var picked = [], cur = FULL;
    while (cur !== 0) {
      var pi = prevRoute[cur];
      if (pi < 0) return { ok: false, uncovered: targets, reason: '内部错误：回溯失败' };
      picked.push(cands[pi]);
      cur = prevMask[cur];
    }
    picked.reverse();

    // 标注每趟"新增覆盖"了哪些节点（按路线经过顺序，含非战斗节点）
    var got = {};
    picked.forEach(function (c) {
      c.newCovered = c.nodes.filter(function (id) {
        if (idx[id] === undefined || got[id]) return false;
        got[id] = true; return true;
      });
    });

    return {
      ok: true,
      runs: picked,
      runCount: picked.length,
      totalBattles: picked.reduce(function (s, c) { return s + c.battles; }, 0),
      totalOilPoints: picked.reduce(function (s, c) { return s + c.oilPoints.length; }, 0)
    };
  }

  /** 从一组采样像素判断节点是"已通过"还是"未通过"。
   *  已通过的图标配色: 战斗点=青蓝, BOSS=红, 补给点=亮绿; 未通过一律灰白。
   *  三类补给点（油点/弹药点/回血点）数据里都是 type='supply'，这里统一按
   *  「亮绿=已通过、灰白=未通过」判（颜色分类器只认图标配色，不负责区分补给效果）。
   *  弹药点已通过时是金色，不在配色表里 → 返回 null（保持原样，手动标记）。
   *  返回 'visited' | 'unvisited' | null */
  function classifyNodePixels(node, pixels) {
    var vis = 0, unvis = 0;
    pixels.forEach(function (p) {
      var r = p.r, g = p.g, b = p.b;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (node.type === 'boss') {
        if (r >= 165 && (r - g) >= 55 && (r - b) >= 45) { vis++; return; }
      } else if (node.type === 'supply') {
        if (g >= 165 && (g - r) >= 35 && (g - b) >= 35) { vis++; return; }
      } else {
        if (b >= 195 && g >= 175 && (b - r) >= 40) { vis++; return; }
      }
      if ((mx - mn) <= 28 && mn >= 135 && mx <= 250) { unvis++; }
    });
    if (vis >= 3 && vis > unvis) return 'visited';
    if (unvis >= 3 && unvis > vis) return 'unvisited';
    if (vis > 0 && unvis === 0) return 'visited';
    if (unvis > 0 && vis === 0) return 'unvisited';
    return null;
  }

  /**
   * 按地图里记录的节点坐标采集每个可判定节点图标环上的像素。
   * 采集范围是「能靠颜色判定已通过/未通过」的节点: 战斗点 / BOSS / 补给点。
   * 起点每次出击必然经过、颜色也固定，未知类型的配色还没校准过 —— 这两类跳过。
   * getPixel(x, y) 返回 {r,g,b}；W/H 是图片真实尺寸，内部按地图数据里的
   * map.screen（游戏内截图坐标系，缺省 1920x1080）缩放。
   * 返回 { 节点id: [{r,g,b}, ...] } —— 原始样本，便于单独测试分类逻辑。
   */
  function samplePixels(map, graph, W, H, getPixel) {
    var SW = (map.screen && map.screen.w) || 1920, SH = (map.screen && map.screen.h) || 1080;
    var sx = W / SW, sy = H / SH;
    var out = {};
    Object.keys(map.nodes).forEach(function (id) {
      var n = map.nodes[id];
      if (!graph.isBattle(n) && n.type !== 'supply') return;
      var px = [];
      for (var a = 0; a < 24; a++) {
        var ang = Math.PI * 2 * a / 24;
        for (var rr = 17; rr <= 27; rr += 5) {
          var x = Math.round((n.x + rr * Math.cos(ang)) * sx);
          var y = Math.round((n.y + rr * Math.sin(ang)) * sy);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          px.push(getPixel(x, y));
        }
      }
      out[id] = px;
    });
    return out;
  }

  /** 采样 + 判定一步到位。返回 { 节点id: 'visited' | 'unvisited' | null } */
  function sampleVisited(map, graph, W, H, getPixel) {
    var raw = samplePixels(map, graph, W, H, getPixel);
    var out = {};
    Object.keys(raw).forEach(function (id) {
      out[id] = classifyNodePixels(map.nodes[id], raw[id]);
    });
    return out;
  }

  return {
    countBits: countBits,
    nodeIds: nodeIds,
    targets: targets,
    candidates: candidates,
    solve: solve,
    classifyNodePixels: classifyNodePixels,
    samplePixels: samplePixels,
    sampleVisited: sampleVisited
  };
});
