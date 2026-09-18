/* 覆盖规划：用最少总战数把所有「还没通过的战斗节点」走一遍
 *
 * 背景: 地图上全部战斗节点都走过一遍（非灰）才解锁自动作战。
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
   * @param targets  需要覆盖的节点 id 数组
   * @param opts     { allowRetreat, objective:'battles'|'runs', filter }
   * @returns { ok, runs:[{nodes,battles,battleSet,newCovered}], totalBattles, runCount, totalOilPoints }
   *          或 { ok:false, reason, uncovered:[...] }
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
      var mask = 0;
      c.battleSet.forEach(function (id) { if (idx[id] !== undefined) mask |= (1 << idx[id]); });
      c.mask = mask;
      c.newNodes = countBits(mask);
    });

    // 诊断: 哪些目标节点任何候选路线都覆盖不到
    var coverable = {};
    cands.forEach(function (c) {
      c.battleSet.forEach(function (id) { if (idx[id] !== undefined) coverable[id] = true; });
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

    // 标注每趟"新增覆盖"了哪些节点
    var got = {};
    picked.forEach(function (c) {
      c.newCovered = c.battleSet.filter(function (id) {
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
   * 按地图里记录的节点坐标采集每个战斗节点图标环上的像素。
   * getPixel(x, y) 返回 {r,g,b}；W/H 是图片真实尺寸，内部按 1920x1080 的地图坐标系缩放。
   * 返回 { 节点id: [{r,g,b}, ...] } —— 原始样本，便于单独测试分类逻辑。
   */
  function samplePixels(map, graph, W, H, getPixel) {
    var sx = W / 1920, sy = H / 1080;
    var out = {};
    Object.keys(map.nodes).forEach(function (id) {
      var n = map.nodes[id];
      if (!graph.isBattle(n)) return;
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
    candidates: candidates,
    solve: solve,
    classifyNodePixels: classifyNodePixels,
    samplePixels: samplePixels,
    sampleVisited: sampleVisited
  };
});
