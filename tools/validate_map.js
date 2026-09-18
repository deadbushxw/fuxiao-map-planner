/* 地图数据校验 + 路线枚举
 * 用法: node tools/validate_map.js [地图id]
 *
 * 校验项:
 *   1. 所有 next.to 都必须是已定义的节点
 *   2. 不允许双向边 (A->B 与 B->A 同时存在)
 *   3. 从 start 出发所有节点可达
 *   4. 终点节点 next 必须为空; 非终点必须非空
 *   5. 同一节点的多条分支条件不应完全相同
 * 输出: 每条 start->终点 的路线, 含战斗数、油点位置、条件链
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const graph = require(path.join(root, 'app', 'graph.js'));
global.window = {};
require(path.join(root, 'data', 'maps', 'index.js'));
for (const f of global.window.FX_MAP_FILES) {
  require(path.join(root, 'data', 'maps', f));
}
const MAPS = global.window.FX_MAPS;
const wantId = process.argv[2];
const map = wantId ? MAPS.find(m => m.id === wantId) : MAPS[0];
if (!map) { console.error('map not found:', wantId); process.exit(1); }

const N = map.nodes;
let errors = 0, warns = 0;
const err = m => { errors++; console.log('  [ERROR] ' + m); };
const warn = m => { warns++; console.log('  [WARN ] ' + m); };

console.log(`\n=== ${map.event} / ${map.difficulty}  (${Object.keys(N).length} 节点) ===\n`);

console.log('--- 1. 目标节点合法性 ---');
const edges = [];
for (const [id, n] of Object.entries(N)) {
  for (const e of (n.next || [])) {
    if (!N[e.to]) err(`${id} -> ${e.to} 目标节点不存在`);
    else edges.push([id, e.to, e]);
  }
}
if (!errors) console.log(`  OK (${edges.length} 条边)`);

console.log('--- 2. 双向边检查 ---');
const set = new Set(edges.map(([a, b]) => `${a}>${b}`));
let bi = 0;
for (const [a, b] of edges) if (set.has(`${b}>${a}`)) { err(`双向边: ${a} <-> ${b}`); bi++; }
if (!bi) console.log('  OK (无双向边)');

console.log('--- 3. 可达性 ---');
const seen = new Set([map.start]);
const q = [map.start];
while (q.length) for (const e of (N[q.pop()].next || [])) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
const unreachable = Object.keys(N).filter(id => !seen.has(id));
if (unreachable.length) err(`不可达: ${unreachable.join(', ')}`);
else console.log(`  OK (从 ${map.start} 可达全部 ${seen.size} 个节点)`);

console.log('--- 4. 终点/分支一致性 ---');
const BATTLE = new Set(['battle', 'boss']);
for (const [id, n] of Object.entries(N)) {
  const outs = n.next || [];
  if (outs.length === 0 && n.type !== 'boss') warn(`${id} (${n.type}) 没有出边但不是 boss —— 确认是否真的是终点`);
  if (outs.length > 0 && n.next.length !== outs.length) err(`${id} next 异常`);
}
console.log(`  终点: ${Object.entries(N).filter(([, n]) => (n.next || []).length === 0).map(([id]) => id).join(', ')}`);

console.log('--- 5. 同一节点分支条件重复检查 ---');
for (const [id, n] of Object.entries(N)) {
  const raws = (n.next || []).map(e => e.raw);
  if (new Set(raws).size !== raws.length) err(`${id} 存在重复分支条件: ${raws.join(' | ')}`);
}
if (!errors) console.log('  OK');

console.log('--- 6. BOSS 点数据完整性 ---');
for (const [id, n] of Object.entries(N)) {
  if (n.type !== 'boss') continue;
  if (!Array.isArray(n.bosses) || !n.bosses.length) { err(`${id} 是 BOSS 点但没有 bosses 数组`); continue; }
  n.bosses.forEach((b, i) => {
    if (!b || !b.type) err(`${id} 第 ${i + 1} 个 BOSS 缺 type`);
    if (!b || !b.armor) err(`${id} 第 ${i + 1} 个 BOSS 缺 armor`);
    if (b && b.count !== undefined && (typeof b.count !== 'number' || b.count < 1)) err(`${id} 第 ${i + 1} 个 BOSS 的 count 非法: ${b.count}`);
  });
  console.log(`  ${id}: ${graph.armorText(n)}  ${graph.bossTotal(n)} 个 BOSS  ` +
    n.bosses.map(b => `${b.type}×${b.count || 1}(${b.armor})`).join(' + '));
}

console.log(`\n--- 路线枚举 (${map.start} -> 各终点) ---`);
const paths = [];
(function dfs(cur, acc) {
  if (acc.length > 30) return;
  const outs = N[cur].next || [];
  if (outs.length === 0) { paths.push(acc.slice()); return; }
  for (const e of outs) {
    if (acc.includes(e.to)) { warn(`检测到环: ${acc.join('->')}->${e.to}, 已跳过该分支`); continue; }
    acc.push(e.to); dfs(e.to, acc); acc.pop();
  }
})(map.start, [map.start]);

paths.sort((a, b) => a.length - b.length);
const fmtCond = e => e.cond.length === 0 ? '无条件'
  : e.cond.map(c => `${c.scope === '旗舰' ? '旗舰中' : '舰队中'}${c.key || ''}${c.kind}${c.op}${c.n}`).join(' 且 ');
let i = 0;
for (const p of paths) {
  i++;
  const battles = p.filter(id => BATTLE.has(N[id].type));
  const supplies = p.filter(id => N[id].type === 'supply');
  const supplyInfo = supplies.map(sid => {
    const idx = p.indexOf(sid);
    let ord = 0, prev = null;
    for (let k = 0; k < idx; k++) if (BATTLE.has(N[p[k]].type)) { ord++; prev = p[k]; }
    return `${sid}(第${ord}战后, 基准=${prev || '无'})`;
  });
  console.log(`\n  #${i} ${p.join(' -> ')}`);
  console.log(`     战斗 ${battles.length} 场: ${battles.join(', ')}   [终点 ${p[p.length - 1]} 装甲=${graph.armorText(N[p[p.length - 1]])}]`);
  console.log(`     油点: ${supplyInfo.length ? supplyInfo.join('; ') : '无'}`);
  const conds = [];
  for (let k = 0; k + 1 < p.length; k++) {
    const e = (N[p[k]].next || []).find(x => x.to === p[k + 1]);
    if (e && e.cond.length) conds.push(`${p[k]}->${p[k + 1]}: ${fmtCond(e)}`);
  }
  console.log(`     条件: ${conds.length ? conds.join(' | ') : '无（全程无条件）'}`);
}

console.log(`\n=== 结果: ${errors} 个错误, ${warns} 个警告, 共 ${paths.length} 条路线 ===\n`);
process.exit(errors ? 1 : 0);
