/* 核心逻辑测试: 条件求值 / 冲突检测 / 图枚举 / 油耗弹药计算
 * 用法: node tools/test_core.js
 */
const path = require('path');
const cond = require(path.join(__dirname, '..', 'app', 'conditions.js'));
const graph = require(path.join(__dirname, '..', 'app', 'graph.js'));
const oil = require(path.join(__dirname, '..', 'app', 'oil.js'));

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
}

// ---------- 1. 条件求值 ----------
console.log('\n[1] 条件求值（两队合并 / 旗舰计数）');
const ships = {
  s1: { id: 's1', name: 'Z2',   oil: 8,  type: '驱逐', faction: '奥鲁加', speed: 38, scout: 20 },
  s2: { id: 's2', name: 'Z3',   oil: 9,  type: '驱逐', faction: '奥鲁加', speed: 36, scout: 22 },
  s3: { id: 's3', name: '俾斯麦', oil: 20, type: '战列', faction: '奥鲁加', speed: 30, scout: 40 },
  s4: { id: 's4', name: '企业',  oil: 18, type: '航母', faction: '尤奈特', speed: 33, scout: 60 },
  s5: { id: 's5', name: '列克星敦', oil: 18, type: '航母', faction: '尤奈特', speed: 33, scout: 58 }
};
// 1队旗舰=战列(俾斯麦)，2队旗舰=航母(企业)
const formation = {
  strongTeam: 0,
  teams: [{ ships: ['s3', 's1', 's2'] }, { ships: ['s4', 's5'] }]
};
const ctx = cond.buildContext(formation, ships);
eq(ctx.shipCount, 5, '两队合计舰灵数 = 5');
eq(ctx.flagshipCount, 2, '旗舰数 = 2');
eq(ctx.typeCount['驱逐'], 2, '驱逐合计 = 2');
eq(ctx.typeCount['航母'], 2, '航母合计 = 2');
eq(ctx.factionCount['奥鲁加'], 3, '奥鲁加合计 = 3');
eq(ctx.flagshipTypeCount['战列'], 1, '旗舰中战列 = 1（只有1队旗舰是战列）');
eq(ctx.flagshipTypeCount['航母'], 1, '旗舰中航母 = 1');

const C = (scope, kind, key, op, n) => ({ scope, kind, key, op, n });
eq(cond.evaluate(C('旗舰', '舰种', '战列', '<', 2), ctx), 'pass',  'A->B 条件「旗舰为 战列<2」应满足');
eq(cond.evaluate(C('旗舰', '舰种', '战列', '=', 2), ctx), 'fail',  'A->C 条件「旗舰为 战列=2」应不满足');
eq(cond.evaluate(C('舰队', '舰种', '航母', '>=', 3), ctx), 'fail', 'D->I 条件「航母≥3」应不满足');
eq(cond.evaluate(C('舰队', '舰种', '航母', '<', 3), ctx),  'pass', 'D->F 条件「航母<3」应满足');
eq(cond.evaluate(C('舰队', '阵营', '奥鲁加', '<', 4), ctx), 'pass', 'B->E 条件「奥鲁加<4」应满足');
eq(cond.evaluate(C('舰队', '阵营', '奥鲁加', '>=', 4), ctx), 'fail', 'B->D 条件「奥鲁加≥4」应不满足');
eq(cond.evaluate(C('舰队', '舰灵数', null, '>=', 10), ctx), 'fail', 'L->P 条件「舰灵数≥10」应不满足');

// 均速 = (30+38+36+33+33)/5 = 34
eq(Math.round(ctx.avgSpeed * 100) / 100, 34, '舰队均速值 = 34');
eq(ctx.scout, 200, '舰队索敌值 = 20+22+40+60+58 = 200');
eq(cond.evaluate(C('舰队', '均速', null, '<', 34), ctx), 'fail', 'C->D 条件「均速<34」在均速=34时应不满足');
eq(cond.evaluate(C('舰队', '均速', null, '>=', 34), ctx), 'pass', 'C->G 条件「均速≥34」应满足');

// 缺 speed 时应判为 unknown 而不是 fail
const partial = cond.buildContext({ teams: [{ ships: ['s1'] }, { ships: ['s3'] }] },
                                  { s1: ships.s1, s3: { id: 's3', oil: 20, type: '战列', faction: '奥鲁加' } });
