/* 状态持久化 + 导入导出
 *
 * 数据分两层:
 *   data/*.js  —— 仓库里的"真实文件"，是初始数据，也是你长期积累的存档
 *   localStorage —— 运行时的草稿，改动即时存，刷新不丢
 * 界面上改完，用「导出」把内容下载成 data/ships.js / data/fleets.js 覆盖回去。
 *
 * 之所以不直接写文件: 页面是 file:// 打开的，浏览器不允许网页写本地磁盘。
 * 导出成文件再覆盖是 file:// 下唯一可靠的做法（不需要起本地服务器）。
 */
(function (root) {
  'use strict';
  var FX = root.FX = root.FX || {};

  var KEY = 'fuxiao.plan.v1';
  var storageOK = true;

  function safeGet() {
    try { return JSON.parse(root.localStorage.getItem(KEY) || 'null'); }
    catch (e) { storageOK = false; return null; }
  }
  function safeSet(v) {
    try { root.localStorage.setItem(KEY, JSON.stringify(v)); return true; }
    catch (e) { storageOK = false; return false; }
  }

  var state = {
    ships: [],
    fleets: [],
    deletedShips: [],    // 墓碑：本机删掉的舰灵 id，防止被 data/ships.js 里的旧数据"复活"
    deletedFleets: [],
    selectedMapId: null,
    selectedFleetId: null,
    selectedRouteKey: null,
    assign: [],          // 当前路线的手动出战分配
    mode: 'x1',          // 'x1' | 'x3'
    mapMode: 'event',    // 'event' 限时活动 | 'archive' 档案（常驻）。只影响代币与掉落加成的展示
    objective: 'net',    // 自动分配目标: 'net'（省油）
    hideUnknown: false,
    visitedByMap: {},    // { 地图id: { 节点id: true } } 已通过（非灰）的战斗节点
    historyByMap: {},    // { 地图id: { manual: {nodes,at}|null, auto: {nodes,at}|null } } 路线历史，见下方
    recent: [],          // 最近编入过队伍的舰灵 id，最新的在前
    coverageOpts: {      // 覆盖规划选项
      allowRetreat: true,    // 允许中途撤退（则候选含所有路线前缀）
      includeBoss: true,     // 覆盖目标是否包含 BOSS 点
      objective: 'battles',  // 'battles' 最少总战数 | 'runs' 最少趟数
      useFleetFilter: true   // 用当前编队的带路条件过滤候选路线
    }
  };

  /* 按 id 合并两个列表。
   * 草稿优先（用户在本机改过的以草稿为准），文件里新增的补进来，
   * 草稿里删掉的用墓碑(deletedXxx)排除 —— 否则会被文件里的旧数据"复活"。
   * 这一条很重要：data/ships.js 是可以在外部批量生成的，
   * 如果直接拿草稿覆盖，外部新加的舰灵在界面上永远看不到。 */
  function mergeById(fileList, draftList, tombstones) {
    var dead = {};
    (tombstones || []).forEach(function (id) { dead[id] = true; });
    var out = [], have = {};
    (draftList || []).forEach(function (x) {
      if (!x || !x.id || dead[x.id]) return;
      out.push(x); have[x.id] = true;
    });
    (fileList || []).forEach(function (x) {
      if (!x || !x.id || dead[x.id] || have[x.id]) return;
      out.push(x); have[x.id] = true;
    });
    return out;
  }

  function init() {
    var fileShips = (root.FX_SHIPS || []).slice();
    var fileFleets = (root.FX_FLEETS || []).slice();
    var saved = safeGet();
    if (saved && Array.isArray(saved.ships) && Array.isArray(saved.fleets)) {
      state.deletedShips = saved.deletedShips || [];
      state.deletedFleets = saved.deletedFleets || [];
      state.ships = mergeById(fileShips, saved.ships, state.deletedShips);
      state.fleets = mergeById(fileFleets, saved.fleets, state.deletedFleets);
      state.selectedMapId = saved.selectedMapId || null;
      state.selectedFleetId = saved.selectedFleetId || null;
      state.selectedRouteKey = saved.selectedRouteKey || null;
      state.assign = saved.assign || [];
      state.mode = saved.mode || 'x1';
      state.mapMode = saved.mapMode === 'archive' ? 'archive' : 'event';
      state.objective = saved.objective || 'net';
      state.hideUnknown = !!saved.hideUnknown;
      state.visitedByMap = saved.visitedByMap || {};
      state.historyByMap = saved.historyByMap || {};
      state.recent = saved.recent || [];
      if (saved.coverageOpts) Object.assign(state.coverageOpts, saved.coverageOpts);
    } else {
      state.ships = fileShips;
      state.fleets = fileFleets;
      save();
    }
    migrateFactionNames();
    // 修掉历史草稿里可能存在的跨队重复编入
    state.fleets.forEach(function (f) { dedupeFleet(f); });
    return state;
  }

  /* 早期版本把「凤棲」误读成「凤栖」，已存进草稿的舰灵要跟着改，
   * 否则阵营下拉框会匹配不上。 */
  var FACTION_RENAMES = { '凤栖': '凤棲' };
  function migrateFactionNames() {
    var n = 0;
    state.ships.forEach(function (s) {
      if (FACTION_RENAMES[s.faction]) { s.faction = FACTION_RENAMES[s.faction]; n++; }
    });
    if (n) save();
    return n;
  }

  function save() { safeSet(state); }

  function isStorageOK() { return storageOK; }

  /* ---------- 舰灵 ---------- */
  var seq = 1;
  function newId(prefix) {
    return prefix + Date.now().toString(36) + (seq++).toString(36);
  }

  /** 未填舰名时自动命名: {舰种}{序号}，取最小可用序号 */
  function autoName(type) {
    var used = {};
    state.ships.forEach(function (s) { used[s.name] = true; });
    for (var i = 1; i < 1000; i++) {
      var n = (type || '舰灵') + i;
      if (!used[n]) return n;
    }
    return (type || '舰灵') + 'X';
  }

  function addShip(patch) {
    var ship = {
      id: newId('s'),
      name: '', oil: '', type: (root.FX_SHIP_TYPES || [])[0] || '', faction: '',
      speed: '', scout: ''
    };
    Object.assign(ship, patch || {});
    if (!ship.name) ship.name = autoName(ship.type);
    state.ships.push(ship);
    save();
    return ship;
  }
  function removeShip(id) {
    state.ships = state.ships.filter(function (s) { return s.id !== id; });
    if (state.deletedShips.indexOf(id) < 0) state.deletedShips.push(id);
    state.fleets.forEach(function (f) {
      f.teams.forEach(function (t) { t.ships = t.ships.filter(function (x) { return x !== id; }); });
    });
    save();
  }
  function shipMap() {
    var m = {};
    state.ships.forEach(function (s) { m[s.id] = s; });
    return m;
  }

  /* ---------- 编队 ---------- */
  function addFleet(name) {
    var f = {
      id: newId('f'),
      name: name || ('编队' + (state.fleets.length + 1)),
      strongTeam: 0,
      teams: [{ ships: [] }, { ships: [] }],
      avgSpeed: '', scout: ''
    };
    state.fleets.push(f);
    save();
    return f;
  }
  function removeFleet(id) {
    state.fleets = state.fleets.filter(function (f) { return f.id !== id; });
    if (state.deletedFleets.indexOf(id) < 0) state.deletedFleets.push(id);
    if (state.selectedFleetId === id) state.selectedFleetId = null;
    save();
  }
  function currentFleet() {
    if (!state.fleets.length) return null;
    var f = state.fleets.filter(function (x) { return x.id === state.selectedFleetId; })[0];
    return f || state.fleets[0];
  }

  /* ---------- 编队：舰灵占用与增删 ----------
   * 规则：同一艘船不能编入两个队伍（否则"两队合并"的舰种/阵营计数会重复，
   * 带路条件判定和油耗都会悄悄算错）。所以增删都走这里，集中守住这条不变量。 */

  /** 编队里每艘船被哪个队伍占用 -> { shipId: teamIndex }（重复时取首次出现的队伍） */
  function usageOf(fleet) {
    var m = {};
    ((fleet && fleet.teams) || []).forEach(function (t, ti) {
      ((t && t.ships) || []).forEach(function (id) {
        if (m[id] === undefined) m[id] = ti;
      });
    });
    return m;
  }

  /** 去掉跨队重复（保留首次出现），返回被移除的 id。纯函数，不落盘。 */
  function dedupeFleet(fleet) {
    var seen = {}, removed = [];
    ((fleet && fleet.teams) || []).forEach(function (t) {
      if (!t) return;
      t.ships = ((t.ships) || []).filter(function (id) {
        if (seen[id]) { removed.push(id); return false; }
        seen[id] = true; return true;
      });
    });
    return removed;
  }

  function addShipToTeam(fleet, teamIdx, shipId) {
    var team = fleet && fleet.teams && fleet.teams[teamIdx];
    if (!team) return false;
    if (team.ships.indexOf(shipId) >= 0) return false;
    if (usageOf(fleet)[shipId] !== undefined) return false;   // 已在另一个队伍
    if (team.ships.length >= 6) return false;
    team.ships.push(shipId);
    touchRecent(shipId);
    save();
    return true;
  }

  function removeShipFromTeam(fleet, teamIdx, shipId) {
    var team = fleet && fleet.teams && fleet.teams[teamIdx];
    if (!team) return;
    team.ships = team.ships.filter(function (x) { return x !== shipId; });
    save();
  }

  /** 一键清空**某一个队伍**：该队舰灵全下，**另一队和编队本身（名字、强队设置）都不动**。
   *  返回被清掉的舰灵数；界面用它决定按钮是否可点。 */
  function clearTeam(fleet, teamIdx) {
    var team = fleet && fleet.teams && fleet.teams[teamIdx];
    if (!team || !team.ships || !team.ships.length) return 0;
    var n = team.ships.length;
    team.ships = [];
    save();
    return n;
  }

  /** 把某艘船移到队首 —— 队首即旗舰 */
  function setFlagship(fleet, teamIdx, shipId) {
    var team = fleet && fleet.teams && fleet.teams[teamIdx];
    if (!team) return;
    var i = team.ships.indexOf(shipId);
    if (i <= 0) return;
    team.ships.splice(i, 1);
    team.ships.unshift(shipId);
    save();
  }

  /* ---------- 收藏 / 最近使用 ---------- */
  function toggleFav(shipId) {
    var s = state.ships.filter(function (x) { return x.id === shipId; })[0];
    if (!s) return;
    if (s.fav) delete s.fav; else s.fav = true;
    save();
  }

  function touchRecent(shipId) {
    state.recent = [shipId].concat(state.recent.filter(function (x) { return x !== shipId; })).slice(0, 30);
  }

  /* ---------- 已通过（非灰）节点 ---------- */
  function visitedOf(mapId) {
    if (!state.visitedByMap[mapId]) state.visitedByMap[mapId] = {};
    return state.visitedByMap[mapId];
  }
  function isVisited(mapId, nodeId) { return !!visitedOf(mapId)[nodeId]; }
  function setVisited(mapId, nodeId, v) {
    var m = visitedOf(mapId);
    if (v) m[nodeId] = true; else delete m[nodeId];
    save();
  }
  function toggleVisited(mapId, nodeId) {
    setVisited(mapId, nodeId, !isVisited(mapId, nodeId));
  }
  function setVisitedBulk(mapId, nodeIds, v) {
    var m = visitedOf(mapId);
    nodeIds.forEach(function (id) { if (v) m[id] = true; else delete m[id]; });
    save();
  }

  /* ---------- 路线历史（只存本地，按地图隔离） ----------
   * 两种来源分开记，**每种只保留最新的一条**:
   *   manual —— 用户在地图上一个一个节点点出来的路线
   *   auto   —— 用户直接点程序配好的路线（路线对比 / 覆盖规划里点行）
   * 按地图 id 分开存，换地图互不影响；全部落在同一个 localStorage 草稿里，
   * 不联网、不上传（这个项目本来就没有任何网络请求）。
   */

  /** 取某张地图的历史槽；没有就建一个空的 */
  function historyOf(mapId) {
    var h = state.historyByMap[mapId];
    if (!h) h = state.historyByMap[mapId] = { manual: null, auto: null };
    return h;
  }

  /** 记一条历史。kind 为 'manual' | 'auto'。
   *  只有起点一个节点的不算"路线"（例如「清空路线」之后），直接忽略，
   *  这样误点清空/撤回到底不会把之前辛苦点出来的路线冲掉。 */
  function recordHistory(mapId, kind, nodes) {
    if (kind !== 'manual' && kind !== 'auto') return null;
    if (!mapId || !nodes || nodes.length < 2) return null;
    var h = historyOf(mapId);
    h[kind] = { nodes: nodes.slice(), at: Date.now() };
    save();
    return h[kind];
  }

  /** 删掉某张地图的某一种历史 */
  function deleteHistory(mapId, kind) {
    var h = state.historyByMap[mapId];
    if (!h || !h[kind]) return false;
    h[kind] = null;
    if (!h.manual && !h.auto) delete state.historyByMap[mapId];
    save();
    return true;
  }

  /** 清空某张地图的全部历史 */
  function clearHistory(mapId) {
    if (!state.historyByMap[mapId]) return false;
    delete state.historyByMap[mapId];
    save();
    return true;
  }

  /**
   * 管理界面用的列表: [{ mapId, manual, auto, latest }]，**按 latest 从老到新**。
   * latest 取手动/自动里较新的那个时间 —— 只用来排序；
   * 两条各自的记录时间都留在 manual.at / auto.at 里，界面要分别标出来。
   */
  function historyList() {
    var out = [];
    Object.keys(state.historyByMap).forEach(function (id) {
      var h = state.historyByMap[id];
      if (!h || (!h.manual && !h.auto)) return;
      var latest = Math.max(h.manual ? h.manual.at : 0, h.auto ? h.auto.at : 0);
      out.push({ mapId: id, manual: h.manual || null, auto: h.auto || null, latest: latest });
    });
    out.sort(function (a, b) { return a.latest - b.latest; });
    return out;
  }

  /* ---------- 导入导出 ---------- */
  /** 在一个假的 window 上执行数据文件，取出要的全局变量 */
  function parseDataFile(text, varName) {
    var w = {};
    /* eslint-disable no-new-func */
    new Function('window', text)(w);
    if (!w[varName]) throw new Error('文件里没找到 ' + varName);
    return w[varName];
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function header(kind) {
    return '/* 由 拂晓活动地图规划器 导出 —— ' + new Date().toLocaleString() + '\n' +
           ' * 直接用本文件覆盖 data/' + kind + '.js 即可。\n' +
           ' * 注意: 手动写的注释不会保留。\n */\n';
  }

  function exportShips() {
    download('ships.js', header('ships') + 'window.FX_SHIPS = ' + JSON.stringify(state.ships, null, 2) + ';\n');
  }
  function exportFleets() {
    download('fleets.js', header('fleets') + 'window.FX_FLEETS = ' + JSON.stringify(state.fleets, null, 2) + ';\n');
  }

  FX.store = {
    state: state,
    init: init, save: save, isStorageOK: isStorageOK,
    newId: newId, autoName: autoName,
    addShip: addShip, removeShip: removeShip, shipMap: shipMap,
    addFleet: addFleet, removeFleet: removeFleet, currentFleet: currentFleet,
    usageOf: usageOf, dedupeFleet: dedupeFleet, mergeById: mergeById,
    addShipToTeam: addShipToTeam, removeShipFromTeam: removeShipFromTeam, setFlagship: setFlagship,
    clearTeam: clearTeam,
    toggleFav: toggleFav, touchRecent: touchRecent,
    visitedOf: visitedOf, isVisited: isVisited, setVisited: setVisited,
    toggleVisited: toggleVisited, setVisitedBulk: setVisitedBulk,
    historyOf: historyOf, recordHistory: recordHistory, deleteHistory: deleteHistory,
    clearHistory: clearHistory, historyList: historyList,
    parseDataFile: parseDataFile, download: download,
    exportShips: exportShips, exportFleets: exportFleets
  };
})(typeof window !== 'undefined' ? window : globalThis);
