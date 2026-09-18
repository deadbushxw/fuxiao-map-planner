/* 把 tools/batches/*.txt 汇总成 tools/raw_ships.json
 *
 * 约定文件名:
 *   <舰种>.txt        每行: 舰名 消耗 航速        (轴A)
 *   fac_<国籍>.txt    每行: 舰名                   (轴B)
 *   known_factions.txt 每行: 舰名 国籍             (详情页核对出来的零散国籍)
 *
 * 用法: node tools/ingest_batches.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'batches');
const TYPES = ['驱逐', '轻巡', '重巡', '战列', '战巡', '航母', '轻母', '装母', '补给', '重炮', '雷巡', '航战', '水母'];

const typeBatches = {};
const factionBatches = {};
const known = {};

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.txt')) continue;
  const base = f.slice(0, -4);
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/)
    .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  if (base === 'known_factions') {
    for (const l of lines) { const [n, fac] = l.split(/\s+/); known[n] = fac; }
  } else if (base.startsWith('fac_')) {
    factionBatches[base.slice(4)] = lines.map(l => l.split(/\s+/)[0]);
  } else if (TYPES.includes(base)) {
    typeBatches[base] = lines.map(l => {
      const m = l.split(/\s+/);
      return { n: m[0], o: Number(m[1]), s: m[2] === undefined ? '' : Number(m[2]) };
    });
  } else {
    console.log('  跳过未知批次文件: ' + f);
  }
}

const out = {
  _comment: '由 tools/ingest_batches.js 从 tools/batches/*.txt 生成。轴A=舰种批次(名称/消耗/航速), 轴B=国籍批次(舰名), knownFactions=详情页核对值。',
  typeBatches,
  factionBatches,
  factionsKnown: known,
};
fs.writeFileSync(path.join(__dirname, 'raw_ships.json'), JSON.stringify(out, null, 2), 'utf8');

let total = 0;
for (const t of TYPES) if (typeBatches[t]) { console.log(`  ${t}: ${typeBatches[t].length}`); total += typeBatches[t].length; }
console.log(`轴A 合计 ${total} 条`);
for (const f of Object.keys(factionBatches)) console.log(`  fac ${f}: ${factionBatches[f].length}`);
console.log(`knownFactions: ${Object.keys(known).length}`);
