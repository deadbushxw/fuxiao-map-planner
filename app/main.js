/* 主程序: 装配界面、路线交互、条件判定、油耗汇总、路线对比表 */
(function (root) {
  'use strict';
  var FX = root.FX;
  var doc = root.document;
  var h = FX.fleetUi.h;

  var S = null;          // store.state
  var MAP = null;        // 当前地图
  var routeNodes = [];   // 当前路线
  var notice = '';       // 一次性提示
  var libTab = 'fleet';

  /* 阵营显示成「奥鲁加（德）」 */
  function facLabel(name) {
    return root.FX_FACTION_LABEL ? root.FX_FACTION_LABEL(name) : name;
  }
  /* 条件原文里的 <阵营> 补上国家 */
  function annotate(text) {
    return root.FX_ANNOTATE_FACTIONS ? root.FX_ANNOTATE_FACTIONS(text) : text;
  }

  /* ---------- 动态加载地图文件（经典 script，file:// 下不受 CORS 限制） ---------- */

  /** file:// 下 src 带查询串会被当成文件名的一部分而找不到文件，所以只在 http(s) 下加防缓存参数 */
  function canBust() {
    return /^https?:$/i.test((root.location && root.location.protocol) || '');
  }

  function loadMaps() {
    var files = root.FX_MAP_FILES || [];
    if (!files.length) return Promise.resolve([]);
    function attempt(round) {
      var left = files.length;
      return new Promise(function (resolve) {
        files.forEach(function (f) {
          var s = doc.createElement('script');
          s.src = 'data/maps/' + f + (round && canBust() ? ('?r=' + Date.now()) : '');
          var done = function () { if (--left === 0) resolve(); };
          s.onload = done; s.onerror = done;
          doc.head.appendChild(s);
        });
      }).then(function () {
        var got = root.FX_MAPS || [];
        if (got.length >= files.length || round >= 1) return got;
        return attempt(round + 1);   // 偶发漏执行，再补一次
      });
    }
    return attempt(0);
  }

  /* ---------- 路线计算 ---------- */
  function reachableFrom(id) {
    var out = {};
    ((MAP.nodes[id] || {}).next || []).forEach(function (e) { out[e.to] = true; });
    return out;
  }

  function routeEval(nodes) {
    var fleet = FX.store.currentFleet();
    var analysis = FX.graph.analyzeRoute(MAP, nodes);
    if (!fleet) return { analysis: analysis, fleet: null, condResult: null, conflicts: [], auto: null };
    var shipMap = FX.store.shipMap();
    var ctx = FX.conditions.buildContext(fleet, shipMap);
    var conds = FX.graph.routeConds(analysis);
    return {
      analysis: analysis, fleet: fleet, ctx: ctx,
      condResult: FX.conditions.evaluateAll(conds, ctx),
      conds: conds,
      conflictInfo: FX.conditions.analyze(conds),
      auto: FX.oil.autoAssign(analysis, fleet, shipMap, S.mode),
      shipMap: shipMap
    };
  }

  /* ---------- 地图交互 ---------- */
  function onNodeClick(id) {
    var tail = routeNodes[routeNodes.length - 1];
    var outs = reachableFrom(tail);
    if (outs[id]) {
      routeNodes.push(id);
      notice = '';
      S.assign = [];
    } else if (routeNodes.length >= 2 && (id === tail || id === routeNodes[routeNodes.length - 2])) {
      // 点当前所在节点 = 取消走它；点上一个节点 = 退回一步。两者都等价于「撤回一步」。
      routeNodes.pop();
      notice = '';
      S.assign = [];
    } else {
      var can = Object.keys(outs).join(' / ') || '（无，这是终点）';
      notice = '「' + id + '」从当前所在点「' + tail + '」不可达。当前可去：' + can +
               '。想换路线请用「撤回」或「清空」重新走。';
      rerender();
      return;
    }
    S.selectedRouteKey = FX.graph.routeKey(routeNodes);
    FX.store.save();
    rerender();
  }

  /* ---------- 汇总面板 ---------- */
  function renderSummary(host, ev) {
    host.innerHTML = '';
    var a = ev.analysis;

    if (!ev.fleet) {
      host.appendChild(h('div', { class: 'fx-empty', text: '先在右边建一个编队，才能判断这条路走不走得通、要烧多少油。' }));
    }

    // 基本盘
    var battles = a.battles || [];
    host.appendChild(h('div', { class: 'fx-sum-line fx-sum-big' }, [
      h('span', { text: '共 ' + battles.length + ' 战' }),
      a.oilPoints.length ? h('span', { class: 'fx-oil', text: '　油点 ' +
        a.oilPoints.map(function (o) { return o.node + ' 在第' + o.afterBattle + '战后'; }).join('、') }) : null
    ]));
    host.appendChild(h('div', { class: 'fx-muted', text: '路线：' + a.nodes.join(' → ') }));

    // 终点 boss 信息
    var term = MAP.nodes[a.terminal];
    if (term && term.type === 'boss') {
      var armors = FX.graph.armorList(term);
      var bossN = FX.graph.bossTotal(term);
      var box = h('div', { class: 'fx-boss' });
      box.appendChild(h('div', { text: '终点 ' + term.label + '　装甲：' + (armors.join('+') || '?') +
        (bossN > 1 ? '（' + bossN + ' 个 BOSS）' : '') + '　LV.' + (term.lv || '?') }));
      if (bossN > 1) {
        (term.bosses || []).forEach(function (b) {
          box.appendChild(h('div', { class: 'fx-muted', text: '　' + b.type + ' ×' + (b.count || 1) + '　装甲 ' + b.armor }));
        });
      }
      (term.goldDrops || []).forEach(function (g) {
        box.appendChild(h('div', { class: 'fx-gold' + (g.up ? '' : ' no-up'),
          text: '金色掉落：' + g.name + ' · ' + facLabel(g.faction) + ' · ' + g.shipType + (g.up ? ' · 掉落UP' : ' · 非UP') }));
      });
      if (term.otherDropsGold && term.otherDropsGold.length) {
        box.appendChild(h('div', { class: 'fx-warn', text: '⚠ 另有金色非UP掉落 ' +
          term.otherDropsGold.map(function (g) { return g.name; }).join('、') + '，会稀释掉落池' }));
      }
      if (term.polluted) box.appendChild(h('div', { class: 'fx-warn', text: '⚠ 该点已被你标记为"有金色非UP掉落"（污染）' }));
      box.appendChild(h('button', { class: 'fx-chip-btn', text: '标记污染', title: '普通战斗点有时会有金色非UP舰灵，自动识别覆盖不到，由使用者手动标记',
        onclick: function () { term.polluted = !term.polluted; MAP.nodes[a.terminal].polluted = term.polluted; FX.store.save(); rerender(); } }));
      host.appendChild(box);
    }

    if (!ev.fleet) return;

    // 出战分配
    var shipMap = ev.shipMap;
    var analysis = a;
    var assign = (S.assign && S.assign.length === battles.length) ? S.assign : (ev.auto && ev.auto.ok ? ev.auto.assign : FX.oil.defaultAssign(analysis, ev.fleet));
    S.assign = assign.slice();

    var assignBox = h('div', { class: 'fx-assign' });
    assignBox.appendChild(h('div', { class: 'fx-sec-title', text: '出战分配（每队上限 5 战，boss 必须强队）' }));
    battles.forEach(function (nid, i) {
      var isBoss = !!analysis.bossSet[nid];
      var row = h('div', { class: 'fx-assign-row' }, [
        h('span', { class: 'fx-assign-node', text: '第' + (i + 1) + '战 ' + nid + (isBoss ? ' (BOSS)' : '') })
      ]);
      [0, 1].forEach(function (t) {
        var dis = isBoss && t !== ev.fleet.strongTeam;
        row.appendChild(h('button', {
          class: 'fx-seg' + (assign[i] === t ? ' on' : '') + (dis ? ' dis' : ''),
          text: (t + 1) + '队' + (ev.fleet.strongTeam === t ? '(强)' : ''),
          title: dis ? 'boss 点必须由强队出战' : '让该队打这一战',
          onclick: function () {
            if (dis) return;
            assign[i] = t; S.assign = assign.slice(); FX.store.save(); rerender();
          }
        }));
      });
      assignBox.appendChild(row);
    });
    assignBox.appendChild(h('button', { class: 'fx-btn', text: '自动分配（最省油）', onclick: function () {
      var r = FX.oil.autoAssign(analysis, ev.fleet, shipMap, S.mode);
      if (r.ok) { S.assign = r.assign.slice(); FX.store.save(); rerender(); }
      else { notice = '自动分配失败：' + r.reason; rerender(); }
    } }));
    host.appendChild(assignBox);

    // 油耗
    var res1 = FX.oil.compute(analysis, ev.fleet, shipMap, assign, 'x1');
    var res3 = FX.oil.compute(analysis, ev.fleet, shipMap, assign, 'x3');
    var bad = FX.oil.checkAssignment(analysis, ev.fleet, assign);
    if (bad) host.appendChild(h('div', { class: 'fx-warn', text: '⚠ 当前分配不合法：' + bad }));
    if (ev.auto && !ev.auto.ok) host.appendChild(h('div', { class: 'fx-warn', text: '⚠ ' + ev.auto.reason }));

    var oilBox = h('div', { class: 'fx-oil-box' });
    oilBox.appendChild(h('div', { class: 'fx-sec-title', text: '油耗与弹药' }));
    oilBox.appendChild(h('div', { class: 'fx-kv' }, [
      h('span', { text: '一倍一轮油耗' }), h('b', { text: res1.net + ' 油' }),
      h('span', { class: 'fx-muted', text: '（毛耗 ' + res1.gross + ' − 返油 ' + res1.refund + '）' })
    ]));
    oilBox.appendChild(h('div', { class: 'fx-kv' }, [
      h('span', { text: '三倍一轮油耗' }), h('b', { text: res3.net + ' 油' }),
      h('span', { class: 'fx-muted', text: '（毛耗 ' + res3.gross + ' − 返油 ' + res3.refund + '）' })
    ]));
    oilBox.appendChild(h('div', { class: 'fx-kv' }, [
      h('span', { text: '弹药（两种模式相同）' }),
      h('b', { text: '1队 ' + res1.ammo[0] + '/5　2队 ' + res1.ammo[1] + '/5' })
    ]));
    oilBox.appendChild(h('div', { class: 'fx-muted', text: '出战队伍油耗：1队 ' + res1.teamOil[0] + '　2队 ' + res1.teamOil[1] }));
    res1.refunds.forEach(function (rf) {
      oilBox.appendChild(h('div', { class: 'fx-muted', text: '油点 ' + rf.node + '：第' + rf.afterBattle + '战后（基准 ' +
        (rf.basisNode || '无') + '，' + ((rf.team === 0 || rf.team === 1) ? (rf.team + 1) + '队' : '—') +
        '）基数 ' + (rf.basisOil || 0) + ' → 返 ' + rf.refund }));
    });
    host.appendChild(oilBox);

    // 带路条件
    var cbox = h('div', { class: 'fx-cond-box' });
    cbox.appendChild(h('div', { class: 'fx-sec-title', text: '带路条件' }));
    a.conditions.forEach(function (c) {
      var okMark = '—', cls = '';
      if (c.edge.cond && c.edge.cond.length) {
        var st = c.edge.cond.map(function (p) { return FX.conditions.evaluate(p, ev.ctx); });
        if (st.indexOf('fail') >= 0) { okMark = '✗ 不满足'; cls = 'bad'; }
        else if (st.indexOf('unknown') >= 0) { okMark = '? 未知'; cls = 'unk'; }
        else { okMark = '✓ 满足'; cls = 'good'; }
      } else {
        okMark = '—';
      }
      cbox.appendChild(h('div', { class: 'fx-cond-row ' + cls }, [
        h('span', { class: 'fx-cond-hop', text: c.from + ' → ' + c.to }),
        h('span', { text: annotate(c.edge.raw || FX.conditions.fmt(c.edge.cond[0] || {})) }),
        h('span', { class: 'fx-cond-prob', text: c.edge.prob ? '概率 ' + c.edge.prob : '' }),
        h('span', { class: 'fx-cond-state', text: okMark })
      ]));
    });

    if (ev.conflictInfo && ev.conflictInfo.conflicts.length) {
      ev.conflictInfo.conflicts.forEach(function (cf) {
        cbox.appendChild(h('div', { class: 'fx-warn', text: '⚠ 条件互相矛盾：' + cf.conds.map(function (c) { return annotate(c.raw || FX.conditions.fmt(c)); }).join(' 与 ') +
          ' —— 同一条路上不可能同时成立，这条路物理上走不通' }));
      });
    }
    if (ev.conflictInfo) {
      var feas = ev.conflictInfo.dims.filter(function (d) { return d.feasible; })
        .map(function (d) { return FX.conditions.dimLabel(d.dimKey, facLabel) + ' ∈ [' + d.lo + ',' + d.hi + ']'; });
      if (feas.length) cbox.appendChild(h('div', { class: 'fx-muted', text: '汇总可行区间：' + feas.join('　') }));
    }
    if (ev.condResult && ev.condResult.unknown.length) {
      cbox.appendChild(h('div', { class: 'fx-muted', text: '有 ' + ev.condResult.unknown.length +
        ' 条条件无法判定（缺航速/索敌数据），已在编队里手动填「舰队均速值/索敌值」即可判定' }));
    }
    host.appendChild(cbox);
  }

  /* ---------- 路线对比表 ---------- */
  var routeFilter = 'all';
  function renderRouteTable(host) {
    host.innerHTML = '';
    var all = FX.graph.enumerateRoutes(MAP);
    var fleet = FX.store.currentFleet();
    var shipMap = FX.store.shipMap();

    var bar = h('div', { class: 'fx-row' }, [h('span', { class: 'fx-sec-title', text: '路线对比' })]);
    var sel = h('select', { onchange: function (e) { routeFilter = e.target.value; rerender(); } });
    ['all'].concat(Object.keys(MAP.nodes).filter(function (id) { return !(MAP.nodes[id].next || []).length; }))
      .forEach(function (t) {
        var o = h('option', { value: t, text: t === 'all' ? '全部终点' : '终点 ' + t });
        if (t === routeFilter) o.selected = true;
        sel.appendChild(o);
      });
    bar.appendChild(sel);
    host.appendChild(bar);

    var rows = all.map(function (nodes) {
      var a = FX.graph.analyzeRoute(MAP, nodes);
      var row = { nodes: nodes, a: a };
      if (fleet) {
        var ctx = FX.conditions.buildContext(fleet, shipMap);
        row.condResult = FX.conditions.evaluateAll(FX.graph.routeConds(a), ctx);
        var ci = FX.conditions.analyze(FX.graph.routeConds(a));
        row.conflict = ci.conflicts.length > 0;
        row.auto = FX.oil.autoAssign(a, fleet, shipMap, S.mode);
        if (row.auto.ok) {
          row.r1 = FX.oil.compute(a, fleet, shipMap, row.auto.assign, 'x1');
          row.r3 = FX.oil.compute(a, fleet, shipMap, row.auto.assign, 'x3');
        }
      }
      return row;
    }).filter(function (r) {
      if (routeFilter !== 'all' && r.a.terminal !== routeFilter) return false;
      if (S.hideUnknown && r.condResult && r.condResult.fail.length) return false;
      return true;
    }).sort(function (x, y) {
      // 主排序按油耗；油耗相同（例如还没建编队，全是 0）或不可行时退化成按战斗数
      if (fleet && x.r1 && y.r1 && x.r1.net !== y.r1.net) return x.r1.net - y.r1.net;
      if (x.a.battles.length !== y.a.battles.length) return x.a.battles.length - y.a.battles.length;
      return 0;
    });

    var table = h('table', { class: 'fx-table fx-route-table' });
    table.appendChild(h('thead', {}, [h('tr', {}, ['路线', '战斗', '油点', '一倍油', '三倍油', '弹药', '条件', '终点'].map(function (t) {
      return h('th', { text: t });
    }))]));
    var tb = h('tbody', {});
    rows.forEach(function (r) {
      var tr = h('tr', { class: 'fx-route-row' + (FX.graph.routeKey(r.nodes) === S.selectedRouteKey ? ' sel' : ''),
                         onclick: function () {
                           routeNodes = r.nodes.slice();
                           S.selectedRouteKey = FX.graph.routeKey(routeNodes);
                           S.assign = r.auto && r.auto.ok ? r.auto.assign.slice() : [];
                           FX.store.save(); rerender();
                         } });
      tr.appendChild(h('td', { class: 'fx-route-path', text: r.nodes.join('→') }));
      tr.appendChild(h('td', { text: r.a.battles.length }));
      tr.appendChild(h('td', { text: r.a.oilPoints.length ? r.a.oilPoints.map(function (o) { return o.node + '@' + o.afterBattle; }).join(',') : '—' }));

      if (!fleet) {
        tr.appendChild(h('td', { text: '—' })); tr.appendChild(h('td', { text: '—' }));
        tr.appendChild(h('td', { text: '—' }));
        tr.appendChild(h('td', { text: '未建编队' }));
      } else if (!r.auto.ok) {
        tr.appendChild(h('td', { text: '—' })); tr.appendChild(h('td', { text: '—' }));
        tr.appendChild(h('td', { text: '—' }));
        tr.appendChild(h('td', { class: 'bad', text: '走不通' }));
      } else {
        tr.appendChild(h('td', { text: r.r1.net }));
        tr.appendChild(h('td', { text: r.r3.net }));
        tr.appendChild(h('td', { text: r.r1.ammo[0] + '/' + r.r1.ammo[1] }));
        var st = '✓';
        var cls = 'good';
        if (r.conflict) { st = '✗ 条件矛盾'; cls = 'bad'; }
        else if (r.condResult.fail.length) { st = '✗ ' + r.condResult.fail.length + ' 条不满足'; cls = 'bad'; }
        else if (r.condResult.unknown.length) { st = '? ' + r.condResult.unknown.length + ' 条未知'; cls = 'unk'; }
        tr.appendChild(h('td', { class: cls, text: st }));
      }
      var term = MAP.nodes[r.a.terminal];
      var gold = (term.goldDrops || []).map(function (g) {
        return g.name + '·' + facLabel(g.faction) + (g.up ? '' : '(非UP)');
      }).join('、');
      tr.appendChild(h('td', { text: r.a.terminal + '/' + FX.graph.armorText(term) + (gold ? ' · ' + gold : '') +
        (term.polluted ? ' ⚠' : '') }));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    host.appendChild(table);
    host.appendChild(h('div', { class: 'fx-muted', text: '共 ' + rows.length + ' 条（点一行可载入到左侧地图）' }));
  }

  /* ================= 覆盖规划 =================
   * 目标: 用最少总战数把还没通过的战斗节点全部走一遍（全非灰才解锁自动作战）。
   * 一趟只能走一条从起点出发的路线，且 O/Q 这类互斥分支一趟走不到，所以要按趟规划。 */

  var bottomTab = 'routes';

  /** 还需要覆盖的节点：战斗点(含BOSS) 里还没标记"已通过"的 */
  function coverageTargets() {
    if (!MAP) return [];
    var o = S.coverageOpts;
    var visited = FX.store.visitedOf(MAP.id);
    return Object.keys(MAP.nodes).filter(function (id) {
      var n = MAP.nodes[id];
      if (!FX.graph.isBattle(n)) return false;
      if (!o.includeBoss && n.type === 'boss') return false;
      return !visited[id];
    });
  }

  /** 编队是否已经填够（每队至少 2 个舰灵）。
   *  空编队会让"至少 N 个"这类条件恒不满足，那是没数据而不是条件不成立，
   *  所以没填够时不做过滤，否则会把路线几乎全排掉、给出误导性结论。 */
  function fleetReady(fleet) {
    if (!fleet || !fleet.teams || fleet.teams.length < 2) return false;
    return fleet.teams.every(function (t) { return (t.ships || []).length >= 2; });
  }

  /** 用当前编队过滤候选路线：条件明确不满足的路线不参与规划（未知的放行） */
  function coverageFilter() {
    if (!S.coverageOpts.useFleetFilter) return null;
    var fleet = FX.store.currentFleet();
    if (!fleetReady(fleet)) return null;
    var shipMap = FX.store.shipMap();
    var ctx = FX.conditions.buildContext(fleet, shipMap);
    return function (nodes) {
      var an = FX.graph.analyzeRoute(MAP, nodes);
      return FX.conditions.evaluateAll(FX.graph.routeConds(an), ctx).fail.length === 0;
    };
  }

  function chk(label, value, onchange, title) {
    var id = 'chk_' + Math.random().toString(36).slice(2, 8);
    return h('label', { class: 'fx-radio', for: id, title: title || '' }, [
      h('input', { type: 'checkbox', id: id, checked: value ? 'checked' : null,
                   onchange: function (e) { onchange(e.target.checked); } }),
      h('span', { text: label })
    ]);
  }

  /** 从截图里按每个节点记录的坐标采样图标颜色，判定已通过 / 未通过 */
  function sampleVisited(img) {
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    var ratio = W / H, target = 1920 / 1080;
    if (Math.abs(ratio - target) > 0.04) {
      throw new Error('图片长宽比是 ' + ratio.toFixed(3) + '，和地图的 16:9(' + target.toFixed(3) +
                      ') 差太多，无法对齐坐标。请用模拟器的原始截图（1920x1080）。');
    }
    var canvas = doc.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var data = ctx.getImageData(0, 0, W, H).data;
    return FX.coverage.sampleVisited(MAP, FX.graph, W, H, function (x, y) {
      var o = (y * W + x) * 4;
      return { r: data[o], g: data[o + 1], b: data[o + 2] };
    });
  }

  function readShot(file) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var msg;
      try {
        var res = sampleVisited(img);
        var ids = Object.keys(res);
        var vis = ids.filter(function (id) { return res[id] === 'visited'; });
        var unvis = ids.filter(function (id) { return res[id] === 'unvisited'; });
        var unknown = ids.length - vis.length - unvis.length;
        FX.store.setVisitedBulk(MAP.id, vis, true);
        FX.store.setVisitedBulk(MAP.id, unvis, false);
        msg = '截图识别：已通过 ' + vis.length + ' 个，未通过 ' + unvis.length + ' 个' +
              (unknown ? '，无法判定 ' + unknown + ' 个（保持原样）' : '') + '。';
      } catch (e) {
        msg = '截图识别失败：' + e.message;
      }
      URL.revokeObjectURL(url);
      notice = msg;
      onChange();
    };
    img.onerror = function () { URL.revokeObjectURL(url); notice = '图片打不开。'; onChange(); };
    img.src = url;
  }

  function renderCoverage(host) {
    host.innerHTML = '';
    if (!FX.coverage) {
      host.appendChild(h('div', { class: 'fx-empty', text: 'coverage 模块没有加载成功。' }));
      return;
    }
    var o = S.coverageOpts;
    var visited = FX.store.visitedOf(MAP.id);
    var battleIds = Object.keys(MAP.nodes).filter(function (id) { return FX.graph.isBattle(MAP.nodes[id]); });

    // --- 选项 ---
    var bar = h('div', { class: 'fx-row' });
    bar.appendChild(chk('允许中途撤退', o.allowRetreat, function (v) { o.allowRetreat = v; FX.store.save(); rerender(); },
      '允许的话候选路线会包含所有前缀，最后一趟可能不用走到底，最优解通常更省'));
    bar.appendChild(chk('包含 BOSS 点', o.includeBoss, function (v) { o.includeBoss = v; FX.store.save(); rerender(); }));
    bar.appendChild(chk('用当前编队过滤条件', o.useFleetFilter, function (v) { o.useFleetFilter = v; FX.store.save(); rerender(); },
      '开启后，带路条件明确不满足的路线不参与规划'));
    var objSel = h('select', { onchange: function (e) { o.objective = e.target.value; FX.store.save(); rerender(); } });
    [['battles', '目标：最少总战数'], ['runs', '目标：最少趟数']].forEach(function (p) {
      var opt = h('option', { value: p[0], text: p[1] });
      if (o.objective === p[0]) opt.selected = true;
      objSel.appendChild(opt);
    });
    bar.appendChild(objSel);
    host.appendChild(bar);

    // --- 已通过节点 ---
    var sec = h('div', { class: 'fx-cover-sec' });
    sec.appendChild(h('div', { class: 'fx-sec-title', text:
      '已通过节点（' + battleIds.filter(function (id) { return visited[id]; }).length + '/' + battleIds.length +
      '）　点击切换；地图上 Shift+点击 也可以' }));
    var chips = h('div', { class: 'fx-chips' });
    battleIds.forEach(function (id) {
      var n = MAP.nodes[id];
      chips.appendChild(h('button', {
        class: 'fx-chip fx-vchip' + (visited[id] ? ' on' : ''),
        title: '点击切换「' + id + '」的已通过状态',
        text: id + (n.type === 'boss' ? '(BOSS)' : ''),
        onclick: function () { FX.store.toggleVisited(MAP.id, id); rerender(); }
      }));
    });
    sec.appendChild(chips);
    sec.appendChild(h('div', { class: 'fx-row' }, [
      h('button', { class: 'fx-btn', text: '全部标为已通过', onclick: function () {
        FX.store.setVisitedBulk(MAP.id, battleIds, true); rerender();
      } }),
      h('button', { class: 'fx-btn', text: '全部标为未通过', onclick: function () {
        FX.store.setVisitedBulk(MAP.id, battleIds, false); rerender();
      } })
    ]));

    // --- 截图识别 ---
    var drop = h('div', { class: 'fx-drop' }, [
      h('span', { text: '把游戏地图截图拖到这里自动识别已通过节点（或点这里选文件）。按节点坐标采样图标颜色：已通过=青蓝/红/亮绿，未通过=灰白。' })
    ]);
    var fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    drop.onclick = function () { fileInput.click(); };
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.className = 'fx-drop over'; });
    drop.addEventListener('dragleave', function () { drop.className = 'fx-drop'; });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.className = 'fx-drop';
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readShot(f);
    });
    fileInput.onchange = function () {
      var f = fileInput.files[0];
      if (f) readShot(f);
      fileInput.value = '';
    };
    sec.appendChild(drop);
    sec.appendChild(fileInput);
    host.appendChild(sec);

    // --- 求解 ---
    var targets = coverageTargets();
    if (!targets.length) {
      host.appendChild(h('div', { class: 'fx-empty', text: '所有战斗节点都标记为已通过了，不需要规划。' }));
      return;
    }
    var fleetNow = FX.store.currentFleet();
    var filter = coverageFilter();
    var sol = FX.coverage.solve(MAP, FX.graph, targets, {
      allowRetreat: o.allowRetreat,
      objective: o.objective,
      filter: filter
    });

    // 说明过滤是否真的生效、排掉了多少条路
    if (o.useFleetFilter) {
      if (!filter) {
        host.appendChild(h('div', { class: 'fx-muted', text:
          '「用当前编队过滤条件」已开启，但编队还没填够（每队至少 2 个舰灵），本次规划没有按条件过滤。' }));
      } else {
        var allC = FX.coverage.candidates(MAP, FX.graph, { allowRetreat: o.allowRetreat }).length;
        var keptC = FX.coverage.candidates(MAP, FX.graph, { allowRetreat: o.allowRetreat, filter: filter }).length;
        host.appendChild(h('div', { class: 'fx-muted', text:
          '已按当前编队的带路条件过滤：候选路线 ' + allC + ' 条中保留 ' + keptC + ' 条，排除 ' + (allC - keptC) + ' 条。' }));
      }
    }

    if (!sol.ok) {
      host.appendChild(h('div', { class: 'fx-warn', text: '⚠ ' + sol.reason }));
      if (sol.uncovered && sol.uncovered.length) {
        host.appendChild(h('div', { class: 'fx-muted', text:
          '未覆盖到的节点：' + sol.uncovered.join('、') + '。可以试着关掉「用当前编队过滤条件」，或调整编队后再规划。' }));
      }
      return;
    }

    // --- 每趟的油耗 ---
    var fleet = fleetNow;
    var shipMap = FX.store.shipMap();
    var rows = sol.runs.map(function (run) {
      var an = FX.graph.analyzeRoute(MAP, run.nodes);
      var r = { run: run, an: an, net1: null, net3: null, why: null };
      if (fleet) {
        var auto = FX.oil.autoAssign(an, fleet, shipMap, S.mode);
        if (auto.ok) {
          r.net1 = FX.oil.compute(an, fleet, shipMap, auto.assign, 'x1');
          r.net3 = FX.oil.compute(an, fleet, shipMap, auto.assign, 'x3');
        } else {
          r.why = auto.reason;
        }
      }
      return r;
    });
    var sum1 = rows.reduce(function (s, r) { return s + (r.net1 ? r.net1.net : 0); }, 0);
    var sum3 = rows.reduce(function (s, r) { return s + (r.net3 ? r.net3.net : 0); }, 0);
    var oilKnown = fleet && rows.every(function (r) { return r.net1; });

    var head = h('div', { class: 'fx-sum-line fx-sum-big' });
    head.appendChild(h('span', { text: '还需覆盖 ' + targets.length + ' 个节点 → ' + sol.runCount + ' 趟，共 ' + sol.totalBattles + ' 战' }));
    if (oilKnown) {
      head.appendChild(h('span', { class: 'fx-oil', text: '　合计油耗：一倍 ' + sum1 + '　三倍 ' + sum3 }));
    }
    host.appendChild(head);
    if (!fleet) host.appendChild(h('div', { class: 'fx-muted', text: '（建一个编队后会同时算出每趟油耗与弹药分配）' }));

    var table = h('table', { class: 'fx-table fx-route-table' });
    table.appendChild(h('thead', {}, [h('tr', {}, ['趟', '路线', '战数', '本趟新增覆盖', '油点', '一倍油', '三倍油', ''].map(function (t) {
      return h('th', { text: t });
    }))]));
    var tb = h('tbody', {});
    rows.forEach(function (r, i) {
      var tr = h('tr', { class: 'fx-route-row' });
      tr.appendChild(h('td', { text: '第' + (i + 1) + '趟' }));
      tr.appendChild(h('td', { class: 'fx-route-path', text: r.run.nodes.join('→') }));
      tr.appendChild(h('td', { text: r.run.battles }));
      tr.appendChild(h('td', { class: 'good', text: r.run.newCovered.join(' ') || '—' }));
      tr.appendChild(h('td', { text: r.an.oilPoints.length ? r.an.oilPoints.map(function (x) { return x.node + '@' + x.afterBattle; }).join(',') : '—' }));
      tr.appendChild(h('td', { text: r.net1 ? r.net1.net : '—' }));
      tr.appendChild(h('td', { text: r.net3 ? r.net3.net : '—' }));
      tr.appendChild(h('td', {}, [h('button', { class: 'fx-btn', text: '载入地图', onclick: function (e) {
        e.stopPropagation();
        routeNodes = r.run.nodes.slice();
        S.selectedRouteKey = FX.graph.routeKey(routeNodes);
        S.assign = [];
        FX.store.save(); rerender();
      } })]));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    host.appendChild(table);

    var problems = rows.filter(function (r) { return r.why; });
    if (problems.length) {
      host.appendChild(h('div', { class: 'fx-warn', text: '⚠ 有 ' + problems.length +
        ' 趟无法给出合法出战分配（例如超过两队各 5 战的上限）：' + problems[0].why }));
    }
    host.appendChild(h('div', { class: 'fx-muted', text:
      '规划只保证"战斗节点全部走到"，每趟的出战分配仍按「BOSS 强制强队、每队 ≤5 战」自动算。' }));
  }

  /* ---------- 渲染 ---------- */
  function rerender() {
    if (!MAP) return;
    var ev = routeEval(routeNodes);
    var tail = routeNodes[routeNodes.length - 1];
    // 已通过 / 待覆盖的标记只在「覆盖规划」页签下显示，其余时候地图保持干净
    var showCover = (bottomTab === 'coverage');
    var visited = showCover ? FX.store.visitedOf(MAP.id) : null;
    var pending = null;
    if (showCover) {
      pending = {};
      coverageTargets().forEach(function (id) { pending[id] = true; });
    }
    FX.mapUi.render(doc.getElementById('fx-map'), MAP, {
      routeNodes: routeNodes,
      analysis: ev.analysis,
      reachable: reachableFrom(tail),
      visited: visited,
      pending: pending,
      onNodeClick: onNodeClick,
      // 标记动作也跟着页签走，避免在看不到标记时留下"隐形"的状态改动
      onToggleVisited: showCover ? function (id) {
        FX.store.toggleVisited(MAP.id, id);
        notice = '「' + id + '」已标记为' + (FX.store.isVisited(MAP.id, id) ? '已通过' : '未通过');
        rerender();
      } : null
    });

    // 提示条
    var nb = doc.getElementById('fx-notice');
    nb.textContent = notice || '';
    nb.style.display = notice ? 'block' : 'none';

    // 地图选择
    var ms = doc.getElementById('fx-map-select');
    ms.innerHTML = '';
    (root.FX_MAPS || []).forEach(function (m) {
      var o = h('option', { value: m.id, text: m.event + ' / ' + m.difficulty });
      if (m.id === MAP.id) o.selected = true;
      ms.appendChild(o);
    });

    // 侧栏
    var libHost = doc.getElementById('fx-lib');
    if (libTab === 'fleet') {
      FX.fleetUi.renderFormation(libHost, S, onChange, (ev.analysis && ev.analysis.conditions) || []);
    } else {
      FX.fleetUi.renderLibrary(libHost, S, onChange);
    }

    doc.getElementById('fx-tab-fleet').className = 'fx-tab' + (libTab === 'fleet' ? ' on' : '');
    doc.getElementById('fx-tab-lib').className = 'fx-tab' + (libTab === 'lib' ? ' on' : '');

    renderSummary(doc.getElementById('fx-summary'), ev);

    doc.getElementById('fx-btab-routes').className = 'fx-tab' + (bottomTab === 'routes' ? ' on' : '');
    doc.getElementById('fx-btab-coverage').className = 'fx-tab' + (bottomTab === 'coverage' ? ' on' : '');
    doc.getElementById('fx-routes').style.display = bottomTab === 'routes' ? '' : 'none';
    doc.getElementById('fx-coverage').style.display = bottomTab === 'coverage' ? '' : 'none';
    if (bottomTab === 'routes') renderRouteTable(doc.getElementById('fx-routes'));
    else renderCoverage(doc.getElementById('fx-coverage'));

    doc.getElementById('fx-mode-1x').className = 'fx-tab' + (S.mode === 'x1' ? ' on' : '');
    doc.getElementById('fx-mode-3x').className = 'fx-tab' + (S.mode === 'x3' ? ' on' : '');
    doc.getElementById('fx-undo').disabled = routeNodes.length < 2;
    doc.getElementById('fx-storage').textContent = FX.store.isStorageOK() ? '' : '⚠ 浏览器禁用了本地存储，改动不会自动保存，请用「导出」';
  }

  function onChange(light) {
    FX.store.save();
    if (!light) rerender();
    else {
      // 轻量改动（输入框逐字）只刷新汇总，避免重绘导致输入框失焦
      var ev = routeEval(routeNodes);
      renderSummary(doc.getElementById('fx-summary'), ev);
      renderRouteTable(doc.getElementById('fx-routes'));
    }
  }

  /* ---------- 启动 ---------- */
  function start(maps) {
    S = FX.store.init();
    if (!maps.length) {
      doc.getElementById('fx-map').innerHTML = '<div class="fx-empty">没有加载到地图数据。检查 data/maps/index.js 的清单和对应文件。</div>';
      return;
    }
    MAP = maps.filter(function (m) { return m.id === S.selectedMapId; })[0] || maps[0];
    S.selectedMapId = MAP.id;

    if (!S.selectedRouteKey) {
      routeNodes = [MAP.start];
    } else {
      routeNodes = S.selectedRouteKey.split('>');
      if (!MAP.nodes[routeNodes[0]]) routeNodes = [MAP.start];
    }
    if (!S.fleets.length) FX.store.addFleet();

    doc.getElementById('fx-map-select').addEventListener('change', function (e) {
      MAP = (root.FX_MAPS || []).filter(function (m) { return m.id === e.target.value; })[0] || MAP;
      S.selectedMapId = MAP.id;
      routeNodes = [MAP.start]; S.selectedRouteKey = null; S.assign = [];
      FX.store.save(); rerender();
    });
    doc.getElementById('fx-tab-fleet').onclick = function () { libTab = 'fleet'; rerender(); };
    doc.getElementById('fx-tab-lib').onclick = function () { libTab = 'lib'; rerender(); };
    doc.getElementById('fx-btab-routes').onclick = function () { bottomTab = 'routes'; rerender(); };
    doc.getElementById('fx-btab-coverage').onclick = function () { bottomTab = 'coverage'; rerender(); };
    doc.getElementById('fx-mode-1x').onclick = function () { S.mode = 'x1'; FX.store.save(); rerender(); };
    doc.getElementById('fx-mode-3x').onclick = function () { S.mode = 'x3'; FX.store.save(); rerender(); };
    doc.getElementById('fx-undo').onclick = function () {
      if (routeNodes.length > 1) { routeNodes.pop(); S.assign = []; S.selectedRouteKey = FX.graph.routeKey(routeNodes); FX.store.save(); rerender(); }
    };
    doc.getElementById('fx-reset').onclick = function () {
      routeNodes = [MAP.start]; S.assign = []; S.selectedRouteKey = null; FX.store.save(); rerender();
    };
    doc.getElementById('fx-export-ships').onclick = function () { FX.store.exportShips(); };
    doc.getElementById('fx-export-fleets').onclick = function () { FX.store.exportFleets(); };
    var imp = doc.getElementById('fx-import');
    imp.onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var ships = FX.store.parseDataFile(String(r.result), 'FX_SHIPS');
          S.ships = ships;
          S.deletedShips = [];      // 显式导入视为整库替换，墓碑一并清掉
          FX.store.save(); libTab = 'lib'; rerender();
          alert('已导入 ' + ships.length + ' 个舰灵。记得到 data/ships.js 覆盖保存。');
        } catch (err) {
          alert('导入失败：' + err.message);
        }
      };
      r.readAsText(f, 'utf-8');
      e.target.value = '';
    };

    rerender();
  }

  /* ---------- 启动失败的可见诊断 ----------
   * 之前踩过的坑: 任何一个脚本没加载成功，start() 就会中途抛异常，
   * 页面只剩一片空白且毫无提示。这里把启动包起来，出错时直接把原因显示在页面上。 */
  function fatal(e) {
    var box = doc.getElementById('fx-map');
    var msg = (e && (e.stack || e.message)) || String(e);
    if (box) box.innerHTML = '<div class="fx-empty" style="color:#ff9;margin:20px">' +
      '启动失败：' + msg.replace(/</g, '&lt;') + '</div>';
    if (root.console) root.console.error(e);
  }

  /* ---------- 启动自愈 ----------
   * 实测遇到过极偶发的"某个 script 标签没被执行"（每次缺的文件还不一样），
   * 此时页面会一片空白。这里把每个模块登记成 期望全局变量 -> 文件，
   * 启动时先补载缺失的那些，再启动。真加载不了才走 fatal() 显示原因。 */
  var MODULE_FILES = [
    ['FX_FACTIONS',   'data/factions.js'],
    ['FX_SHIP_TYPES', 'data/shiptypes.js'],
    ['FX_SHIPS',      'data/ships.js'],
    ['FX_FLEETS',     'data/fleets.js'],
    ['FX_MAP_FILES',  'data/maps/index.js'],
    ['FX.conditions', 'app/conditions.js'],
    ['FX.graph',      'app/graph.js'],
    ['FX.oil',        'app/oil.js'],
    ['FX.coverage',   'app/coverage.js'],
    ['FX.store',      'app/store.js'],
    ['FX.mapUi',      'app/map-ui.js'],
    ['FX.fleetUi',    'app/fleet-ui.js'],
    /* 可选的本机私有数据覆盖层（见 local/README.md）：登记成 [全局变量, 文件, 可选]。
     * 文件不存在时补载会 404，但可选模块加载不到不算失败 —— 自己用不上这一层的人
     * 不该因为缺文件就打不开页面。
     * 之所以登记在这里而不是只写 <script> 标签：静态标签偶尔不执行时（见上）
     * 就没有第二道防线了，那会静默丢掉整份舰灵库 —— 走同一套补载逻辑才兜得住。 */
    ['FX_LOCAL_SHIPS',  'local/ships.local.js',  true],
    ['FX_LOCAL_FLEETS', 'local/fleets.local.js', true]
  ];

  /** 支持 'FX_SHIPS' 和 'FX.conditions' 两种写法 */
  function hasGlobal(path) {
    var cur = root, parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return false;
      cur = cur[parts[i]];
    }
    return cur !== undefined;
  }

  function loadScript(src, bust) {
    return new Promise(function (resolve) {
      var s = doc.createElement('script');
      s.src = (bust && canBust()) ? (src + '?r=' + Date.now()) : src;
      var done = function () { resolve(true); };
      s.onload = done;
      s.onerror = done;
      doc.head.appendChild(s);
    });
  }

  /** 补载所有缺失模块，返回仍未就位的列表（可选模块不算在内） */
  function ensureModules() {
    var missing = MODULE_FILES.filter(function (m) { return !hasGlobal(m[0]); });
    if (!missing.length) return Promise.resolve([]);
    return Promise.all(missing.map(function (m) { return loadScript(m[1], true); }))
      .then(function () {
        return MODULE_FILES.filter(function (m) { return !m[2] && !hasGlobal(m[0]); })
                           .map(function (m) { return m[0] + '(' + m[1] + ')'; });
      });
  }

  doc.addEventListener('DOMContentLoaded', function () {
    ensureModules().then(function (stillMissing) {
      if (stillMissing.length) {
        fatal('以下脚本没有加载成功：' + stillMissing.join('、') +
              '。请确认这些文件存在、路径正确，并按 F12 看 Console 有没有报错。');
        return;
      }
      return loadMaps().then(function (maps) {
        try { start(maps); } catch (e) { fatal(e); }
      });
    }).catch(fatal);
  });
})(typeof window !== 'undefined' ? window : globalThis);
