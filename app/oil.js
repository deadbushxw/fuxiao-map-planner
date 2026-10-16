/* 油耗 / 弹药 / 一轮代币收益 计算 + 出战队伍自动分配
 *
 * 规则（游戏内实测确认）:
 *   1. 每个战斗节点从两队里任选一队出战
 *   2. 每队每轮最多打 5 战，即"出战一次消耗 1 弹药"，上限 5
 *   3. 三倍模式: 只放大油耗和掉落, 不改变战斗场次、也不改弹药消耗（仍 1/战）
 *   4. 油点返还"上一个战斗节点的出战队伍"的一半油, 且向下取整
 *   5. 弹药点**扣**"该点前一个战斗节点的出战队伍"1 发弹药（游戏面板原文是红字「弹药-1」）:
 *      扣掉的就是上面第 2 条里的作战次数 —— 那一队少打一次。于是过完弹药点之后，
 *      该队的剩余次数 = 5 − 已打 − 1；同一场战斗后面跟了多个弹药点就各扣 1。
 *      它不改变油耗公式、也不影响返油。上限判定只发生在"要打这一场"的时候，
 *      所以路线末尾紧跟的弹药点不会把已经合法的路线误报成超限。
 *
 * 油耗公式（F 为某一场出战队伍的全部舰灵油耗之和）:
 *   一倍: 单战消耗 F     油点返还 ⌊F/2⌋
 *   三倍: 单战消耗 3F    油点返还 ⌊3F/2⌋     <-- 先乘三再取整, 不是 ⌊F/2⌋×3
 *   例: F=55 -> 一倍返 27; 三倍耗 165 返 82 (而 27×3=81, 会少算 1)
 *
 * 代币收益（只有「限时活动」版本才有，见 README「限时活动与档案」）:
 *   数值是当前认为值，可能随后修正 —— 要改只改 TOKEN_REWARD 这一处。
 *   档案（常驻）版本游戏里没有代币商店，所以档案模式下这个值不该被展示。
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
   * 沿路线顺序核对两队弹药（弹药台账）。
   * 每场战斗消耗 1 发；每经过一个弹药点再扣 1 发，扣在"该点前面那个战斗节点的出战队伍"
   * 头上（= 那一队少一次作战次数）。上限判定只在"要打这一场"时做：
   * 该队已用满 5 发还想再打，就是违规；这样路线末尾紧跟的弹药点不会误报。
   * ammoAfter[i] 由 app/graph.js analyzeRoute() 给出，= 第 i 场战斗后面跟的弹药点个数。
   * 计数封顶在 AMMO_CAP：弹药只有 5 发，扣到 5 之后这一发无处可扣（照样记进 tolls）。
   * 返回 { ok, reason, ammo, tolls }；不合法时 ammo 仍是走完全程的计数，便于界面照常显示。
   */
  function ammoLedger(analysis, assign) {
    var used = [0, 0], tolls = [], violation = null;
    var after = analysis.ammoAfter || [];
    var battles = analysis.battles || [];
    for (var i = 0; i < battles.length; i++) {
      var t = assign[i];
      if (used[t] >= AMMO_CAP && !violation) {
        violation = (t + 1) + '队要打第 ' + (i + 1) + ' 战（' + battles[i] + '）时弹药已用满 ' +
          used[t] + ' 发（每队每轮上限 ' + AMMO_CAP + ' 发），这一战接不上';
      }
      if (used[t] < AMMO_CAP) used[t] += AMMO_PER_BATTLE;
      for (var r = 0; r < (after[i] || 0); r++) {
        var room = used[t] < AMMO_CAP;
        if (room) used[t] += AMMO_PER_BATTLE;
        tolls.push({
          afterBattle: i + 1, battle: battles[i], team: t,
          applied: room, ammoAfter: used[t]
        });
      }
    }
    return { ok: !violation, reason: violation, ammo: used, tolls: tolls };
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
    var gross = 0;
    for (var i = 0; i < battles.length; i++) gross += F[assign[i]] * mult;
    var led = ammoLedger(analysis, assign);
    var ammo = led.ammo;

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
      teamOil: F, assign: assign.slice(), ammo: ammo, tolls: led.tolls,
      gross: gross, refund: totalRefund, net: gross - totalRefund, refunds: refunds
    };
  }

  /** 检查一个分配方案是否合法（弹药按沿途台账判，经过弹药点要扣一发） */
  function checkAssignment(analysis, formation, assign) {
    var strong = (formation && formation.strongTeam) || 0;
    for (var i = 0; i < analysis.battles.length; i++) {
      var nodeId = analysis.battles[i];
      if (analysis.bossSet[nodeId] && assign[i] !== strong) return 'boss 点必须由强队出战';
    }
    var led = ammoLedger(analysis, assign);
    return led.ok ? null : led.reason;
  }

  /**
   * 自动分配。analysis 需带上 bossSet（哪些战斗节点是 boss）。
   * returns { ok, assign, result, reason, tried }
   */
  function autoAssign(analysis, formation, shipMap, mode) {
    var n = analysis.battles.length;
    // 弹药点要扣一发，所以总消耗 = 战斗数 ＋ 弹药点数，两队合计只有 CAP*2 发。
    // 这两条只是必要条件（用来快速给出理由），真正的判定交给下面的穷举 + 台账。
    var after = analysis.ammoAfter || [];
    var tollTotal = after.reduce(function (s, v) { return s + (v || 0); }, 0);
    if (n + tollTotal > AMMO_CAP * 2) {
      return { ok: false, reason: '本路线 ' + n + ' 场战斗' +
        (tollTotal ? ' ＋ ' + tollTotal + ' 个弹药点扣弹' : '') + ' = ' + (n + tollTotal) +
        ' 发，超过两队弹药上限合计 ' + (AMMO_CAP * 2) + ' 发，无法走通' };
    }
    // 强队必须打满所有 boss；紧跟 boss 后面的弹药点也只能扣在强队头上
    var bossCount = analysis.battles.filter(function (id) { return analysis.bossSet[id]; }).length;
    var bossTolls = (analysis.ammoPoints || []).filter(function (ap) {
      return ap.basisNode && analysis.bossSet[ap.basisNode];
    }).length;
    if (bossCount + bossTolls > AMMO_CAP) {
      return { ok: false, reason: '本路线有 ' + bossCount + ' 个 boss 点' +
        (bossTolls ? ' ＋ ' + bossTolls + ' 个紧跟 boss 的弹药点' : '') + ' 共 ' + (bossCount + bossTolls) +
        ' 发，强队弹药上限只有 ' + AMMO_CAP + ' 发，无法全部由强队打' };
    }

    var strong = (formation && formation.strongTeam) || 0;
    var best = null, tried = 0;
    var total = Math.pow(2, n);
    for (var mask = 0; mask < total; mask++) {
      var assign = [];
      for (var i = 0; i < n; i++) assign.push((mask >> i) & 1);
      var bad = false;
      for (var j = 0; j < n; j++) {
        if (analysis.bossSet[analysis.battles[j]] && assign[j] !== strong) { bad = true; break; }
      }
      if (bad) continue;
      // 沿途台账判弹药上限（经过弹药点要扣它前面那一场的一发）
      if (!ammoLedger(analysis, assign).ok) continue;
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

  /* ---------- 一轮代币收益（只有「限时活动」版本有） ----------
   * boss 点 90 / 普通战斗点 40 / 非战斗点（起点、补给点）0。
   * 已用游戏内掉落列表**靠后**那张可重复获得的代币卡实测确认（把列表滑到不能再滑一般就能看到，
   * **不一定是最末尾一格**），与前一次活动观察一致；
   * 注意别和同列表**第 0 槽「首通」卡**（逐点不同、只发一次）的数字搞混。
   * 要改只改这里，全项目只此一处。 */
  var TOKEN_REWARD = { boss: 90, battle: 40 };

  /**
   * 算一条路线一轮能拿多少代币。只跟路线经过哪些节点有关，
   * 跟编队、出战分配、一倍/三倍都无关（三倍只放大油耗和掉落，不加代币）。
   * 注: 这是「限时活动」的口径，档案版本没有代币商店，调用方不要在档案模式下展示它。
   */
  function tokens(analysis, map) {
    var bossCount = 0, battleCount = 0, total = 0, detail = [];
    ((analysis && analysis.nodes) || []).forEach(function (id) {
      var n = (map && map.nodes) ? map.nodes[id] : null;
      if (!n) return;
      var v = 0;
      if (n.type === 'boss') { v = TOKEN_REWARD.boss; bossCount++; }
      else if (n.type === 'battle') { v = TOKEN_REWARD.battle; battleCount++; }
      if (v) detail.push({ node: id, type: n.type, tokens: v });
      total += v;
    });
    return { total: total, bossCount: bossCount, battleCount: battleCount, detail: detail };
  }

  /** 按强队优先 / 交替的朴素默认分配（给手动模式一个初始值），同样按沿途台账排弹药 */
  function defaultAssign(analysis, formation) {
    var strong = (formation && formation.strongTeam) || 0;
    var n = analysis.battles.length;
    var after = analysis.ammoAfter || [];
    var assign = [], used = [0, 0];
    for (var i = 0; i < n; i++) {
      var needStrong = analysis.bossSet[analysis.battles[i]];
      var t;
      if (needStrong) t = strong;
      else if (used[strong] < AMMO_CAP) t = strong;
      else t = 1 - strong;
      // 换队也满就维持原队 —— 让调用方看到"不合法"并提示，而不是悄悄排出超限的方案
      if (!needStrong && used[t] >= AMMO_CAP && used[1 - t] < AMMO_CAP) t = 1 - t;
      assign.push(t);
      if (used[t] < AMMO_CAP) used[t]++;
      for (var r = 0; r < (after[i] || 0); r++) if (used[t] < AMMO_CAP) used[t]++;
    }
    return assign;
  }

  return {
    AMMO_PER_BATTLE: AMMO_PER_BATTLE, AMMO_CAP: AMMO_CAP,
    TOKEN_REWARD: TOKEN_REWARD,
    teamInfo: teamInfo, compute: compute, tokens: tokens, ammoLedger: ammoLedger,
    checkAssignment: checkAssignment, autoAssign: autoAssign, defaultAssign: defaultAssign
  };
});