eq(partial.avgSpeed, null, '有舰灵未录航速时均速为未知');
eq(cond.evaluate(C('舰队', '均速', null, '<', 34), partial), 'unknown', '均速条件在数据缺失时应判 unknown');
// 手动覆盖优先
const overridden = cond.buildContext({ teams: [{ ships: ['s1'] }], avgSpeed: 30, scout: 900 }, ships);
eq(overridden.avgSpeed, 30, '手动指定的均速覆盖自动计算');
eq(cond.evaluate(C('舰队', '索敌', null, '>=', 800), overridden), 'pass', '手动索敌 900 满足「索敌≥800」');

// ---------- 2. 冲突检测 ----------
console.log('\n[2] 条件冲突检测');
const ok = cond.analyze([C('舰队', '舰种', '航母', '<', 3), C('舰队', '舰种', '重巡', '<', 3), C('舰队', '舰种', '驱逐', '>=', 4)]);
eq(ok.conflicts.length, 0, '互不相干的条件不报冲突');
const bad = cond.analyze([C('舰队', '舰种', '航母', '<', 3), C('舰队', '舰种', '航母', '>=', 3)]);
eq(bad.conflicts.length, 1, '互斥分段（航母<3 与 航母≥3）应报冲突');
const tighten = cond.analyze([C('舰队', '舰种', '航母', '<', 5), C('舰队', '舰种', '航母', '>=', 3)]);
eq(tighten.dims[0].lo, 3, '可兼容的收紧: 下界取 max = 3');
eq(tighten.dims[0].hi, 4, '可兼容的收紧: 上界取 min = 4');
eq(tighten.conflicts.length, 0, '可兼容的收紧不算冲突');

// ---------- 3. 油耗公式（对齐你给的例子）----------
console.log('\n[3] 油耗公式核对');
const tinyMap = {
  start: 'S0',
  nodes: {
    S0: { label: '起点', type: 'start', next: [{ to: 'B1', prob: '大', raw: '无条件', cond: [] }] },
    B1: { label: 'B1', type: 'battle', next: [{ to: 'R1', prob: '大', raw: '无条件', cond: [] }] },
    R1: { label: 'R1', type: 'supply', next: [] }   // 故意让它成为终点，便于隔离出"一战一油点"
  }
};
const tinyShips = { a: { id: 'a', oil: 55, type: '战列', faction: '奥鲁加' } };
const tinyForm = { strongTeam: 0, teams: [{ ships: ['a'] }, { ships: [] }] };
const tAnalysis = graph.analyzeRoute(tinyMap, ['S0', 'B1', 'R1']);
eq(tAnalysis.battles, ['B1'], '隔离场景: 1 场战斗');
eq(tAnalysis.oilPoints.length, 1, '隔离场景: 1 个油点');
eq(tAnalysis.oilPoints[0].afterBattle, 1, '油点在第 1 战之后');
eq(tAnalysis.oilPoints[0].basisNode, 'B1', '返油基数是 B1 的出战队伍');

const x1 = oil.compute(tAnalysis, tinyForm, tinyShips, [0], 'x1');
eq(x1.gross, 55, '一倍毛耗 = 55');
eq(x1.refund, 27, '一倍返油 = ⌊55/2⌋ = 27');
eq(x1.net, 28, '一倍净耗 = 28');

const x3 = oil.compute(tAnalysis, tinyForm, tinyShips, [0], 'x3');
eq(x3.gross, 165, '三倍毛耗 = 55×3 = 165');
eq(x3.refund, 82, '三倍返油 = ⌊165/2⌋ = 82（不是 27×3=81）');
eq(x3.net, 83, '三倍净耗 = 83');
eq(x3.ammo, [1, 0], '三倍模式的弹药消耗与一倍相同（1 发）');

// ---------- 4. 每队 5 战上限 + boss 强制强队 ----------
console.log('\n[4] 自动分配约束');
const longMap = { start: 'S0', nodes: { S0: { label: '起点', type: 'start', next: [] } } };
let prev = 'S0';
for (let i = 1; i <= 11; i++) {
  const id = 'B' + i;
  longMap.nodes[prev].next = [{ to: id, prob: '大', raw: '无条件', cond: [] }];
  longMap.nodes[id] = { label: id, type: i === 11 ? 'boss' : 'battle', next: [] };
  prev = id;
}
const longNodes = ['S0'].concat(Array.from({ length: 11 }, (_, i) => 'B' + (i + 1)));
const longA = graph.analyzeRoute(longMap, longNodes);
const r11 = oil.autoAssign(longA, tinyForm, tinyShips, 'x1');
eq(r11.ok, false, '11 场战斗超过两队上限（10），应判定走不通');

