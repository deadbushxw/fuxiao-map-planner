/* 油耗 / 弹药 计算 + 出战队伍自动分配
 *
 * 规则（游戏内实测确认）:
 *   1. 每个战斗节点从两队里任选一队出战
 *   2. 每队每轮最多打 5 战，即"出战一次消耗 1 弹药"，上限 5
 *   3. 三倍模式: 只放大油耗和掉落, 不改变战斗场次、也不改弹药消耗（仍 1/战）
 *   4. 油点返还"上一个战斗节点的出战队伍"的一半油, 且向下取整
 *
 * 油耗公式（F 为某一场出战队伍的全部舰灵油耗之和）:
 *   一倍: 单战消耗 F     油点返还 ⌊F/2⌋
 *   三倍: 单战消耗 3F    油点返还 ⌊3F/2⌋     <-- 先乘三再取整, 不是 ⌊F/2⌋×3
 *   例: F=55 -> 一倍返 27; 三倍耗 165 返 82 (而 27×3=81, 会少算 1)
 *
 * 自动分配: 穷举 2^(战斗数) 种分配（战斗数 ≤10，最多 1024 种），
 *           在满足"boss 点必须强队"和"每队 ≤5 战"的前提下取所选模式油耗最小。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.FX = root.FX || {}; root.FX.oil = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var AMMO_PER_BATTLE = 1;
  var AMMO_CAP = 5;   // 每队每轮最多 5 战

  function teamInfo(team, shipMap) {
    var ids = ((team && team.ships) || []);
    var oil = 0, missing = 0;
    ids.forEach(function (id) {
      var s = shipMap[id];
      if (!s) { missing++; return; }
      var v = Number(s.oil);
      if (isNaN(v)) { missing++; return; }
      oil += v;
    });
    return { oil: oil, count: ids.length, missing: missing };
  }

  /**
   * 给定分配方案计算油耗与弹药。
   * assign: 长度等于战斗数的数组，元素为 0|1（出战队伍索引）
   */
  function compute(analysis, formation, shipMap, assign, mode) {
    var teams = (formation && formation.teams) || [];
    var F = [teamInfo(teams[0], shipMap).oil, teamInfo(teams[1], shipMap).oil];
    var mult = (mode === 'x3') ? 3 : 1;

    var battles = analysis.battles;
    var ammo = [0, 0];
    var gross = 0;
    for (var i = 0; i < battles.length; i++) {
      var t = assign[i];
      ammo[t] += AMMO_PER_BATTLE;
      gross += F[t] * mult;
    }

    var refunds = [];
    var totalRefund = 0;
    analysis.oilPoints.forEach(function (op) {
      if (!op.basisNode) { refunds.push({ node: op.node, afterBattle: op.afterBattle, basisNode: null, refund: 0 }); return; }
      var bIdx = analysis.battleIndex[op.basisNode] - 1;   // 转 0 基
      if (bIdx < 0) { refunds.push({ node: op.node, afterBattle: op.afterBattle, basisNode: op.basisNode, refund: 0 }); return; }
      var t = assign[bIdx];
      var basisOil = F[t] * mult;
      var refund = Math.floor(basisOil / 2);
      totalRefund += refund;
      refunds.push({
        node: op.node, afterBattle: op.afterBattle, basisNode: op.basisNode,
        team: t, basisOil: basisOil, refund: refund
      });
    });

    return {
      mode: mode || 'x1', mult: mult,
      teamOil: F, assign: assign.slice(), ammo: ammo,
      gross: gross, refund: totalRefund, net: gross - totalRefund, refunds: refunds
    };
  }

  /** 检查一个分配方案是否合法 */
  function checkAssignment(analysis, formation, assign) {
    var strong = (formation && formation.strongTeam) || 0;
    var ammo = [0, 0];
    for (var i = 0; i < analysis.battles.length; i++) {
      var nodeId = analysis.battles[i];
      if (analysis.bossSet[nodeId] && assign[i] !== strong) return 'boss 点必须由强队出战';
      ammo[assign[i]]++;
    }
    if (ammo[0] > AMMO_CAP) return '1队出战 ' + ammo[0] + ' 次，超过每队上限 ' + AMMO_CAP;
    if (ammo[1] > AMMO_CAP) return '2队出战 ' + ammo[1] + ' 次，超过每队上限 ' + AMMO_CAP;
    return null;
  }

  /**
   * 自动分配。analysis 需带上 bossSet（哪些战斗节点是 boss）。
   * returns { ok, assign, result, reason, tried }
   */
  function autoAssign(analysis, formation, shipMap, mode) {
    var n = analysis.battles.length;
    if (n > AMMO_CAP * 2) {
      return { ok: false, reason: '本路线 ' + n + ' 场战斗，两队弹药上限合计只有 ' + (AMMO_CAP * 2) + ' 场，无法走通' };
    }
    var bossCount = analysis.battles.filter(function (id) { return analysis.bossSet[id]; }).length;
    if (bossCount > AMMO_CAP) {
      return { ok: false, reason: '本路线有 ' + bossCount + ' 个 boss 点，强队弹药上限 ' + AMMO_CAP + ' 场，无法全部由强队打' };
    }

    var strong = (formation && formation.strongTeam) || 0;
    var best = null, tried = 0;
    var total = Math.pow(2, n);
    for (var mask = 0; mask < total; mask++) {
      var assign = [];
      for (var i = 0; i < n; i++) assign.push((mask >> i) & 1);
      // 先快速检查约束
      var ammo = [0, 0], bad = false;
      for (var j = 0; j < n; j++) {
        if (analysis.bossSet[analysis.battles[j]] && assign[j] !== strong) { bad = true; break; }
        ammo[assign[j]]++;
        if (ammo[assign[j]] > AMMO_CAP) { bad = true; break; }
      }
      if (bad) continue;
      tried++;
      var r = compute(analysis, formation, shipMap, assign, mode);
      if (!best || r.net < best.result.net) best = { assign: assign, result: r };
    }

    if (!best) {
      return { ok: false, reason: '没有任何合法分配（每队上限 ' + AMMO_CAP + ' 战 + boss 必须强队），这条路走不通' };
    }
    best.ok = true;
    best.tried = tried;
    return best;
  }

  /** 按强队优先 / 交替的朴素默认分配（给手动模式一个初始值） */
  function defaultAssign(analysis, formation) {
    var strong = (formation && formation.strongTeam) || 0;
    var n = analysis.battles.length;
    var assign = [], ammo = [0, 0];
    for (var i = 0; i < n; i++) {
      var needStrong = analysis.bossSet[analysis.battles[i]];
      var t;
      if (needStrong) t = strong;
      else if (ammo[strong] < AMMO_CAP) t = strong;
      else t = 1 - strong;
      if (ammo[t] >= AMMO_CAP) t = 1 - t;
      assign.push(t); ammo[t]++;
    }
    return assign;
  }

  return {
    AMMO_PER_BATTLE: AMMO_PER_BATTLE, AMMO_CAP: AMMO_CAP,
    teamInfo: teamInfo, compute: compute,
    checkAssignment: checkAssignment, autoAssign: autoAssign, defaultAssign: defaultAssign
  };
});
