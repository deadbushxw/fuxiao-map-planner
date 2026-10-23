/* 覆盖规划命令行版：用最少总战数把所有"未通过的目标节点"走一遍
 *
 * 求解逻辑全部在 app/coverage.js 里（和网页端共用同一份实现，不留两套算法）。
 * 目标默认含**非战斗节点**（补给点等）—— 和网页端「包括非战斗节点」默认勾选一致，
 * 因为游戏里的委托解锁要求跑遍所有节点，不只是战斗节点。
 *
 * 用法:
 *   node tools/plan_coverage.js [选项]
 * 选项:
 *   --allow-retreat       允许中途撤退（候选含所有路线前缀）
 *   --exclude-boss        覆盖目标不含 BOSS 点
 *   --exclude-nonbattle   覆盖目标只算战斗节点（退回旧口径；默认含补给点等非战斗节点）
 *   --done=A,B,E          这些节点已通过，不算目标（战斗点/补给点都行）
 *   --objective=runs      目标改为最少趟数（同趟数下再比战数）
 *   --verify              额外用暴力枚举交叉验证解的正确性
 */

const path = require('path');
const graph = require(path.join(__dirname, '..', 'app', 'graph.js'));
const coverage = require(path.join(__dirname, '..', 'app', 'coverage.js'));

global.window = {};
require(path.join(__dirname, '..', 'data', 'maps', 'index.js'));
for (const f of global.window.FX_MAP_FILES) require(path.join(__dirname, '..', 'data', 'maps', f));
const MAP = global.window.FX_MAPS[0];

const argv = process.argv.slice(2);
const getArg = (name) => {
  const hit = argv.find(a => a === name || a.startsWith(name + '='));
  return hit === undefined ? null : (hit.includes('=') ? hit.split('=').slice(1).join('=') : true);
};
const allowRetreat = !!getArg('--allow-retreat');
const excludeBoss = !!getArg('--exclude-boss');
const excludeNonBattle = !!getArg('--exclude-nonbattle');
const objective = getArg('--objective') === 'runs' ? 'runs' : 'battles';
const doneArg = getArg('--done');
const alreadyDone = (typeof doneArg === 'string' ? doneArg : '').split(',').filter(Boolean);

// 目标集与网页端共用 app/coverage.js 的 targets()，避免两边口径漂移
const coverOpts = { includeBoss: !excludeBoss, includeNonBattle: !excludeNonBattle };
const allNodes = coverage.nodeIds(MAP);
const nonBattle = allNodes.filter(id => !graph.isBattle(MAP.nodes[id]));
const pool = coverage.targets(MAP, graph, {}, coverOpts);
const doneVisited = {};
alreadyDone.forEach(id => { doneVisited[id] = true; });
const targets = coverage.targets(MAP, graph, doneVisited, coverOpts);

console.log(`\n地图: ${MAP.event} / ${MAP.difficulty}`);
console.log(`覆盖范围 ${pool.length} 个节点` +
            (excludeBoss ? '（已排除 BOSS 点）' : '') +
            (excludeNonBattle ? '（只算战斗节点）' : `（含非战斗节点 ${nonBattle.join(' ') || '无'}）`) +
            (alreadyDone.length ? `，已通过跳过 ${alreadyDone.filter(id => pool.includes(id)).length} 个` : ''));
console.log(`目标 ${targets.length} 个: ${targets.join(' ')}`);
console.log(`选项: 允许撤退=${allowRetreat ? '是' : '否'}  目标=${objective === 'runs' ? '最少趟数' : '最少总战数'}`);

const sol = coverage.solve(MAP, graph, targets, { allowRetreat, objective });

if (!sol.ok) {
  console.log(`\n无解: ${sol.reason}`);
  if (sol.uncovered) console.log(`未覆盖节点: ${sol.uncovered.join(' ')}`);
  process.exit(1);
}

console.log(`\n=== 方案: ${sol.runCount} 趟，共 ${sol.totalBattles} 战 ===`);
sol.runs.forEach((r, i) => {
  const an = graph.analyzeRoute(MAP, r.nodes);
  const oil = an.oilPoints.map(o => `${o.node}(第${o.afterBattle}战后)`).join(',');
  console.log(`  第${i + 1}趟 (${r.battles}战): ${r.nodes.join('→')}`);
  console.log(`           新增覆盖 ${r.newCovered.join(' ')} | 油点 ${oil || '无'}`);
});

/* ---------- 交叉验证: 暴力枚举同样趟数下是否还有更优 ---------- */
if (getArg('--verify')) {
  console.log('\n=== 暴力枚举交叉验证 ===');
  const cands = coverage.candidates(MAP, graph, { allowRetreat });
  const idx = {};
  targets.forEach((id, i) => { idx[id] = i; });
  const FULL = (1 << targets.length) - 1;
  cands.forEach(c => {
    let m = 0;
    // 覆盖判定和 solve 保持一致：看路线经过的全部节点，非战斗节点也算
    c.nodes.forEach(id => { if (idx[id] !== undefined) m |= (1 << idx[id]); });
    c.mask = m;
  });
  for (let n = 1; n <= sol.runCount; n++) {
    let best = Infinity;
    const combo = [];
    (function rec(start) {
      if (combo.length === n) {
        let mask = 0, battles = 0;
        for (const i of combo) { mask |= cands[i].mask; battles += cands[i].battles; }
        if (mask === FULL && battles < best) best = battles;
        return;
      }
      for (let i = start; i < cands.length; i++) { combo.push(i); rec(i + 1); combo.pop(); }
    })(0);
    console.log(`  ${n} 趟: ${best === Infinity ? '无解' : '最少 ' + best + ' 战'}`);
  }
}
console.log('');