// 7 场，其中最后是 boss -> 强队必须打 boss，且两队各 ≤5
const midNodes = ['S0'].concat(Array.from({ length: 7 }, (_, i) => 'B' + (i + 1)));
const midMap = JSON.parse(JSON.stringify(longMap));
midMap.nodes['B7'].type = 'boss';
for (let i = 8; i <= 11; i++) delete midMap.nodes['B' + i];
midMap.nodes['B7'].next = [];
const midA = graph.analyzeRoute(midMap, midNodes);
const twoShips = { a: { id: 'a', oil: 10, type: '战列', faction: '奥鲁加' }, b: { id: 'b', oil: 6, type: '驱逐', faction: '奥鲁加' } };
const twoForm = { strongTeam: 1, teams: [{ ships: ['b'] }, { ships: ['a'] }] };  // 2队(油耗10)是强队
const r7 = oil.autoAssign(midA, twoForm, twoShips, 'x1');
eq(r7.ok, true, '7 场战斗可以分配');
eq(r7.result.assign[6], 1, 'boss 点(B7)必须由强队(索引1)出战');
eq(r7.result.ammo[0] + r7.result.ammo[1], 7, '弹药合计 = 战斗数');
eq(r7.result.ammo[0] <= 5 && r7.result.ammo[1] <= 5, true, '每队弹药不超过 5');
// 强队每战 10，弱队每战 6；7 场里 1 场必须强队，其余 6 场尽量给弱队但弱队上限 5
// => 弱队 5 场(30) + 强队 2 场(20) = 50
eq(r7.result.net, 50, '最省油分配: 弱队打 5 场、强队打 2 场 = 50');

// ---------- 5. 真实地图全路线 ----------
console.log('\n[5] 真实地图（博览会的奇妙相遇/地狱EX）');
global.window = {};
require(path.join(__dirname, '..', 'data', 'maps', 'index.js'));
for (const f of global.window.FX_MAP_FILES) require(path.join(__dirname, '..', 'data', 'maps', f));
const map = global.window.FX_MAPS[0];
const routes = graph.enumerateRoutes(map);
const terminals = {};
routes.forEach(r => { const t = r[r.length - 1]; terminals[t] = (terminals[t] || 0) + 1; });
eq(routes.length, 23, '共 23 条路线');
eq(Object.keys(terminals).sort(), ['O', 'Q', 'S'], '终点只有 O / Q / S');
eq(terminals, { O: 7, Q: 7, S: 9 }, '各终点路线数 O=7 Q=7 S=9');

let withOil = 0, maxBattles = 0;
routes.forEach(r => {
  const a = graph.analyzeRoute(map, r);
  if (a.oilPoints.length) withOil++;
  if (a.battles.length > maxBattles) maxBattles = a.battles.length;
});
eq(withOil, 6, '含油点的路线 6 条');
eq(maxBattles, 9, '最长路线 9 战');

// 用一套编队跑通全部路线，确认自动分配都成立
const realShips = ships;
const realForm = { strongTeam: 0, teams: [{ ships: ['s3', 's1', 's2'] }, { ships: ['s4', 's5'] }] };
let allOk = true, reason = '';
routes.forEach(r => {
  const a = graph.analyzeRoute(map, r);
  const res = oil.autoAssign(a, realForm, realShips, 'x1');
  if (!res.ok) { allOk = false; reason = r.join('>') + ': ' + res.reason; }
});
eq(allOk, true, '全部 23 条路线都能给出合法出战分配' + (allOk ? '' : ' (' + reason + ')'));

// ---------- 6. 阵营表 ----------
console.log('\n[6] 阵营表 / 舰种枚举');
require(path.join(__dirname, '..', 'data', 'factions.js'));
require(path.join(__dirname, '..', 'data', 'shiptypes.js'));
const F = global.window.FX_FACTIONS;
const L = global.window.FX_FACTION_LABEL;
const A = global.window.FX_ANNOTATE_FACTIONS;

