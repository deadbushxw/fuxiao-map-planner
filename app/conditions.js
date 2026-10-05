/* 带路条件求值 / 冲突检测
 *
 * 条件谓词（地图数据里的 next[].cond[]）形如:
 *   { scope: "旗舰"|"舰队", kind: "舰种"|"阵营"|"舰灵数"|"均速"|"索敌", key: "航母"|null, op: "<", n: 3 }
 *
 * 语义（依据游戏面板原文）:
 *   scope="旗舰"  —— 对"两队的旗舰"计数。如 {旗舰,舰种,战列,<,2} = 两个旗舰里舰种是战列的数量 < 2
 *   scope="舰队"  —— 对"两队合并"计数/取值。舰灵数、均速、索敌也取两队合并值
 *   单节点条件不存在"且"，每条 cond 数组长度恒为 1
 *
 * 两个需要你确认的换算假设（都可以在界面上手动覆盖）:
 *   均速值 = 两队全部舰灵航速的算术平均
 *   索敌值 = 两队全部舰灵索敌值之和
 *   两者只要有一个舰灵没录 speed/scout，就判为"未知"，而不是判为不满足。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.FX = root.FX || {}; root.FX.conditions = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 每个维度允许的取值范围，用于冲突检测时求交集
  var DOMAIN = {
    '旗舰|舰种|': { lo: 0, hi: 2 },
    '旗舰|阵营|': { lo: 0, hi: 2 },
    '舰队|舰种|': { lo: 0, hi: 12 },
    '舰队|阵营|': { lo: 0, hi: 12 },
    '舰队|舰灵数|': { lo: 4, hi: 12 },   // 每队 2~6
    '舰队|均速|': { lo: 0, hi: 99 },
    '舰队|索敌|': { lo: 0, hi: 9999 }
  };

  var OP_LABEL = { '<': '<', '<=': '≤', '=': '=', '>=': '≥', '>': '>' };

  /* 游戏面板原文用的是全角 ≥ ≤，数据里两种写法都可能出现（地图数据里就是全角）。
   * 统一归一化成半角再比较 —— 之前漏了这一步，导致全角 '≥' 走进 default 分支：
   * 区间退化成整个定义域、求值恒返回 fail，而且测试用的是半角所以没抓到。 */
  var OP_ALIAS = { '≥': '>=', '≤': '<=', '＞': '>', '＜': '<', '＝': '=', '≧': '>=', '≦': '<=', '≠': '!=' };
  function normOp(op) {
    if (op === undefined || op === null) return '';
    var s = String(op).trim();
    return OP_ALIAS[s] || s;
  }

  /** 条件所约束的"维度"标识。同维度的多个条件才会互相影响。 */
  function dimKey(cond) {
    var scope = cond.scope || '舰队';
    var key = (cond.kind === '舰种' || cond.kind === '阵营') ? (cond.key || '') : '';
    return scope + '|' + cond.kind + '|' + key;
  }

  function domainOf(cond) {
    var k = dimKey(cond);
    if (DOMAIN[k]) return DOMAIN[k];
    // 没登记的舰种/阵营维度按同 scope 的通用范围
    return DOMAIN[cond.scope + '|' + cond.kind + '|'] || { lo: 0, hi: 12 };
  }

  /** 单条条件允许的取值区间（闭区间） */
  function rangeOf(cond) {
    var d = domainOf(cond), n = Number(cond.n);
    switch (normOp(cond.op)) {
      case '<':  return { lo: d.lo, hi: Math.min(d.hi, n - 1) };
      case '<=': return { lo: d.lo, hi: Math.min(d.hi, n) };
      case '=':  return { lo: Math.max(d.lo, n), hi: Math.min(d.hi, n) };
      case '>=': return { lo: Math.max(d.lo, n), hi: d.hi };
      case '>':  return { lo: Math.max(d.lo, n + 1), hi: d.hi };
      default:   return { lo: d.lo, hi: d.hi };
    }
  }

  function opOK(op, value, n) {
    switch (normOp(op)) {
      case '<':  return value < n;
      case '<=': return value <= n;
      case '=':  return value === n;
      case '>=': return value >= n;
      case '>':  return value > n;
      default:   return null;
    }
  }

  /** 由编队算出求值上下文 */
  function buildContext(formation, shipMap) {
    formation = formation || { teams: [] };
    var teams = (formation.teams || []).map(function (t) {
      return (t.ships || []).map(function (id) { return shipMap[id]; }).filter(Boolean);
    });
    var all = [];
    teams.forEach(function (t) { all = all.concat(t); });
    var flags = teams.map(function (t) { return t[0]; }).filter(Boolean);

    var ctx = {
      teams: teams, ships: all, flags: flags,
      shipCount: all.length,
      flagshipCount: flags.length,
      typeCount: {}, factionCount: {},
      flagshipTypeCount: {}, flagshipFactionCount: {},
      avgSpeed: null, scout: null
    };
    all.forEach(function (s) {
      if (s.type)    ctx.typeCount[s.type] = (ctx.typeCount[s.type] || 0) + 1;
      if (s.faction) ctx.factionCount[s.faction] = (ctx.factionCount[s.faction] || 0) + 1;
    });
    flags.forEach(function (s) {
      if (s.type)    ctx.flagshipTypeCount[s.type] = (ctx.flagshipTypeCount[s.type] || 0) + 1;
      if (s.faction) ctx.flagshipFactionCount[s.faction] = (ctx.flagshipFactionCount[s.faction] || 0) + 1;
    });

    var num = function (v) { return (v === null || v === undefined || v === '') ? null : Number(v); };

    ctx.avgSpeed = num(formation.avgSpeed);
    if (ctx.avgSpeed === null && all.length && all.every(function (s) { return num(s.speed) !== null; })) {
      ctx.avgSpeed = all.reduce(function (a, s) { return a + num(s.speed); }, 0) / all.length;
    }

    ctx.scout = num(formation.scout);
    if (ctx.scout === null && all.length && all.every(function (s) { return num(s.scout) !== null; })) {
      ctx.scout = all.reduce(function (a, s) { return a + num(s.scout); }, 0);
    }
    return ctx;
  }

  /** 求条件左值。返回 { known, value, label } */
  function valueOf(cond, ctx) {
    var k = cond.key;
    switch (cond.kind) {
      case '舰种':
        return { known: true, value: (cond.scope === '旗舰' ? ctx.flagshipTypeCount[k] : ctx.typeCount[k]) || 0 };
      case '阵营':
        return { known: true, value: (cond.scope === '旗舰' ? ctx.flagshipFactionCount[k] : ctx.factionCount[k]) || 0 };
      case '舰灵数':
        return { known: true, value: ctx.shipCount };
      case '均速':
        return { known: ctx.avgSpeed !== null, value: (ctx.avgSpeed === null ? null : Math.round(ctx.avgSpeed * 100) / 100) };
      case '索敌':
        return { known: ctx.scout !== null, value: ctx.scout };
      default:
        return { known: false, value: null };
    }
  }

  /** 求值单条条件: 'pass' | 'fail' | 'unknown' */
  function evaluate(cond, ctx) {
    var v = valueOf(cond, ctx);
    if (!v.known) return 'unknown';
    var r = opOK(cond.op, v.value, Number(cond.n));
    return r ? 'pass' : 'fail';
  }

  /** 人话描述，仅在缺少 raw 原文时使用 */
  function fmt(cond) {
    var scope = cond.scope === '旗舰' ? '旗舰中' : '舰队中';
    var subject = cond.kind === '舰种' ? (scope + cond.key)
                : cond.kind === '阵营' ? (scope + '<' + cond.key + '>')
                : (scope + cond.kind);
    return subject + (OP_LABEL[normOp(cond.op)] || cond.op) + cond.n;
  }

  /** 把 "scope|kind|key" 形式的维度标识拆开 */
  function dimMeta(dimKey) {
    var p = String(dimKey).split('|');
    return { scope: p[0] || '舰队', kind: p[1] || '', key: (p[2] === undefined || p[2] === '') ? null : p[2] };
  }

  /** 维度的人话描述，如「舰队中 航母」「旗舰中 <奥鲁加（德）>」
   *  factionLabel 可选，用来给阵营补上国家后缀 */
  function dimLabel(dimKey, factionLabel) {
    var m = dimMeta(dimKey);
    var scope = m.scope === '旗舰' ? '旗舰中' : '舰队中';
    var subj = m.kind === '舰种' ? m.key
             : m.kind === '阵营' ? ('<' + (factionLabel ? factionLabel(m.key) : m.key) + '>')
             : m.kind;
    return scope + ' ' + subj;
  }

  /** 直接按维度取值（给「组队时实时对比条件」用） */
  function valueOfDim(dimKey, ctx) {
    var m = dimMeta(dimKey);
    return valueOf({ scope: m.scope, kind: m.kind, key: m.key }, ctx);
  }

  /** 由区间判断当前值是否达标，并算出还差多少 / 超出多少 */
  function rangeVerdict(lo, hi, v) {
    if (!v || !v.known) return { state: 'unknown', gap: null };
    if (v.value < lo) return { state: 'fail', gap: { need: lo - v.value, dir: '少' } };
    if (v.value > hi) return { state: 'fail', gap: { need: v.value - hi, dir: '多' } };
    return { state: 'pass', gap: null };
  }

  /**
   * 合并同维度条件，求可行区间，找出矛盾。
   * 返回 { dims: [{dimKey, conds, lo, hi, feasible}], conflicts: [...] }
   */
  function analyze(conds) {
    conds = conds || [];
    var byDim = {};
    var order = [];
    conds.forEach(function (c) {
      var k = dimKey(c);
      if (!byDim[k]) { byDim[k] = []; order.push(k); }
      byDim[k].push(c);
    });
    var dims = [], conflicts = [];
    order.forEach(function (k) {
      var list = byDim[k];
      var lo = -Infinity, hi = Infinity;
      list.forEach(function (c) {
        var r = rangeOf(c);
        if (r.lo > lo) lo = r.lo;
        if (r.hi < hi) hi = r.hi;
      });
      var feasible = lo <= hi;
      var entry = { dimKey: k, conds: list, lo: lo, hi: hi, feasible: feasible };
      dims.push(entry);
      if (!feasible) conflicts.push(entry);
    });
    return { dims: dims, conflicts: conflicts };
  }

  /** 把「路线上的带路条件」整理成 维度 → 来源→目标 的索引。
   *  入参是 graph.analyzeRoute() 的 conditions（[{from, to, edge}]），
   *  返回 { '舰队|舰种|航母': ['D → F'], ... }，同一维度由多条边共同约束时按出现顺序去重列出。
   *  「组队时实时对比」那几行是按维度合并渲染的，逐维回指到边才不会张冠李戴；
   *  没有条件（无条件边）不产生条目。 */
  function dimHops(conditions) {
    var out = {};
    (conditions || []).forEach(function (c) {
      if (!c) return;
      var hop = c.from + ' → ' + c.to;
      ((c.edge && c.edge.cond) || []).forEach(function (p) {
        var k = dimKey(p);
        if (!out[k]) out[k] = [];
        if (out[k].indexOf(hop) < 0) out[k].push(hop);
      });
    });
    return out;
  }

  /** 在已算出的上下文里逐条判定 */
  function evaluateAll(conds, ctx) {
    var out = { pass: [], fail: [], unknown: [] };
    (conds || []).forEach(function (c) {
      var r = evaluate(c, ctx);
      out[r].push(c);
    });
    return out;
  }

  return {
    DOMAIN: DOMAIN, OP_LABEL: OP_LABEL, OP_ALIAS: OP_ALIAS, normOp: normOp,
    dimKey: dimKey, domainOf: domainOf, rangeOf: rangeOf, opOK: opOK,
    dimMeta: dimMeta, dimLabel: dimLabel, valueOfDim: valueOfDim, rangeVerdict: rangeVerdict,
    dimHops: dimHops,
    buildContext: buildContext, valueOf: valueOf, evaluate: evaluate,
    fmt: fmt, analyze: analyze, evaluateAll: evaluateAll
  };
});
