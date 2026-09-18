/* 编队 + 舰灵库 编辑界面
 *
 * 舰灵: 舰名 / 油耗 / 舰种 / 国籍 必填；航速、索敌可选（不填则"均速值/索敌值"类条件判为未知）。
 * 编队: 两个队伍，每队 2~6 个舰灵，列表第一个位置即旗舰；整体标一个强队（boss 强制强队出战）。
 *       同一艘船不能编入两个队伍 —— 增删都走 FX.store，由它守住这条不变量。
 *
 * 舰灵多起来之后（上百艘）"找不到想要的船"是主要痛点，所以这里有两套搜索/筛选：
 *   - 选船面板(renderPicker): 加船时按舰名搜索 + 舰种/国籍多选快筛 + 只看收藏 + 最近使用
 *   - 舰灵库(renderLibrary): 全库搜索 + 筛选 + 排序
 * 另外编队面板常驻「两队合并」统计，并把当前路线的带路条件拉过来实时对比，
 * 组队时就能看到"还差几艘航母"，不用来回滚到下面看判定结果。
 */
(function (root) {
  'use strict';
  var FX = root.FX = root.FX || {};
  var doc = root.document;

  function h(tag, attrs, children) {
    var n = doc.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function select(options, value, onChange, allowEmpty, labelFn) {
    var s = h('select', { onchange: function (e) { onChange(e.target.value); } });
    if (allowEmpty) s.appendChild(h('option', { value: '', text: '—' }));
    options.forEach(function (o) {
      var opt = h('option', { value: o, text: labelFn ? labelFn(o) : o });
      if (o === value) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }

  /* ================= 搜索 / 筛选 / 排序（选船面板与舰灵库共用） ================= */

  function freshView() {
    return { q: '', types: {}, factions: {}, favOnly: false, sort: 'name', desc: false };
  }

  function matchesView(ship, view) {
    if (view.favOnly && !ship.fav) return false;
    if (view.q) {
      var q = view.q.trim().toLowerCase();
      if (q && String(ship.name || '').toLowerCase().indexOf(q) < 0) return false;
    }
    var tk = Object.keys(view.types);
    if (tk.length && !view.types[ship.type]) return false;
    var fk = Object.keys(view.factions);
    if (fk.length && !view.factions[ship.faction]) return false;
    return true;
  }

  var TYPE_ORDER = {};
  (root.FX_SHIP_TYPES || []).forEach(function (t, i) { TYPE_ORDER[t] = i; });

  function sortList(list, view, recentIndex) {
    var sort = view.sort, dir = view.desc ? -1 : 1;
    var byName = function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'zh'); };
    return list.slice().sort(function (a, b) {
      // 收藏永远置顶，其次是最近用过的
      var fa = a.fav ? 0 : 1, fb = b.fav ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (sort === 'recent' || recentIndex) {
        var ra = recentIndex && recentIndex[a.id] !== undefined ? recentIndex[a.id] : 9999;
        var rb = recentIndex && recentIndex[b.id] !== undefined ? recentIndex[b.id] : 9999;
        if (sort === 'name' && ra !== rb) return ra - rb;
        if (sort === 'recent') return ra - rb;
      }
      if (sort === 'type') {
        var ta = TYPE_ORDER[a.type] === undefined ? 99 : TYPE_ORDER[a.type];
        var tb = TYPE_ORDER[b.type] === undefined ? 99 : TYPE_ORDER[b.type];
        if (ta !== tb) return dir * (ta - tb);
        return byName(a, b);
      }
      if (sort === 'oil' || sort === 'speed') {
        var va = Number(a[sort]), vb = Number(b[sort]);
        if (isNaN(va)) va = -1;
        if (isNaN(vb)) vb = -1;
        if (va !== vb) return dir * (va - vb);   // dir=1 升序、dir=-1 降序
        return byName(a, b);
      }
      return dir * byName(a, b);
    });
  }

  /** 一行可多选的筛选 chip，末尾带一个「清空」。
   *  注意: 点击只重建结果列表、不重建 chip 自身，所以高亮类必须在这里就地更新，
   *  否则会出现"筛选项变了但按钮还是旧高亮"的脱节。 */
  function chipRow(options, selectedMap, onToggle, labelFn, title) {
    var wrap = h('div', { class: 'fx-filter-chips' });
    if (title) wrap.appendChild(h('span', { class: 'fx-filter-title', text: title }));
    var btns = [];
    options.forEach(function (o) {
      var b = h('button', {
        class: 'fx-fchip' + (selectedMap[o] ? ' on' : ''),
        title: '点击筛选/取消',
        text: labelFn ? labelFn(o) : o,
        onclick: function () {
          if (selectedMap[o]) delete selectedMap[o]; else selectedMap[o] = true;
          b.classList.toggle('on', !!selectedMap[o]);
          updateClearState();
          onToggle();
        }
      });
      btns.push(b);
      wrap.appendChild(b);
    });

    var clear = h('button', {
      class: 'fx-fchip fx-fchip-clear', text: '清空',
      title: '清除' + (title || '这一组') + '的所有筛选',
      onclick: function () {
        Object.keys(selectedMap).forEach(function (k) { delete selectedMap[k]; });
        btns.forEach(function (b) { b.classList.remove('on'); });
        updateClearState();
        onToggle();
      }
    });
    function updateClearState() {
      clear.classList.toggle('dis', Object.keys(selectedMap).length === 0);
    }
    updateClearState();
    wrap.appendChild(clear);
    return wrap;
  }

  function searchInput(value, onInput, placeholder) {
    return h('input', {
      class: 'fx-in fx-filter-q', type: 'search', value: value, placeholder: placeholder,
      oninput: function (e) { onInput(e.target.value); }
    });
  }

  function favStar(ship, onToggle) {
    return h('button', {
      class: 'fx-fav' + (ship.fav ? ' on' : ''), text: ship.fav ? '★' : '☆',
      title: '收藏（收藏的会置顶，并写进导出的 ships.js）',
      onclick: function (e) { e.stopPropagation(); onToggle(); }
    });
  }

  /* ================= 舰灵库 ================= */

  var libView = freshView();

  function libRowsHtml(state, onChange) {
    var shipMap = FX.store.shipMap();
    var recent = {};
    (state.recent || []).forEach(function (id, i) { recent[id] = i; });
    var list = state.ships.filter(function (s) { return matchesView(s, libView); });
    var sorted = sortList(list, libView, null);

    var tb = h('tbody', { id: 'fx-lib-body' });
    sorted.forEach(function (ship) {
      var tr = h('tr', {});
      tr.appendChild(h('td', { class: 'fx-td-fav' }, [favStar(ship, function () {
        FX.store.toggleFav(ship.id); onChange();
      })]));
      tr.appendChild(h('td', {}, [h('input', {
        class: 'fx-in fx-in-name', value: ship.name || '',
        oninput: function (e) { ship.name = e.target.value; onChange(true); }
      })]));
      tr.appendChild(h('td', {}, [select(root.FX_SHIP_TYPES || [], ship.type, function (v) {
        var wasAuto = new RegExp('^' + (ship.type || '') + '\\d+$').test(ship.name || '');
        ship.type = v;
        if (wasAuto || !ship.name) ship.name = FX.store.autoName(v);
        onChange();
      })]));
      tr.appendChild(h('td', {}, [select(root.FX_FACTION_LIST || [], ship.faction, function (v) {
        ship.faction = v; onChange();
      }, true, root.FX_FACTION_LABEL)]));
      ['oil', 'speed', 'scout'].forEach(function (field) {
        tr.appendChild(h('td', {}, [h('input', {
          class: 'fx-in fx-in-num', type: 'number', min: '0',
          value: (ship[field] === '' || ship[field] === undefined) ? '' : ship[field],
          oninput: function (e) {
            ship[field] = e.target.value === '' ? '' : Number(e.target.value);
            onChange(true);
          }
        })]));
      });
      tr.appendChild(h('td', {}, [h('button', {
        class: 'fx-btn fx-btn-danger', text: '×', title: '删除该舰灵（同时会从所有编队中移除）',
        onclick: function () {
          if (confirm('删除舰灵「' + ship.name + '」？会同时从所有编队里移除。')) {
            FX.store.removeShip(ship.id); onChange();
          }
        }
      })]));
      tb.appendChild(tr);
    });
    return { tb: tb, shown: sorted.length, total: state.ships.length };
  }

  function fillLibBody(host, state, onChange) {
    var body = host.querySelector('#fx-lib-body');
    if (!body) return;
    var res = libRowsHtml(state, onChange);
    body.parentNode.replaceChild(res.tb, body);
    var cnt = host.querySelector('#fx-lib-count');
    if (cnt) cnt.textContent = '显示 ' + res.shown + ' / 共 ' + res.total + ' 艘';
  }

  function renderLibrary(host, state, onChange) {
    host.innerHTML = '';

    var bar = h('div', { class: 'fx-row' }, [
      searchInput(libView.q, function (v) { libView.q = v; fillLibBody(host, state, onChange); }, '搜索舰名…'),
      h('span', { class: 'fx-muted', id: 'fx-lib-count' }),
      h('button', { class: 'fx-btn', text: '+ 添加舰灵', onclick: function () {
        FX.store.addShip({ type: (root.FX_SHIP_TYPES || [])[0] }); onChange();
      } })
    ]);
    var sortSel = h('select', { onchange: function (e) {
      var parts = e.target.value.split(':');
      libView.sort = parts[0]; libView.desc = parts[1] === 'desc';
      fillLibBody(host, state, onChange);
    } });
    [['name', 'asc', '舰名 A→Z'], ['type', 'asc', '按舰种'], ['oil', 'desc', '油耗 高→低'],
     ['oil', 'asc', '油耗 低→高'], ['speed', 'desc', '航速 高→低'], ['speed', 'asc', '航速 低→高'],
     ['recent', 'asc', '最近使用']].forEach(function (p) {
      var v = p[0] + ':' + p[1];
      var o = h('option', { value: v, text: p[2] });
      if (libView.sort === p[0] && libView.desc === (p[1] === 'desc')) o.selected = true;
      sortSel.appendChild(o);
    });
    bar.appendChild(sortSel);
    bar.appendChild(h('button', {
      class: 'fx-btn' + (libView.favOnly ? ' on' : ''), text: '只看收藏',
      onclick: function () { libView.favOnly = !libView.favOnly; renderLibrary(host, state, onChange); }
    }));
    host.appendChild(bar);

    host.appendChild(chipRow(root.FX_SHIP_TYPES || [], libView.types,
      function () { fillLibBody(host, state, onChange); }, null, '舰种'));
    host.appendChild(chipRow(root.FX_FACTION_LIST || [], libView.factions,
      function () { fillLibBody(host, state, onChange); }, root.FX_FACTION_LABEL, '国籍'));

    if (!state.ships.length) {
      host.appendChild(h('div', { class: 'fx-empty', text: '还没有舰灵。点「添加舰灵」开始录入，只有舰名/油耗/舰种/国籍是必填。' }));
      return;
    }

    var table = h('table', { class: 'fx-table' });
    table.appendChild(h('thead', {}, [h('tr', {}, ['', '舰名', '舰种', '国籍', '油耗', '航速', '索敌', ''].map(function (t) {
      return h('th', { text: t });
    }))]));
    var res = libRowsHtml(state, onChange);
    table.appendChild(res.tb);
    host.appendChild(table);
    var cnt = host.querySelector('#fx-lib-count');
    if (cnt) cnt.textContent = '显示 ' + res.shown + ' / 共 ' + res.total + ' 艘';
  }

  /* ================= 选船面板 ================= */

  /* picker.key 记 "编队id#队号"，换编队或换队自动关闭，避免状态串台 */
  var picker = { key: null, q: '', types: {}, factions: {}, favOnly: false, sort: 'name', desc: false };

  function pickerView() {
    return { q: picker.q, types: picker.types, factions: picker.factions, favOnly: picker.favOnly, sort: picker.sort, desc: picker.desc };
  }

  function pickerKey(fleet, teamIdx) { return fleet.id + '#' + teamIdx; }

  function fillPickerList(listEl, state, fleet, teamIdx, onChange) {
    if (!listEl) return;
    listEl.innerHTML = '';
    var shipMap = FX.store.shipMap();
    var usage = FX.store.usageOf(fleet);
    var recent = {};
    (state.recent || []).forEach(function (id, i) { recent[id] = i; });

    var list = state.ships.filter(function (s) { return matchesView(s, pickerView()); });
    var sorted = sortList(list, pickerView(), recent);

    if (!sorted.length) {
      listEl.appendChild(h('div', { class: 'fx-muted', text: '没有匹配的舰灵。' }));
      return;
    }
    sorted.forEach(function (s) {
      var owner = usage[s.id];
      var taken = owner !== undefined;
      var row = h('div', { class: 'fx-pick-row' + (taken ? ' taken' : '') }, [
        h('span', { class: 'fx-pick-name', text: s.name }),
        h('span', { class: 'fx-pick-meta', text: (s.type || '?') + ' · ' + (root.FX_FACTION_LABEL ? root.FX_FACTION_LABEL(s.faction) : (s.faction || '?')) }),
        h('span', { class: 'fx-pick-num', text: '油 ' + (s.oil === '' ? '?' : s.oil) }),
        h('span', { class: 'fx-pick-num', text: '速 ' + (s.speed === '' ? '?' : s.speed) }),
        s.fav ? h('span', { class: 'fx-pick-fav', text: '★' }) : null,
        taken ? h('span', { class: 'fx-pick-tag', text: '已在 ' + (owner + 1) + ' 队' }) : null
      ]);
      if (!taken) {
        row.title = '点击加入 ' + (teamIdx + 1) + ' 队';
        row.onclick = function () {
          if (FX.store.addShipToTeam(fleet, teamIdx, s.id)) {
            refreshTeamAndStats(fleet, state, onChange);
          }
        };
      }
      listEl.appendChild(row);
    });
  }

  function renderPicker(host, state, fleet, teamIdx, onChange) {
    var box = h('div', { class: 'fx-picker' });
    box.appendChild(h('div', { class: 'fx-row' }, [
      searchInput(picker.q, function (v) {
        picker.q = v;
        fillPickerList(box.querySelector('.fx-pick-list'), state, fleet, teamIdx, onChange);
      }, '搜索舰名…'),
      h('button', {
        class: 'fx-btn' + (picker.favOnly ? ' on' : ''), text: '只看收藏',
        onclick: function (e) {
          picker.favOnly = !picker.favOnly;
          e.target.className = 'fx-btn' + (picker.favOnly ? ' on' : '');
          fillPickerList(box.querySelector('.fx-pick-list'), state, fleet, teamIdx, onChange);
        }
      }),
      h('button', { class: 'fx-btn', text: '关闭', onclick: function () {
        picker.key = null; onChange();
      } })
    ]));
    box.appendChild(chipRow(root.FX_SHIP_TYPES || [], picker.types, function () {
      fillPickerList(box.querySelector('.fx-pick-list'), state, fleet, teamIdx, onChange);
    }, null, '舰种'));
    box.appendChild(chipRow(root.FX_FACTION_LIST || [], picker.factions, function () {
      fillPickerList(box.querySelector('.fx-pick-list'), state, fleet, teamIdx, onChange);
    }, root.FX_FACTION_LABEL, '国籍'));
    var listEl = h('div', { class: 'fx-pick-list', id: 'fx-pick-list' });
    box.appendChild(listEl);
    host.appendChild(box);
    fillPickerList(listEl, state, fleet, teamIdx, onChange);
  }

  /* ================= 队伍 chips / 统计条 ================= */

  function fillTeamChips(chipsEl, fleet, team, teamIdx, shipMap, usage, onChange) {
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    if (!team.ships.length) {
      chipsEl.appendChild(h('span', { class: 'fx-muted', text: '空 —— 至少 2 个舰灵' }));
      return;
    }
    team.ships.forEach(function (sid, si) {
      var s = shipMap[sid];
      if (!s) return;
      chipsEl.appendChild(h('span', { class: 'fx-chip' }, [
        si === 0 ? h('b', { class: 'fx-flag', text: '旗舰' }) : null,
        s.fav ? h('span', { class: 'fx-pick-fav', text: '★' }) : null,
        h('span', { text: s.name }),
        h('span', { class: 'fx-muted', text: ' ' + s.type + '·油' + (s.oil === '' ? '?' : s.oil) }),
        si > 0 ? h('button', {
          class: 'fx-chip-btn', text: '↑', title: '设为旗舰（移到首位）',
          onclick: function () { FX.store.setFlagship(fleet, teamIdx, sid); refreshTeamAndStats(fleet, S_ref, onChange); }
        }) : null,
        h('button', {
          class: 'fx-chip-btn', text: '×', title: '移出该队',
          onclick: function () { FX.store.removeShipFromTeam(fleet, teamIdx, sid); refreshTeamAndStats(fleet, S_ref, onChange); }
        })
      ]));
    });
  }

  /* refreshTeamAndStats 需要 state，由 renderFormation 记一份引用 */
  var S_ref = null;

  function fillStats(el, fleet, shipMap, routeConds) {
    if (!el) return;
    el.innerHTML = '';
    var ctx = FX.conditions.buildContext(fleet, shipMap);

    // 一行：舰灵数 / 各舰种 / 各阵营 / 均速 / 索敌
    var line = h('div', { class: 'fx-stats-line' });
    line.appendChild(h('b', { text: '两队合并 ' }));
    line.appendChild(h('span', { text: '舰灵 ' + ctx.shipCount }));
    Object.keys(ctx.typeCount).forEach(function (t) {
      line.appendChild(h('span', { text: '　' + t + ' ' + ctx.typeCount[t] }));
    });
    if (!Object.keys(ctx.typeCount).length) line.appendChild(h('span', { class: 'fx-muted', text: '　（还没有舰灵）' }));
    line.appendChild(h('span', { class: 'fx-stats-sep', text: '│' }));
    Object.keys(ctx.factionCount).forEach(function (f) {
      line.appendChild(h('span', { text: '　' + (root.FX_FACTION_LABEL ? root.FX_FACTION_LABEL(f) : f) + ' ' + ctx.factionCount[f] }));
    });
    line.appendChild(h('span', { class: 'fx-stats-sep', text: '│' }));
    line.appendChild(h('span', {
      text: '均速 ' + (ctx.avgSpeed === null ? '未知' : (Math.round(ctx.avgSpeed * 100) / 100))
    }));
    line.appendChild(h('span', { text: '　索敌 ' + (ctx.scout === null ? '未知' : ctx.scout) }));
    el.appendChild(line);

    // 当前路线条件对比
    var conds = (routeConds || []).map(function (c) { return (c.edge.cond || [])[0]; }).filter(Boolean);
    if (!conds.length) return;
    var info = FX.conditions.analyze(conds);
    var box = h('div', { class: 'fx-cond-live' });
    box.appendChild(h('div', { class: 'fx-sec-title', text: '当前路线条件（两队合并判定）' }));
    info.dims.forEach(function (d) {
      var v = FX.conditions.valueOfDim(d.dimKey, ctx);
      var verdict = FX.conditions.rangeVerdict(d.lo, d.hi, v);
      var need = d.lo === d.hi ? ('需 = ' + d.lo) : ('需 ' + d.lo + '~' + d.hi);
      var cls = verdict.state === 'pass' ? 'good' : (verdict.state === 'fail' ? 'bad' : 'unk');
      var right = verdict.state === 'unknown' ? '数据不足'
                : (verdict.state === 'pass' ? '✓ 达标'
                : '✗ ' + verdict.gap.dir + ' ' + verdict.gap.need);
      box.appendChild(h('div', { class: 'fx-cond-live-row ' + cls }, [
        h('span', { class: 'fx-cond-live-label', text: FX.conditions.dimLabel(d.dimKey) }),
        h('span', { class: 'fx-muted', text: need }),
        h('span', { text: '当前 ' + (v.known ? v.value : '?') }),
        h('span', { class: 'fx-cond-live-state', text: right })
      ]));
    });
    if (info.conflicts.length) {
      box.appendChild(h('div', { class: 'fx-warn', text: '⚠ 这些条件互相矛盾，同一条路上不可能同时满足' }));
    }
    el.appendChild(box);
  }

  /** 改了队伍后原地刷新 chips / 计数 / 统计 / 选船列表，并让主界面刷新油耗汇总。
   *  刻意不走整页重绘，否则搜索框会失去焦点。 */
  function refreshTeamAndStats(fleet, state, onChange) {
    var shipMap = FX.store.shipMap();
    var usage = FX.store.usageOf(fleet);
    (fleet.teams || []).forEach(function (team, ti) {
      fillTeamChips(doc.getElementById('fx-team-' + ti + '-chips'), fleet, team, ti, shipMap, usage, onChange);
      var c = doc.getElementById('fx-team-' + ti + '-count');
      if (c) c.textContent = team.ships.length + '/6';
      var w = doc.getElementById('fx-team-' + ti + '-warn');
      if (w) w.style.display = team.ships.length < 2 ? '' : 'none';
      var pickBtn = doc.getElementById('fx-team-' + ti + '-pick');
      if (pickBtn) pickBtn.disabled = team.ships.length >= 6;
    });
    fillStats(doc.getElementById('fx-stats'), fleet, shipMap, currentRouteConds);
    if (picker.key) {
      var ti = parseInt(picker.key.split('#')[1], 10);
      fillPickerList(doc.getElementById('fx-pick-list'), state, fleet, ti, onChange);
    }
    onChange(true);
  }

  var currentRouteConds = [];

  /* ================= 编队 ================= */

  function renderFormation(host, state, onChange, routeConds) {
    S_ref = state;
    currentRouteConds = routeConds || [];
    host.innerHTML = '';

    if (!state.fleets.length) {
      host.appendChild(h('div', { class: 'fx-empty', text: '还没有编队。' }));
      host.appendChild(h('button', { class: 'fx-btn fx-btn-primary', text: '+ 新建编队', onclick: function () {
        var f = FX.store.addFleet();
        state.selectedFleetId = f.id;
        onChange();
      } }));
      return;
    }

    var fleet = FX.store.currentFleet();
    if (!fleet) return;
    if (fleet.strongTeam !== 0 && fleet.strongTeam !== 1) fleet.strongTeam = 0;
    fleet.teams = fleet.teams || [{ ships: [] }, { ships: [] }];
    while (fleet.teams.length < 2) fleet.teams.push({ ships: [] });

    // 编队选择
    var bar = h('div', { class: 'fx-row' });
    var sel = h('select', { onchange: function (e) { state.selectedFleetId = e.target.value; picker.key = null; onChange(); } });
    state.fleets.forEach(function (f) {
      var o = h('option', { value: f.id, text: f.name });
      if (f.id === fleet.id) o.selected = true;
      sel.appendChild(o);
    });
    bar.appendChild(sel);
    bar.appendChild(h('button', { class: 'fx-btn', text: '+ 新建', onclick: function () {
      var f = FX.store.addFleet(); state.selectedFleetId = f.id; picker.key = null; onChange();
    } }));
    bar.appendChild(h('button', { class: 'fx-btn fx-btn-danger', text: '删除', onclick: function () {
      if (confirm('删除编队「' + fleet.name + '」？')) { FX.store.removeFleet(fleet.id); picker.key = null; onChange(); }
    } }));
    host.appendChild(bar);

    host.appendChild(h('div', { class: 'fx-row' }, [
      h('label', { class: 'fx-label', text: '编队名' }),
      h('input', { class: 'fx-in', value: fleet.name, oninput: function (e) { fleet.name = e.target.value; onChange(true); } })
    ]));

    var strongBox = h('div', { class: 'fx-row' }, [h('label', { class: 'fx-label', text: '强队' })]);
    [0, 1].forEach(function (i) {
      var id = 'strong' + i + '_' + fleet.id;
      strongBox.appendChild(h('label', { class: 'fx-radio', for: id }, [
        h('input', {
          type: 'radio', id: id, name: 'strong-' + fleet.id,
          checked: fleet.strongTeam === i ? 'checked' : null,
          onchange: function () { fleet.strongTeam = i; onChange(); }
        }),
        h('span', { text: (i + 1) + '队' })
      ]));
    });
    strongBox.appendChild(h('span', { class: 'fx-muted', text: '（自动分配时 boss 点强制强队出战）' }));
    host.appendChild(strongBox);

    // 统计条 + 条件实时对比
    var stats = h('div', { class: 'fx-stats', id: 'fx-stats' });
    host.appendChild(stats);

    // 两个队伍
    var shipMap = FX.store.shipMap();
    fleet.teams.forEach(function (team, ti) {
      team.ships = team.ships || [];
      var box = h('div', { class: 'fx-team' });
      box.appendChild(h('div', { class: 'fx-team-head' }, [
        h('span', { class: 'fx-team-title' + (fleet.strongTeam === ti ? ' is-strong' : ''),
                    text: (ti + 1) + '队' + (fleet.strongTeam === ti ? '（强）' : '') }),
        h('span', { class: 'fx-muted', text: '旗舰 = 列表第一位' }),
        h('span', { class: 'fx-muted', id: 'fx-team-' + ti + '-count', text: team.ships.length + '/6' })
      ]));
      box.appendChild(h('div', { class: 'fx-chips', id: 'fx-team-' + ti + '-chips' }));
      var actions = h('div', { class: 'fx-row' });
      var pickBtn = h('button', {
        class: 'fx-btn', id: 'fx-team-' + ti + '-pick',
        text: picker.key === pickerKey(fleet, ti) ? '选船面板已打开' : '+ 添加舰灵',
        onclick: function () {
          picker.key = (picker.key === pickerKey(fleet, ti)) ? null : pickerKey(fleet, ti);
          onChange();
        }
      });
      if (team.ships.length >= 6) pickBtn.disabled = true;
      actions.appendChild(pickBtn);
      box.appendChild(actions);
      var warn = h('div', { class: 'fx-warn', id: 'fx-team-' + ti + '-warn', text: '⚠ 每队至少 2 个舰灵' });
      if (team.ships.length >= 2) warn.style.display = 'none';
      box.appendChild(warn);
      host.appendChild(box);

      if (picker.key === pickerKey(fleet, ti)) {
        renderPicker(host, state, fleet, ti, onChange);
      }
    });

    host.appendChild(h('div', { class: 'fx-override' }, [
      h('div', { class: 'fx-muted', text: '手动指定（留空则按舰灵的航速/索敌自动算）' }),
      h('div', { class: 'fx-row' }, [
        h('label', { class: 'fx-label', text: '舰队均速值' }),
        h('input', {
          class: 'fx-in fx-in-num', type: 'number',
          value: fleet.avgSpeed === undefined ? '' : fleet.avgSpeed,
          oninput: function (e) { fleet.avgSpeed = e.target.value; onChange(true); }
        })
      ]),
      h('div', { class: 'fx-row' }, [
        h('label', { class: 'fx-label', text: '舰队索敌值' }),
        h('input', {
          class: 'fx-in fx-in-num', type: 'number',
          value: fleet.scout === undefined ? '' : fleet.scout,
          oninput: function (e) { fleet.scout = e.target.value; onChange(true); }
        })
      ])
    ]));

    // 初始填充
    var usage = FX.store.usageOf(fleet);
    fleet.teams.forEach(function (team, ti) {
      fillTeamChips(doc.getElementById('fx-team-' + ti + '-chips'), fleet, team, ti, shipMap, usage, onChange);
    });
    fillStats(stats, fleet, shipMap, currentRouteConds);
  }

  FX.fleetUi = {
    renderLibrary: renderLibrary, renderFormation: renderFormation, h: h,
    // 暴露给单测用（纯函数，不碰 DOM）
    _test: { freshView: freshView, matchesView: matchesView, sortList: sortList }
  };
})(typeof window !== 'undefined' ? window : globalThis);