eq(!!F['凤棲'], true, '阵营名是「凤棲」（木+妻），不是「凤栖」');
eq(F['凤栖'], undefined, '不存在误读成「凤栖」的键');
eq(L('奥鲁加'), '奥鲁加（德）', '显示名带国家后缀：奥鲁加（德）');
eq(L('无阵营'), '无阵营', '无阵营不加后缀');
eq(L('伽纳伊'), '伽纳伊（?）', '国家未知显示为 伽纳伊（?）');
eq(L('不存在的东西'), '不存在的东西', '未知阵营原样返回');
eq(A('舰队中<奥鲁加>数量≥4'), '舰队中<奥鲁加（德）>数量≥4', '条件原文里的阵营被标注上国家');
eq(A('旗舰为 战列<2'), '旗舰为 战列<2', '不含阵营的条件原文不被改动');

// 地图里出现的阵营必须都在阵营表里 —— 这条能直接抓住"阵营名写错/写漏"这类问题
const usedFactions = new Set();
Object.values(map.nodes).forEach(n => (n.next || []).forEach(e => (e.cond || []).forEach(c => {
  if (c.kind === '阵营' && c.key) usedFactions.add(c.key);
})));
const unknownFactions = Array.from(usedFactions).filter(k => !F[k]);
eq(unknownFactions, [], '地图条件引用的阵营都在阵营表里（实测引用: ' + Array.from(usedFactions).join('/') + '）');

// ---------- 7. 覆盖规划 ----------
console.log('\n[7] 覆盖规划');
const coverage = require(path.join(__dirname, '..', 'app', 'coverage.js'));
const allBattle = Object.keys(map.nodes).filter(id => graph.isBattle(map.nodes[id]));
eq(allBattle.length, 18, '战斗节点共 18 个（15 普通 + 3 BOSS）');

const solAll = coverage.solve(map, graph, allBattle, { allowRetreat: true });
eq(solAll.ok, true, '全灰地图可解');
eq(solAll.runCount, 4, '最少 4 趟');
eq(solAll.totalBattles, 25, '允许撤退时最少 25 战');
const covered = new Set();
solAll.runs.forEach(r => r.battleSet.forEach(id => covered.add(id)));
eq(allBattle.filter(id => !covered.has(id)), [], '方案确实覆盖了全部战斗节点');

const solNoRetreat = coverage.solve(map, graph, allBattle, { allowRetreat: false });
eq(solNoRetreat.totalBattles, 28, '不允许撤退时最少 28 战');
eq(solNoRetreat.totalBattles >= solAll.totalBattles, true, '允许撤退不会算出更差的解');

const solRuns = coverage.solve(map, graph, allBattle, { allowRetreat: true, objective: 'runs' });
eq(solRuns.runCount <= solAll.runCount, true, '「最少趟数」模式的趟数不超过「最少战数」模式');

const doneSet = ['A', 'B', 'E', 'H', 'L', 'P'];
const rest = allBattle.filter(id => !doneSet.includes(id));
const solMid = coverage.solve(map, graph, rest, { allowRetreat: true });
eq(solMid.runCount, 3, 'A/B/E/H/L/P 已通过时最少 3 趟');
eq(solMid.totalBattles, 21, 'A/B/E/H/L/P 已通过时最少 21 战');

eq(coverage.solve(map, graph, [], {}).empty, true, '没有目标节点时返回空方案');

const solFiltered = coverage.solve(map, graph, allBattle, { allowRetreat: true, filter: () => false });
eq(solFiltered.ok, false, '所有路线都被过滤掉时应判无解');
eq(solFiltered.uncovered.length, 18, '无解时列出全部未覆盖节点，而不是只丢一句无解');

const px = (n, c) => Array.from({ length: n }, () => c);
eq(coverage.classifyNodePixels({ type: 'battle' }, px(10, { r: 132, g: 240, b: 252 })), 'visited', '青蓝像素 → 战斗点已通过');
eq(coverage.classifyNodePixels({ type: 'battle' }, px(10, { r: 192, g: 192, b: 192 })), 'unvisited', '灰白像素 → 未通过');
eq(coverage.classifyNodePixels({ type: 'boss' }, px(10, { r: 216, g: 48, b: 72 })), 'visited', '红色像素 → BOSS 已通过');
eq(coverage.classifyNodePixels({ type: 'supply' }, px(10, { r: 180, g: 252, b: 144 })), 'visited', '亮绿像素 → 补给点已通过');

