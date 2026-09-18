/* 发布前自查：看有没有把本机的东西带进仓库
 *
 * 用法: node tools/check_privacy.js [--list]
 *        --list 只打印会被提交的文件清单，不做检查（发布前肉眼过一遍用）
 *
 * 查的是「会被提交的文件」：有 .git 时取 git ls-files 的已跟踪 + 未忽略未跟踪；
 * 没有 .git 时按 .gitignore 的规则遍历（所以首次 git init 之前就能跑）。
 *
 * 四类检查:
 *   1. 结构 —— data/ships.js、data/fleets.js 必须是空模板；
 *              shots/、tools/preview/、tools/batches/、local/ 下不该有文件进库
 *   2. 本机痕迹 —— 绝对路径、Windows/macOS/Linux 的用户名目录
 *   3. 私人文档口吻 —— 「真实进度」「用户批注」这类只该出现在私人笔记里的说法
 *   4. 账号数据 —— 拿 local/ships.local.js（本机私有舰灵库）当基准反查：
 *              a) 同名编号形态的舰名（如「某舰」/「某舰2」）出现在任何文件里 —— 这是按
 *                 自己账号列表采集才会产生的名字，最硬的泄漏信号
 *              b) 文档与数据文件（.md/.json/.html/data/）里同时出现 ≥5 个私有舰名 ——
 *                 多半是把整份舰灵库抄进去了
 *              代码文件（app/、tools/ 的 .js）不查 (b)：测试夹具和地图掉落数据里出现
 *              几艘真实舰名是正常的，它们属于游戏内容，不是账号数据
 *
 * 命中即非 0 退出。检查项自身不含任何私人数据，可以放心入库。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* 不该进仓库的目录（相对 ROOT，用正斜杠）。.gitignore 才是权威，这里只是双重保险 */
const BANNED_DIRS = ['shots/', 'tools/preview/', 'tools/batches/'];
const BANNED_FILES = ['tools/raw_ships.json', 'jianzhongguoji.png'];
/* local/ 只放行说明文件 */
const LOCAL_ALLOW = ['local/README.md'];

/* 明确不该出现在任何入库文件里的字面量 */
const BANNED_TEXT = [
  ['C:/Users/', 'Windows 用户目录绝对路径'],
  ['C:\\Users\\', 'Windows 用户目录绝对路径'],
  ['E:/code/', '本机项目目录'],
  ['E:\\code\\', '本机项目目录'],
  ['Reasonix', '本机工作区名'],
  ['真实进度', '个人游戏进度'],
  ['用户批注', '私人交接文档口吻'],
  ['用户指定', '私人交接文档口吻'],
  ['本次实测', '私人采集记录口吻']
];

const BIN_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.exe', '.woff', '.woff2']);
const TEXT_EXT = new Set(['.js', '.json', '.md', '.html', '.css', '.txt', '.sh', '.py', '.ps1', '.yml', '.yaml']);
const TEXT_NAMES = new Set(['.gitignore', '.gitattributes']);

let errors = 0, warns = 0;
const err = (m) => { errors++; console.log('  [ERROR] ' + m); };
const warn = (m) => { warns++; console.log('  [WARN ] ' + m); };

/* ---------- .gitignore 匹配（只在没有 .git 时用得上） ---------- */
function loadIgnoreRules() {
  const p = path.join(ROOT, '.gitignore');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && l[0] !== '#')
    .map(l => ({ neg: l[0] === '!', pat: l.replace(/^!/, '').replace(/\/+$/, '') }));
}

function globRe(pat) {
  const esc = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp('^' + esc + '$');
}

function isIgnored(rel, rules) {
  let ig = false;
  for (const r of rules) {
    const pat = r.pat.replace(/^\//, '');
    let hit;
    if (pat.indexOf('/') >= 0) {
      hit = new RegExp('^' + globRe(pat).source.slice(1, -1) + '(/|$)').test(rel);
    } else {
      hit = rel.split('/').some(seg => globRe(pat).test(seg));
    }
    if (hit) ig = !r.neg;
  }
  return ig;
}

/* ---------- 待检查文件清单 ---------- */
function listTargets() {
  if (fs.existsSync(path.join(ROOT, '.git'))) {
    try {
      const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd: ROOT, encoding: 'utf8' });
      return { from: 'git ls-files', files: out.split(/\r?\n/).filter(Boolean).map(f => f.replace(/\\/g, '/')) };
    } catch (e) {
      console.log('  （git ls-files 失败，改用 .gitignore 遍历）');
    }
  }
  const rules = loadIgnoreRules();
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.git' || name === 'node_modules') continue;
      const abs = path.join(dir, name);
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      if (isIgnored(rel, rules)) continue;
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else files.push(rel);
    }
  })(ROOT);
  return { from: '.gitignore 遍历', files };
}

function isTextFile(rel, abs) {
  const ext = path.extname(rel).toLowerCase();
  if (BIN_EXT.has(ext)) return false;
  if (TEXT_EXT.has(ext) || TEXT_NAMES.has(path.basename(rel))) return true;
  if (!ext) return fs.readFileSync(abs).indexOf(0) < 0;
  return false;
}

/* 文档/数据类文件：查「整份舰灵库被抄进来」
 * 代码文件不查这条 —— 测试夹具与地图掉落数据里出现真实舰名是正常的（属游戏内容） */
function isDocOrData(rel) {
  if (rel.indexOf('data/') === 0) return true;
  const ext = path.extname(rel).toLowerCase();
  return ext === '.md' || ext === '.json' || ext === '.html';
}

