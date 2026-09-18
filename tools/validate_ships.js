/* 校验 data/ships.js 里收录的舰灵库
 * 用法: node tools/validate_ships.js
 *
 * 检查项:
 *   1. FX_SHIPS 是数组, 每条有 id/name/oil/type/faction
 *   2. 舰种必须逐字存在于 data/shiptypes.js
 *   3. 国籍必须逐字存在于 data/factions.js 的键（留空则记为提示）
 *   4. 油耗必须是非负数
 *   5. id 唯一; 重名只提示不报错（同名不同改造形态是可能的）
 *   6. speed/scout 若填了必须是数字
 * 另外打印按舰种/国籍的分布，便于和游戏里对数量。
 */

const path = require('path');

global.window = {};
require(path.join(__dirname, '..', 'data', 'factions.js'));
require(path.join(__dirname, '..', 'data', 'shiptypes.js'));
require(path.join(__dirname, '..', 'data', 'ships.js'));

const SHIPS = global.window.FX_SHIPS || [];
const TYPES = global.window.FX_SHIP_TYPES || [];
const FACTIONS = global.window.FX_FACTIONS || {};

let errors = 0, warns = 0;
const err = (m) => { errors++; console.log('  [ERROR] ' + m); };
const warn = (m) => { warns++; console.log('  [WARN ] ' + m); };

console.log(`\n=== 舰灵库校验: 共 ${SHIPS.length} 条 ===\n`);
if (!Array.isArray(SHIPS)) { err('FX_SHIPS 不是数组'); process.exit(1); }
if (!SHIPS.length) { console.log('  （空库，没什么可校验的）\n'); process.exit(0); }

const seenId = new Set();
const seenName = new Map();
const typeCount = {}, factionCount = {}, oilMissing = [];

SHIPS.forEach((s, i) => {
  const tag = `#${i + 1} ${s && s.name ? s.name : '(无名)'}`;

  if (!s || typeof s !== 'object') { err(`${tag}: 不是对象`); return; }
  if (!s.id) err(`${tag}: 缺 id`);
  else if (seenId.has(s.id)) err(`${tag}: id 重复 (${s.id})`);
  else seenId.add(s.id);

  if (!s.name || !String(s.name).trim()) err(`${tag}: 缺舰名`);
  else {
    if (seenName.has(s.name)) warn(`${tag}: 舰名与第 ${seenName.get(s.name)} 条重复（同名不同形态可忽略）`);
    else seenName.set(s.name, i + 1);
  }

  if (TYPES.indexOf(s.type) < 0) err(`${tag}: 舰种「${s.type}」不在 shiptypes.js 里（须逐字一致）`);
  else typeCount[s.type] = (typeCount[s.type] || 0) + 1;

  if (!s.faction) warn(`${tag}: 国籍留空`);
  else if (!FACTIONS[s.faction]) err(`${tag}: 国籍「${s.faction}」不在 factions.js 里。注意「凤棲」是木+妻`);
  else factionCount[s.faction] = (factionCount[s.faction] || 0) + 1;

  const oil = Number(s.oil);
  if (s.oil === '' || s.oil === null || s.oil === undefined) { oilMissing.push(s.name); }
  else if (isNaN(oil) || oil < 0) err(`${tag}: 油耗「${s.oil}」不是非负数`);

  ['speed', 'scout'].forEach(k => {
    if (s[k] === '' || s[k] === null || s[k] === undefined) return;
    if (isNaN(Number(s[k]))) err(`${tag}: ${k}「${s[k]}」不是数字`);
  });
});

if (oilMissing.length) {
  warn(`有 ${oilMissing.length} 条没填油耗，油耗计算会把它们当 0：${oilMissing.join('、')}`);
}

console.log('\n--- 舰种分布 ---');
TYPES.forEach(t => { if (typeCount[t]) console.log(`  ${t}: ${typeCount[t]}`); });
console.log('\n--- 国籍分布 ---');
Object.keys(FACTIONS).forEach(f => { if (factionCount[f]) console.log(`  ${f}（${FACTIONS[f].country || '—'}）: ${factionCount[f]}`); });

console.log(`\n=== ${errors} 个错误, ${warns} 个提示 ===\n`);
process.exit(errors ? 1 : 0);