/* 用真实游戏截图采样出来的像素回归测试分类器。
 * 夹具由 app/coverage.js 的 samplePixels 对 shots/_sample_map.png 采样生成，
 * 那张图上 A/B/E/H/L/P 是青蓝、S 是红骷髅、其余灰白。
 * 游戏改配色时这条会先炸 —— 那时需要重新校准 classifyNodePixels 的阈值。 */
const fixture = require(path.join(__dirname, 'fixtures', 'node-icon-samples.json'));
const classified = {};
Object.keys(fixture.samples).forEach(id => {
  const a = fixture.samples[id];
  const arr = [];
  for (let i = 0; i < a.length; i += 3) arr.push({ r: a[i], g: a[i + 1], b: a[i + 2] });
  classified[id] = coverage.classifyNodePixels(map.nodes[id], arr);
});
eq(Object.keys(classified).filter(id => !classified[id]), [], '真实截图里没有无法判定的节点');
eq(Object.keys(classified).filter(id => classified[id] === 'visited').sort(),
   fixture.expectedVisited.slice().sort(),
   '真实截图的已通过判定与预期一致（A B E H L P 是青蓝六边形、S 是红骷髅）');
eq(coverage.solve(map, graph, allBattle.filter(id => fixture.expectedVisited.indexOf(id) < 0), { allowRetreat: true }).totalBattles,
   20, '按截图识别出的当前进度，还需 3 趟共 20 战');

// ---------- 8. 编队占用 / 重复编入 / 维度取值 ----------
console.log('\n[8] 编队占用与重复编入');
require(path.join(__dirname, '..', 'app', 'store.js'));
const store = global.window.FX.store;

const fleetA = { id: 'f1', teams: [{ ships: ['a', 'b'] }, { ships: ['c'] }] };
eq(store.usageOf(fleetA), { a: 0, b: 0, c: 1 }, 'usageOf 标出每艘船被哪个队伍占用');

const dupFleet = { id: 'f2', teams: [{ ships: ['a', 'b'] }, { ships: ['b', 'c'] }] };
eq(store.dedupeFleet(dupFleet), ['b'], 'dedupeFleet 找出跨队重复的 b 并返回');
eq(dupFleet.teams[0].ships, ['a', 'b'], '先出现的那份保留');
eq(dupFleet.teams[1].ships, ['c'], '后出现的那份被移除');

const f3 = { id: 'f3', teams: [{ ships: ['a'] }, { ships: [] }] };
eq(store.addShipToTeam(f3, 1, 'a'), false, '同一艘船不能编入第二个队伍');
eq(store.addShipToTeam(f3, 1, 'z'), true, '未被占用的船可以加入');
eq(f3.teams[1].ships, ['z'], '确实加进了目标队伍');
eq(store.addShipToTeam(f3, 1, 'z'), false, '同一队内也不能重复加入');

const f4 = { id: 'f4', teams: [{ ships: ['1', '2', '3', '4', '5', '6'] }, { ships: [] }] };
eq(store.addShipToTeam(f4, 0, 'x'), false, '队伍满 6 个后不能再加');

const f5 = { id: 'f5', teams: [{ ships: ['a', 'b', 'c'] }, { ships: [] }] };
store.setFlagship(f5, 0, 'c');
eq(f5.teams[0].ships, ['c', 'a', 'b'], 'setFlagship 把目标移到队首（队首即旗舰）');

console.log('\n[9] 维度取值与差距计算（组队时实时对比条件用）');
eq(cond.valueOfDim('舰队|舰种|航母', ctx), { known: true, value: 2 }, 'valueOfDim 取到舰队航母数');
eq(cond.valueOfDim('旗舰|舰种|战列', ctx), { known: true, value: 1 }, 'valueOfDim 取到旗舰中的战列数');
eq(cond.valueOfDim('舰队|舰灵数|', ctx), { known: true, value: 5 }, 'valueOfDim 取到舰灵总数');
eq(cond.valueOfDim('舰队|均速|', ctx), { known: true, value: 34 }, 'valueOfDim 取到均速');
eq(cond.rangeVerdict(3, 12, { known: true, value: 2 }), { state: 'fail', gap: { need: 1, dir: '少' } }, 'rangeVerdict 算出还差 1 艘');
eq(cond.rangeVerdict(3, 12, { known: true, value: 3 }), { state: 'pass', gap: null }, '刚好达标判 pass');
eq(cond.rangeVerdict(0, 2, { known: true, value: 5 }), { state: 'fail', gap: { need: 3, dir: '多' } }, '超出上限算出多 3');
eq(cond.rangeVerdict(0, 2, { known: false, value: null }), { state: 'unknown', gap: null }, '数据不足判 unknown');
eq(cond.dimLabel('舰队|舰种|航母'), '舰队中 航母', 'dimLabel 描述舰种维度');
eq(cond.dimLabel('旗舰|舰种|战列'), '旗舰中 战列', 'dimLabel 描述旗舰维度');
eq(cond.dimLabel('舰队|阵营|奥鲁加', global.window.FX_FACTION_LABEL), '舰队中 <奥鲁加（德）>', 'dimLabel 给阵营补上国家');