/* ---------- 私有舰灵库（基准） ---------- */
function loadPrivateShips() {
  const p = path.join(ROOT, 'local', 'ships.local.js');
  if (!fs.existsSync(p)) return null;
  const names = [];
  const re = /name:\s*"([^"]+)"/g;
  let m;
  const src = fs.readFileSync(p, 'utf8');
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

/* 同名编号形态：某舰 / 某舰2。这种名字是按自己账号的列表顺序生成出来的 */
function numberedDuplicates(names) {
  const set = new Set(names);
  const out = new Set();
  for (const n of names) {
    const m = /^(.*?)(\d+)$/.exec(n);
    if (!m) continue;
    if (m[1] && set.has(m[1])) { out.add(m[1]); out.add(n); }
  }
  return out;
}

/* ---------- 开始 ---------- */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
console.log(`\n=== 发布前自查: ${pkg.name} ===\n`);

const { from, files } = listTargets();
console.log(`检查范围: ${files.length} 个文件（清单来源: ${from}）`);

if (process.argv.includes('--list')) {
  console.log('');
  for (const f of files.slice().sort()) console.log('  ' + f);
  console.log(`\n共 ${files.length} 个文件会被提交。\n`);
  process.exit(0);
}

/* [1] 结构 */
console.log('\n[1] 结构与目录');
const shipsTpl = fs.readFileSync(path.join(ROOT, 'data', 'ships.js'), 'utf8');
const fleetsTpl = fs.readFileSync(path.join(ROOT, 'data', 'fleets.js'), 'utf8');
if (!/window\.FX_SHIPS\s*=\s*\[\s*\]\s*;/.test(shipsTpl)) err('data/ships.js 不是空模板（应为 window.FX_SHIPS = [];）');
else console.log('  ok   data/ships.js 是空模板');
if (!/window\.FX_FLEETS\s*=\s*\[\s*\]\s*;/.test(fleetsTpl)) err('data/fleets.js 不是空模板（应为 window.FX_FLEETS = [];）');
else console.log('  ok   data/fleets.js 是空模板');

let bannedHit = 0;
for (const f of files) {
  if (BANNED_DIRS.some(d => f.indexOf(d) === 0)) { err(`不该入库: ${f}`); bannedHit++; }
  else if (BANNED_FILES.indexOf(f) >= 0) { err(`不该入库: ${f}`); bannedHit++; }
  else if (f.indexOf('local/') === 0 && LOCAL_ALLOW.indexOf(f) < 0) { err(`local/ 下只允许进库: ${LOCAL_ALLOW.join(', ')}；发现 ${f}`); bannedHit++; }
}
if (!bannedHit) console.log('  ok   没有该被忽略的目录/文件混进来');

/* [2][3] 字面量；[4] 私有舰名反查 */
console.log('\n[2] 本机痕迹 / 私人文档口吻 / 账号数据');
const priv = loadPrivateShips();
const numDup = priv ? numberedDuplicates(priv) : new Set();
if (!priv) warn('没有 local/ships.local.js，跳过「私有舰名反查」（别人的仓库属正常）');
else console.log(`  基准: 私有舰灵库 ${priv.length} 个舰名，其中同名编号形态 ${numDup.size} 个`);

const USER_RE = [
  /[A-Za-z]:[\\/]Users[\\/]([^\\/\s"'<>|]+)/g,     // C:/Users/xxx
  /\/[cC]\/Users\/([^\/\s"'<>|]+)/g,               // /c/Users/xxx（Git Bash）
  /\/(?:home|Users)\/([^\/\s"'<>|]+)/g             // Linux / macOS
];
const PLACEHOLDER = /^(<|\$|%|\*|\.\.\.|user|username|xxx|your-?name|whoami|me)$/i;

let hits = 0;
for (const f of files) {
  if (f === 'tools/check_privacy.js') continue;    // 本脚本自身含检查项字面量
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs) || !isTextFile(f, abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;

  for (const [needle, why] of BANNED_TEXT) {
    const i = src.indexOf(needle);
    if (i >= 0) { err(`${f}:${lineAt(i)} 出现「${needle}」（${why}）`); hits++; }
  }

  for (const re of USER_RE) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (PLACEHOLDER.test(m[1])) continue;
      err(`${f}:${lineAt(m.index)} 出现本机用户名路径「${m[0]}」`);
      hits++;
    }
  }

  if (priv) {
    for (const n of numDup) {
      if (src.indexOf(n) >= 0) {
        err(`${f} 出现采集产物式的同名编号舰名「${n}」（只在按自己账号列表采集时才会产生）`);
        hits++;
        break;
      }
    }
    if (isDocOrData(f)) {
      const uniq = Array.from(new Set(priv.filter(n => n.length >= 2 && src.indexOf(n) >= 0)));
      if (uniq.length >= 5) {
        err(`${f} 命中 ${uniq.length} 个私有舰名（≥5 视为把舰灵库抄进来了）: ` +
            uniq.slice(0, 12).join('、') + (uniq.length > 12 ? '…' : ''));
        hits++;
      }
    }
  }
}
if (!hits) console.log('  ok   没有命中');

console.log(`\n=== ${errors} 个问题, ${warns} 个提示 ===`);
console.log(errors ? '命中项需要先清理，再考虑提交。\n' : '可以提交。\n');
process.exit(errors ? 1 : 0);
