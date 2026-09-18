/* 图模型: 路线枚举 + 路线分析（战斗数、油点定位、条件链）
 *
 * 「路线」= 从起点到某个终点的节点序列。本图是无环的，但枚举仍带环检测，
 * 以便同一套代码用于可能出现环的活动地图（你说过曾经出现过绕一圈回来的图）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.FX = root.FX || {}; root.FX.graph = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BATTLE_TYPES = { battle: true, boss: true };
  var MAX_NODES = 40; // 防御性上限，避免异常数据把枚举撑爆

  function isBattle(node) { return !!BATTLE_TYPES[node && node.type]; }

  /** 取 a -> b 这条边（没有则 null） */
  function edgeBetween(map, a, b) {
    var outs = (map.nodes[a] && map.nodes[a].next) || [];
    for (var i = 0; i < outs.length; i++) if (outs[i].to === b) return outs[i];
    return null;
  }

  /** 枚举起点到所有终点的全部简单路径 */
  function enumerateRoutes(map) {
    var routes = [];
    var start = map.start;
    if (!map.nodes[start]) return routes;
    (function dfs(cur, acc, seen) {
      if (acc.length > MAX_NODES) return;
      var outs = (map.nodes[cur].next || []);
      if (outs.length === 0) { routes.push(acc.slice()); return; }
      for (var i = 0; i < outs.length; i++) {
        var to = outs[i].to;
        if (!map.nodes[to]) continue;
        if (seen[to]) continue;            // 环保护
        seen[to] = true; acc.push(to);
        dfs(to, acc, seen);
        acc.pop(); seen[to] = false;
      }
    })(start, [start], (function () { var s = {}; s[start] = true; return s; })());
    return routes;
  }

  /**
   * 分析一条路线。返回:
   *   nodes       节点序列
   *   terminal    终点节点 id
   *   battles     战斗节点 id 列表（按顺序）
   *   battleIndex {节点id: 第几战(从1开始)}
   *   oilPoints   [{ node, afterBattle, basisNode, ordinal }]
   *                afterBattle = 该油点是第几战之后; basisNode = 返油基数取哪一战的出战队伍
   *   conditions  [{ from, to, edge }] 路线上每条边的条件
   */
  function analyzeRoute(map, nodes) {
    var battles = [], battleIndex = {}, bossSet = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = map.nodes[nodes[i]];
      if (!n) continue;
      if (isBattle(n)) { battles.push(nodes[i]); battleIndex[nodes[i]] = battles.length; }
      if (n.type === 'boss') bossSet[nodes[i]] = true;
    }

    var oilPoints = [];
    for (var j = 0; j < nodes.length; j++) {
      if (map.nodes[nodes[j]].type !== 'supply') continue;
      var ord = 0, basis = null;
      for (var k = 0; k < j; k++) {
        if (isBattle(map.nodes[nodes[k]])) { ord++; basis = nodes[k]; }
      }
      oilPoints.push({ node: nodes[j], afterBattle: ord, basisNode: basis, ordinal: ord });
    }

    var conditions = [];
    for (var m = 0; m + 1 < nodes.length; m++) {
      var e = edgeBetween(map, nodes[m], nodes[m + 1]);
      if (e) conditions.push({ from: nodes[m], to: nodes[m + 1], edge: e });
    }

    return {
      nodes: nodes,
      terminal: nodes[nodes.length - 1],
      battles: battles,
      battleIndex: battleIndex,
      bossSet: bossSet,
      oilPoints: oilPoints,
      conditions: conditions
    };
  }

  /** 路线上所有条件谓词（扁平） */
  function routeConds(analysis) {
    var out = [];
    analysis.conditions.forEach(function (c) {
      (c.edge.cond || []).forEach(function (p) { out.push(p); });
    });
    return out;
  }

  /** 路线标识，用于在界面上记住选中的路线 */
  function routeKey(nodes) { return nodes.join('>'); }

  /** 节点上所有 BOSS 的装甲类型（去重）。一个 boss 点可能有多个 BOSS 敌人，
   *  装甲类型也可能不止一种 —— 例如 S 点是 轻巡(轻甲) + 战巡(中甲)。 */
  function armorList(node) {
    var out = [];
    ((node && node.bosses) || []).forEach(function (b) {
      if (b && b.armor && out.indexOf(b.armor) < 0) out.push(b.armor);
    });
    if (!out.length && node && node.armor) out.push(node.armor);   // 兼容只写单个 armor 的旧数据
    return out;
  }

  /** 该点的 BOSS 敌人总数 */
  function bossTotal(node) {
    return ((node && node.bosses) || []).reduce(function (s, b) { return s + (b.count || 1); }, 0);
  }

  /** 「轻甲+中甲」这样的一行描述 */
  function armorText(node) {
    var a = armorList(node);
    return a.length ? a.join('+') : '?';
  }

  return {
    BATTLE_TYPES: BATTLE_TYPES, MAX_NODES: MAX_NODES,
    isBattle: isBattle, edgeBetween: edgeBetween,
    enumerateRoutes: enumerateRoutes, analyzeRoute: analyzeRoute,
    routeConds: routeConds, routeKey: routeKey,
    armorList: armorList, bossTotal: bossTotal, armorText: armorText
  };
});