console.log('\n[10] 文件与草稿合并（data/ships.js 可在外部批量生成）');
eq(store.mergeById([{ id: 'a', oil: 1 }, { id: 'b', oil: 2 }], [{ id: 'a', oil: 9 }], []).map(s => s.id + ':' + s.oil),
   ['a:9', 'b:2'], '草稿里的改动优先，文件里新增的补进来');
eq(store.mergeById([{ id: 'a' }], [], []).map(s => s.id), ['a'], '草稿为空时全部来自文件');
eq(store.mergeById([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }], ['b']).map(s => s.id), ['a'], '墓碑挡住在文件里复活的本机删除项');
eq(store.mergeById([], [{ id: 'a' }], []).map(s => s.id), ['a'], '文件为空时保留草稿');

console.log('\n[11] 数据与求值器的契约');
// 地图数据里的运算符是全角（游戏面板原文就是 ≥），求值器原来只认半角，导致全角 ≥ 走进 default：
// 区间退化成整个定义域、求值恒 fail —— 而旧测试用的是半角，正好错开没抓到。
const KNOWN_OPS = ['<', '<=', '=', '>=', '>'];
const KNOWN_KINDS = ['舰种', '阵营', '舰灵数', '均速', '索敌'];
const badOps = [], badKinds = [], badKeys = [];
Object.keys(map.nodes).forEach(id => {
  (map.nodes[id].next || []).forEach(e => (e.cond || []).forEach(c => {
    if (KNOWN_OPS.indexOf(cond.normOp(c.op)) < 0) badOps.push(`${id}->${e.to} op=${c.op}`);
    if (KNOWN_KINDS.indexOf(c.kind) < 0) badKinds.push(`${id}->${e.to} kind=${c.kind}`);
    if ((c.kind === '舰种' || c.kind === '阵营') && !c.key) badKeys.push(`${id}->${e.to} ${c.kind} 缺 key`);
  }));
});
eq(badOps, [], '地图数据里所有运算符都能被求值器识别（含全角 ≥）');
eq(badKinds, [], '地图数据里所有 kind 都被支持');
eq(badKeys, [], '舰种/阵营条件都必须带 key');

eq(cond.normOp('≥'), '>=', 'normOp 把全角 ≥ 归一化成 >=');
eq(cond.normOp('≤'), '<=', 'normOp 把全角 ≤ 归一化成 <=');
eq(cond.normOp('<='), '<=', 'normOp 不动半角运算符');
eq(cond.rangeOf({ scope: '舰队', kind: '舰种', key: '航母', op: '≥', n: 3 }), { lo: 3, hi: 12 }, '全角 ≥ 求出的区间正确');
eq(cond.evaluate({ scope: '舰队', kind: '舰种', key: '航母', op: '≥', n: 3 }, ctx), 'fail', '全角 ≥ 求值：航母=2 不满足 ≥3');
eq(cond.evaluate({ scope: '舰队', kind: '舰种', key: '航母', op: '≥', n: 2 }, ctx), 'pass', '全角 ≥ 求值：航母=2 满足 ≥2');
eq(cond.analyze([{ scope: '舰队', kind: '舰种', key: '航母', op: '≥', n: 3 },
                 { scope: '舰队', kind: '舰种', key: '航母', op: '<', n: 3 }]).conflicts.length, 1,
   '全角 ≥ 也参与冲突检测');

console.log('\n[12] 舰灵搜索/筛选/排序');
require(path.join(__dirname, '..', 'app', 'fleet-ui.js'));
const ui = global.window.FX.fleetUi._test;
const V = (patch) => Object.assign(ui.freshView(), patch || {});

