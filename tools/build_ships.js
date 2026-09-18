/* 合并 tools/raw_ships.json -> data/ships.js
 *
 * - 轴A(typeBatches) 给出 舰名/消耗/航速/舰种
 * - 轴B(factionBatches) + factionsKnown 给出 国籍
 * - 同名规则: 同一舰种内, 首次出现的用原名, 之后记 {舰名}{k}(k=2,3,...)。
 *             想直接丢弃某些舰名的重复项, 用 --drop-dup=舰名,舰名
 * - 索敌一律留空(scout: "")
 *
 * 用法: node tools/build_ships.js [--dry] [--drop-dup=舰名,舰名]
 */
const fs = require('fs');
const path = require('path');

const RAW = require('./raw_ships.json');

/* 重复项直接丢掉的舰名。游戏里同名卡不一定都是能上场的战斗形态,
 * 想把重复项全扔掉时用命令行指定, 例如 --drop-dup=某舰名,另一舰名 */
const DROP_DUP = new Set(
  String((process.argv.find(a => a.indexOf('--drop-dup=') === 0) || '').slice('--drop-dup='.length))
    .split(',').map(s => s.trim()).filter(Boolean)
);

global.window = global.window || {};
require('../data/shiptypes.js');
require('../data/factions.js');
const TYPES = global.window.FX_SHIP_TYPES;
const FACTIONS = global.window.FX_FACTIONS;

// 舰名 -> 国籍
const factionByName = {};
for (const f of Object.keys(RAW.factionBatches || {})) {
  for (const nm of RAW.factionBatches[f]) {
    if (factionByName[nm] && factionByName[nm] !== f) {
      console.log(`  [冲突] ${nm}: ${factionByName[nm]} vs ${f}`);
    }
    factionByName[nm] = f;
  }
}
Object.assign(factionByName, RAW.factionsKnown || {});

const ships = [];
const notes = [];
const seenName = new Map();   // 全局: 舰名 -> 次数

for (const type of TYPES) {
  const batch = (RAW.typeBatches || {})[type];
  if (!batch) continue;
  const localCount = new Map();
  for (const e of batch) {
    let name = e.n;
    const seen = (localCount.get(name) || 0) + 1;
    localCount.set(name, seen);
    if (seen > 1) {
      if (DROP_DUP.has(name)) { notes.push(`丢弃重复: ${type}/${name} (第 ${seen} 个)`); continue; }
      name = name + seen;
    }
    const faction = factionByName[name] || factionByName[e.n] || '';
    if (!faction) notes.push(`缺国籍: ${name}`);
    ships.push({
      id: 's' + (ships.length + 1),
      name,
      oil: e.o,
      type,
      faction,
      speed: e.s,
      scout: '',
    });
  }
}

// 未匹配到舰种的舰名(轴B里出现的) 提示
const allNames = new Set();
for (const t of Object.keys(RAW.typeBatches || {})) for (const e of RAW.typeBatches[t]) allNames.add(e.n);
const missing = Object.keys(factionByName).filter(n => !allNames.has(n) && !allNames.has(n.replace(/\d+$/, '')));
if (missing.length) notes.push(`轴B里有 ${missing.length} 个舰名没在轴A出现: ${missing.slice(0, 40).join('、')}`);

const HEADER = `/* 舰灵库（你自己录入的那部分）
 *
 * 字段:
 *   id      唯一标识，自动生成，不用手填
 *   name    舰名。留空时自动命名为 {舰种}{序号}，例如「驱逐1」
 *   oil     油耗（整数）。参与"每场战斗消耗"和油点返还计算
 *   type    舰种，必须与 data/shiptypes.js 里的名称逐字一致
 *   faction 国籍/阵营，必须与 data/factions.js 里的键名逐字一致
 *   speed   航速（可选）。舰队均速值条件要用；不填则该条件判为"未知"而非"不满足"
 *   scout   索敌值（可选）。同上
 *
 * 由 tools/build_ships.js 从 tools/raw_ships.json 生成，勿手改。
 */
`;

const body = ships.map(s => {
  const speed = s.speed === '' || s.speed === undefined ? '' : s.speed;
  return `  { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)}, oil: ${s.oil}, ` +
    `type: ${JSON.stringify(s.type)}, faction: ${JSON.stringify(s.faction)}, ` +
    `speed: ${speed === '' ? '""' : speed}, scout: "" },`;
}).join('\n');

const out = `${HEADER}window.FX_SHIPS = [\n${body}\n];\n`;

console.log(`生成 ${ships.length} 条`);
const byType = {};
for (const s of ships) byType[s.type] = (byType[s.type] || 0) + 1;
console.log('舰种分布:', JSON.stringify(byType, null, 0));
const byFac = {};
for (const s of ships) byFac[s.faction || '(空)'] = (byFac[s.faction || '(空)'] || 0) + 1;
console.log('国籍分布:', JSON.stringify(byFac, null, 0));
if (notes.length) {
  console.log(`--- ${notes.length} 条提示 ---`);
  for (const n of notes.slice(0, 40)) console.log('  ' + n);
}

if (process.argv.includes('--dry')) { console.log('[dry run] 未写入'); process.exit(0); }
fs.writeFileSync(path.join(__dirname, '..', 'data', 'ships.js'), out, 'utf8');
console.log('已写入 data/ships.js');