const shipsForUI = [
  { id: 'a', name: '拉菲(DD-459)', type: '驱逐', faction: '尤奈特', oil: 32, speed: 38 },
  { id: 'b', name: '拉菲·改(DD-724)', type: '驱逐', faction: '尤奈特', oil: 31, speed: 34, fav: true },
  { id: 'c', name: '俾斯麦', type: '战列', faction: '奥鲁加', oil: 45, speed: 30 },
  { id: 'd', name: '苍龙', type: '航母', faction: '八咫', oil: 40, speed: 34 }
];
eq(ui.matchesView(shipsForUI[0], V()), true, '无筛选时全部命中');
eq(ui.matchesView(shipsForUI[0], V({ q: '拉菲' })), true, '按舰名子串命中');
eq(ui.matchesView(shipsForUI[2], V({ q: '拉菲' })), false, '子串不匹配的排除');
eq(ui.matchesView(shipsForUI[2], V({ types: { 战列: true } })), true, '按舰种筛命中');
eq(ui.matchesView(shipsForUI[0], V({ types: { 战列: true } })), false, '按舰种筛排除其他舰种');
eq(ui.matchesView(shipsForUI[2], V({ factions: { 奥鲁加: true } })), true, '按国籍筛命中');
eq(ui.matchesView(shipsForUI[0], V({ favOnly: true })), false, '只看收藏排除未收藏的');
eq(ui.matchesView(shipsForUI[1], V({ favOnly: true })), true, '只看收藏保留收藏的');

// 排序方向：用一组没有收藏的数据，避免"收藏置顶"掩盖方向问题
const noFav = shipsForUI.map(s => ({ id: s.id, name: s.name, type: s.type, faction: s.faction, oil: s.oil, speed: s.speed }));
eq(ui.sortList(noFav, V({ sort: 'oil', desc: true }), null).map(s => s.oil), [45, 40, 32, 31], '油耗 高→低：最大的在前');
eq(ui.sortList(noFav, V({ sort: 'oil', desc: false }), null).map(s => s.oil), [31, 32, 40, 45], '油耗 低→高：最小的在前');
eq(ui.sortList(noFav, V({ sort: 'speed', desc: true }), null).map(s => s.speed), [38, 34, 34, 30], '航速 高→低 正确');
eq(ui.sortList(noFav, V({ sort: 'type' }), null).map(s => s.type), ['驱逐', '驱逐', '战列', '航母'], '按舰种排序（顺序取自 shiptypes 枚举）');
eq(ui.sortList(shipsForUI, V({ sort: 'oil', desc: true }), null)[0].id, 'b', '收藏的永远置顶，不受排序方向影响');

console.log('\n[13] BOSS 点装甲（一个点可能有多个 BOSS，装甲类型可能不止一种）');
eq(graph.armorText(map.nodes.O), '重甲', 'O 点装甲 = 重甲');
eq(graph.bossTotal(map.nodes.O), 1, 'O 点有 1 个 BOSS');
eq(graph.armorText(map.nodes.Q), '中甲', 'Q 点装甲 = 中甲');
eq(graph.bossTotal(map.nodes.Q), 1, 'Q 点有 1 个 BOSS');
eq(graph.armorList(map.nodes.S), ['轻甲', '中甲'], 'S 点有两种装甲（轻甲 + 中甲）');
eq(graph.armorText(map.nodes.S), '轻甲+中甲', 'S 点装甲显示成 轻甲+中甲');
eq(graph.bossTotal(map.nodes.S), 2, 'S 点有 2 个 BOSS（轻巡 + 战巡）');
eq(graph.armorList({ armor: '中甲' }), ['中甲'], '兼容只写单个 armor 的旧数据');
eq(graph.armorList({}), [], '没有 BOSS 数据时返回空数组而不是崩掉');
// 数据完整性：所有 boss 点都必须是 bosses 数组，且每项带 type/armor
const badBoss = Object.keys(map.nodes).filter(id => {
  const n = map.nodes[id];
  if (n.type !== 'boss') return false;
  return !Array.isArray(n.bosses) || !n.bosses.length ||
         n.bosses.some(b => !b || !b.type || !b.armor);
});
eq(badBoss, [], '所有 BOSS 点的 bosses 数据都完整（type + armor）');

console.log(`\n=== ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
