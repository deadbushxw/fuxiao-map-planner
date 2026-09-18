/* 船坞批量采集编排 (提速版)
 *
 * 速度要点:
 *   - 截图走 `adb exec-out screencap -p` (747ms) 而不是 screencap+pull (1288ms)
 *   - 同一张截图只解码一次, 反复用于状态判定/行定位/裁剪
 *   - 回顶用盲滑几次再一次确认, 不做逐步截图
 *
 * 用法:
 *   node tools/dock.js state                     看当前界面
 *   node tools/dock.js sel                       看筛选面板当前勾选
 *   node tools/dock.js sweep shiptype 航母,轻母   逐批: 设筛选 -> 回顶 -> 滚到底截图 -> 出读图长条
 *   node tools/dock.js one   shiptype 驱逐 <prefix>
 *   node tools/dock.js strip <png> <out>
 *   node tools/dock.js rows <png>
 *   node tools/dock.js tapbtn <shiptype|faction> <name> [次数]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readPNG, writePNG, px } = require('./png.js');

/* adb 位置: 依次尝试 环境变量 ADB -> ANDROID_HOME / ANDROID_SDK_ROOT 下的 platform-tools -> PATH。
 * 装在别处就在运行前 `export ADB=/路径/to/adb`, 不要改这里的代码。 */
const ADB = (() => {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const cands = [process.env.ADB];
  for (const home of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (home) cands.push(path.join(home, 'platform-tools', exe));
  }
  cands.push(exe);   // 纯命令名, 交给 PATH
  for (const c of cands) {
    if (!c) continue;
    if (!c.includes('/') && !c.includes('\\')) return c;
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  console.error('找不到 adb：请设环境变量 ADB(=可执行文件全路径)、或 ANDROID_HOME，或把 adb 放进 PATH。');
  process.exit(1);
})();
const ADB_OPTS = { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' } };

// 模拟器重连后 serial 会变(emulator-5556 <-> 127.0.0.1:7555 是同一个实例), 自动选一个在线设备
const SERIAL = (() => {
  try {
    const out = execFileSync(ADB, ['devices'], { encoding: 'utf8', env: ADB_OPTS.env });
    const list = out.split(/\r?\n/).slice(1).map(l => l.split('\t')).filter(p => p[1] && p[1].trim() === 'device').map(p => p[0].trim());
    return list.find(s => s === 'emulator-5556') || list[0] || 'emulator-5556';
  } catch { return 'emulator-5556'; }
})();
const PREV = path.join(__dirname, 'preview');
const SHOTS = path.join(__dirname, '..', 'shots', 'dock');

const sleep = (ms) => { const t = Date.now() + ms; while (Date.now() < t) {} };

function adb(args) { return execFileSync(ADB, ['-s', SERIAL, ...args], ADB_OPTS); }
function tap(x, y, settle = 300) { adb(['shell', 'input', 'tap', String(x), String(y)]); sleep(settle); }
function swipe(x1, y1, x2, y2, ms = 600, settle = 700) {
  adb(['shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(ms)]);
  sleep(settle);
}
function back() { adb(['shell', 'input', 'keyevent', '4']); sleep(900); }

// 截一屏: 返回 {buf, img}, 只解码一次
function shot(saveTo) {
  const buf = adb(['exec-out', 'screencap', '-p']);
  if (saveTo) fs.writeFileSync(saveTo, buf);
  return { buf, img: readPNG(buf) };
}

// ---------- 像素特征 ----------
function features(img) {
  let lightAll = 0, cyanBox = 0, bottomLeft = 0, darkCards = 0, ddItem = 0;
  for (let y = 200; y < 850; y += 2) for (let x = 350; x < 1700; x += 2) {
    const [r, g, b] = px(img, x, y);
    if (r > 190 && g > 190 && b > 190) lightAll += 4;
  }
  for (let y = 48; y < 93; y++) for (let x = 1192; x < 1387; x++) {
    const [r, g, b] = px(img, x, y);
    if (g > 150 && b > 150 && r < 130 && b - r > 60) cyanBox++;
  }
  for (let y = 930; y < 1010; y++) for (let x = 20; x < 420; x++) {
    const [r, g, b] = px(img, x, y);
    if (r > 190 && g > 190 && b > 190) bottomLeft++;
  }
  for (let y = 200; y < 520; y += 2) for (let x = 30; x < 250; x += 2) {
    const [r, g, b] = px(img, x, y);
    if ((r + g + b) / 3 < 60) darkCards += 4;
  }
  for (let y = 100; y < 330; y += 2) for (let x = 1200; x < 1390; x += 2) {
    const [r, g, b] = px(img, x, y);
    if (r > 200 && g > 200 && b > 200) ddItem += 4;
  }
  return { lightAll, cyanBox, bottomLeft, darkCards, ddItem };
}
function classify(f) {
  if (f.lightAll > 400000) return 'filter';
  if (f.bottomLeft > 8000) return 'detail';
  if (f.ddItem > 20000) return 'dock-dropdown';
  if (f.cyanBox > 2500) return 'dock-t2';
  if (f.darkCards > 30000) return 'dock-statdark';
  return 'dock-portrait';
}
const stateOf = (s) => classify(features(s.img));

// 属性下拉项(TYPE 1..5)的白色方块位置
function findDropdownItems(img) {
  const rows = [];
  for (let y = 70; y < 400; y++) {
    let n = 0;
    for (let x = 1205; x < 1385; x++) {
      const [r, g, b] = px(img, x, y);
      if (r > 200 && g > 200 && b > 200) n++;
    }
    rows.push(n > 120);
  }
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] && !rows[i - 1]) {
      let j = i; while (j < rows.length && rows[j]) j++;
      if (j - i > 25) items.push(Math.round((i + j - 1) / 2) + 70);
    }
  }
  return items;
}

// ---------- 卡片行定位 ----------
const CARD_H = 398, PITCH = 424, VIEW = [147, 1053];
// 相对行顶的取带范围。拼接时每步 1~2px 的测量误差会累积, 所以留了 ±14px 余量:
// 舰名一带, 消耗+航速合成一带(两者只差 10px, 拆开容易被漂移切掉)。
const ROW_OFF = { name: [2, 48], vals: [266, 378] };
const COL_CX = [143, 412, 682, 950, 1218, 1487, 1756];

function findRows(img, yLo = VIEW[0], yHi = VIEW[1]) {
  const segs = [];
  for (let y = Math.max(0, yLo - 30); y < img.h; y++) {
    let n = 0;
    for (let x = 30; x < 250; x += 2) {
      const [r, g, b] = px(img, x, y);
      if ((r + g + b) / 3 < 70) n++;
    }
    if (n > 50) { const last = segs[segs.length - 1]; if (last && y - last[1] <= 8) last[1] = y; else segs.push([y, y]); }
  }
  const big = segs.filter(s => s[1] - s[0] > 80);
  let base = null;
  for (const s of big) if (s[1] - s[0] >= 380 && s[1] < yHi - 10) { base = s[1] - CARD_H; break; }
  if (base === null) for (const s of big) if (s[1] < yHi - 10) { base = s[1] - CARD_H; break; }
  if (base === null) return [];
  const tops = [];
  for (let t = base % PITCH; t < img.h + PITCH; t += PITCH) if (t > yLo - PITCH && t < img.h) tops.push(t);
  return tops.filter(t => {
    if (t + ROW_OFF.name[0] < yLo || t + ROW_OFF.vals[1] > yHi) return false;
    let n = 0;
    for (let x = 30; x < 250; x += 2) { const [r, g, b] = px(img, x, t + 200); if ((r + g + b) / 3 < 90) n++; }
    return n > 50;
  }).sort((a, b) => a - b);
}

// ---------- 面板 ----------
const PANEL_X = 1841, PANEL_Y = 79;
const TOP_FINGERPRINT = [[417, 547], [587, 547], [757, 547]];   // 吨位行, 只在顶部且永不被选中

// 注意: 按钮正中央是文字(白字/深字), 单点采样会判错 —— 必须按区域取比例
function boxFrac(img, x, y, pred, hw = 46, hh = 18) {
  let n = 0, t = 0;
  for (let dy = -hh; dy <= hh; dy += 2) for (let dx = -hw; dx <= hw; dx += 2) {
    const [r, g, b] = px(img, x + dx, y + dy); t++;
    if (pred(r, g, b)) n++;
  }
  return n / t;
}
const BLUE = (r, g, b) => b > 140 && b - r > 50 && g - r > 30;
const LIGHT = (r, g, b) => r > 190 && g > 190 && b > 190;
function isLightAt(img, x, y) { return boxFrac(img, x, y, LIGHT) > 0.5; }
function isBlueAt(img, x, y) { return boxFrac(img, x, y, BLUE) > 0.3; }
function panelOpen(s) { return stateOf(s) === 'filter'; }
// 顶部特征: 吨位行(大型/中型/小型)三个按钮的文字都在, 且它永不被选中
function panelAtTop(img) { return [[417, 547], [587, 547], [757, 547]].every(([x, y]) => hasText(img, x, y)); }
// 按钮上有没有文字(背景是平滑渐变, 没有深色文字)
function hasText(img, x, y) {
  let n = 0;
  for (let dy = -20; dy <= 20; dy++) for (let dx = -36; dx <= 36; dx++) {
    const [r, g, b] = px(img, x + dx, y + dy);
    if ((r + g + b) / 3 < 140) n++;
  }
  return n > 20;
}

const TYPES = ['驱逐', '轻巡', '重巡', '战列', '战巡', '航母', '轻母', '装母', '补给', '重炮', '雷巡', '航战', '水母'];
const FACTIONS = ['凤棲', '洛蒙瑞亚', '尤奈特', '纳榭尔', '沃尔克', '奥鲁加', '八咫', '列加杜', '伽纳伊', '无阵营'];
const COL0 = 417, PITCH_X = 170;
function shiptypeBtn(name) {
  const i = TYPES.indexOf(name) + 1;
  return i <= 8 ? { x: COL0 + PITCH_X * i, y: 373 } : { x: COL0 + PITCH_X * (i - 9), y: 442 };
}
function factionBtn(name) {
  const i = FACTIONS.indexOf(name) + 1;
  return i <= 8 ? { x: COL0 + PITCH_X * i, y: 634 } : { x: COL0 + PITCH_X * (i - 9), y: 703 };
}
const ALL_BTN = { shiptype: { x: COL0, y: 373 }, faction: { x: COL0, y: 634 } };
function selectedTypes(img) {
  const out = [];
  if (isBlueAt(img, COL0, 373)) out.push('全部');
  for (const t of TYPES) { const p = shiptypeBtn(t); if (isBlueAt(img, p.x, p.y)) out.push(t); }
  return out;
}
function selectedFactions(img) {
  const out = [];
  if (isBlueAt(img, COL0, 634)) out.push('全部');
  for (const f of FACTIONS) { const p = factionBtn(f); if (isBlueAt(img, p.x, p.y)) out.push(f); }
  return out;
}

function closePanel() {
  let s = shot();
  for (let i = 0; i < 3 && panelOpen(s); i++) { tap(PANEL_X, PANEL_Y, 500); s = shot(); }
  return !panelOpen(s);
}

// 选择语义(实测): 「全部」选中时点具体项 -> 只选该项; 已选具体项时点另一项 -> 追加; 点同一项 -> 取消
function setFilter(kind, name) {
  const selOf = kind === 'shiptype' ? selectedTypes : selectedFactions;
  const btn = kind === 'shiptype' ? shiptypeBtn : factionBtn;
  const allBtn = ALL_BTN[kind];
  const want = JSON.stringify([name]);

  let s = shot();
  if (!panelOpen(s)) { tap(1777, 70, 800); s = shot(); }
  if (!panelOpen(s)) return { ok: false, why: '打不开筛选' };
  // 面板总高只比视口高一点点, 直接盲滑几次必然夹到顶部(再滑也不会越过),
  // 这样固定坐标才可信 —— 只靠指纹判断会误判(按钮高 62 而行距 69, 移位后仍可能命中按钮)。
  for (let i = 0; i < 4; i++) { swipe(200, 400, 200, 900, 350, 300); s = shot(); }
  if (!panelAtTop(s.img)) { closePanel(); return { ok: false, why: '面板没回到顶部' }; }

  // 关键: 另一条轴必须先复位成「无具体筛选」, 否则两轴叠加会把列表清空(踩过这个坑)
  const isReset = (sel) => sel.length === 0 || (sel.length === 1 && sel[0] === '全部');
  const otherSelOf = kind === 'shiptype' ? selectedFactions : selectedTypes;
  const otherAll = kind === 'shiptype' ? ALL_BTN.faction : ALL_BTN.shiptype;
  if (!isReset(otherSelOf(s.img))) {
    tap(otherAll.x, otherAll.y, 450); s = shot();
    if (!isReset(otherSelOf(s.img))) { closePanel(); return { ok: false, why: '另一轴复位失败=' + JSON.stringify(otherSelOf(s.img)) }; }
  }

  if (JSON.stringify(selOf(s.img)) === want) { closePanel(); return { ok: true }; }
  // 「全部」和「空」都表示没有具体筛选; 点「全部」本身时若它已选中会变成空(也是"无筛选")
  if (!isReset(selOf(s.img))) {
    tap(allBtn.x, allBtn.y, 450); s = shot();
    if (!isReset(selOf(s.img))) { closePanel(); return { ok: false, why: '重置后=' + JSON.stringify(selOf(s.img)) }; }
  }
  const p = btn(name);
  tap(p.x, p.y, 450); s = shot();
  const after = JSON.stringify(selOf(s.img));
  if (after !== want) {
    const dbg = path.join(PREV, `_fail_${name}.png`).replace(/\\/g, '/');
    fs.writeFileSync(dbg, s.buf);
    console.log(`  失败现场: ${dbg}  点(${p.x},${p.y}) 选中=${after} 面板还开着=${panelOpen(s)}`);
  }
  closePanel();
  return after === want ? { ok: true } : { ok: false, why: '选完=' + after };
}

// 回顶: 手指往下拖 = 内容往下走 = 回到列表开头。
// (反了的话会跑到列表末尾, 而且因为到底不动, 采集只会拿到最后两行 —— 踩过。)
function goTop() {
  for (let i = 0; i < 6; i++) swipe(960, 160, 960, 1000, 700, 420);
  let s = shot();
  for (let i = 0; i < 3; i++) {
    const rows = findRows(s.img);
    if (rows.length && rows[0] >= 150 && rows[0] <= 178) return true;
    swipe(960, 160, 960, 1000, 700, 420);
    s = shot();
  }
  return false;
}

// 两屏内容差异(采样平均绝对差)
function screenDiff(a, b) {
  let s = 0, n = 0;
  for (let y = 160; y < 1000; y += 4) for (let x = 19; x < 1881; x += 4) {
    const p = px(a, x, y), q = px(b, x, y);
    s += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]); n++;
  }
  return s / n / 3;
}

// 两屏之间的纵向位移(内容上移 d 像素). 只在重叠区比较, 全宽采样抗噪
const VIEW_TOP = 165, VIEW_BOT = 1045;
function sadAt(A, B, d) {
  let s = 0, n = 0;
  for (let y = VIEW_TOP; y < VIEW_BOT; y += 2) {
    const ay = y + d;
    if (ay < VIEW_TOP || ay >= VIEW_BOT) continue;
    for (let x = 19; x < 1881; x += 6) {
      const a = px(A, x, ay), b = px(B, x, y);
      s += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      n++;
    }
  }
  return n > 400 ? s / n / 3 : 1e9;
}

function firstRowTop(img) {
  const tops = findRows(img, 118, 1000);
  return tops.length ? tops[0] : null;
}

/* 两屏之间的纵向位移(内容上移 d 像素)。
 * 坑: 行距 424 是周期性的, 纯 SAD 会锁到相邻行上, 报出一个假的 ~424
 * (奥鲁加就因此凭空多出一行重复)。所以先用两次截图里第一张完整卡片
 * 的行顶相位算出 d 的余数, 只在这个余数的 d / d+424 / d+848 三个候选里比 SAD。
 */
function bestShift(A, B) {
  if (screenDiff(A, B) < 3) return 0;
  const tp = firstRowTop(A), tc = firstRowTop(B);
  let cands;
  if (tp !== null && tc !== null) {
    const r = ((tp - tc) % PITCH + PITCH) % PITCH;
    cands = [r, r + PITCH, r + 2 * PITCH].filter(c => c >= 0 && c <= 1000);
  } else {
    cands = [];
    for (let c = 60; c <= 1000; c += 3) cands.push(c);
  }
  let best = null;
  for (const c of cands) {
    const v = sadAt(A, B, c);
    if (!best || v < best.v) best = { c, v };
  }
  return best ? best.c : 0;
}

function cropBand(img, y0, y1, x0 = 19, x1 = 1881) {
  if (y0 < 0 || y1 > img.h) return null;
  const h = y1 - y0, w = x1 - x0;
  const out = { w, h, data: Buffer.alloc(w * h * 4) };
  for (let y = 0; y < h; y++) img.data.copy(out.data, y * w * 4, ((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x1) * 4);
  return out;
}

// 把一张(可能是拼接出来的)高图里所有完整行的 舰名/消耗/航速 裁出来
function stripImage(img, yLo = VIEW[0], yHi = VIEW[1]) {
  const bands = [];
  for (const t of findRows(img, yLo, yHi)) {
    for (const key of ['name', 'vals']) {
      const b = cropBand(img, t + ROW_OFF[key][0], t + ROW_OFF[key][1]);
      if (b) bands.push(b);
    }
  }
  if (!bands.length) return null;
  const w = 1862, gap = 3;
  const totalH = bands.reduce((a, b) => a + b.h + gap, 0);
  const out = { w, h: totalH, data: Buffer.alloc(w * totalH * 4) };
  for (let i = 0; i < w * totalH; i++) out.data[i * 4 + 3] = 255;
  let y = 0;
  for (const b of bands) { b.data.copy(out.data, y * w * 4); y += b.h + gap; }
  return out;
}

/* 从当前位置(列表顶部)小步下滑, 每步测量真实位移。
 *
 * 为什么必须逐步测量, 而不是"滑一次就是两行":
 *   一张卡片要被完整读到, 它的行顶必须落在 [118,680] 这个 ~562px 宽的窗口里。
 *   实测位移在 300~848px 之间乱飘; 一旦某步 s>562 且 s 不是 424 的整数倍,
 *   就会有整行从未落进窗口 -> 整排漏掉(之前漏掉一整排航母就是这个原因)。
 *
 * 另外: 不做画布拼接。拼接的接缝会正好压在某一行的文字上(加上每步 1~2px 的
 * 测量误差累积), 把"消耗"那一行切掉。改成每一行都从"把它摆得最好"的那一屏里
 * 单独取——那就没有接缝问题。
 */
function captureWholeList(prefix, maxSteps = 40) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const shots = [];
  const first = shot(path.join(SHOTS, `${prefix}-00.png`));
  shots.push({ img: first.img, off: 0 });
  let off = 0, maxStep = 0, unsafe = 0;
  const steps = [];

  const step = (finger) => {
    swipe(960, 780, 960, 780 - finger, 700, 560);
    const n = shot(path.join(SHOTS, `${prefix}-${String(shots.length).padStart(2, '0')}.png`));
    return { d: bestShift(shots[shots.length - 1].img, n.img), img: n.img };
  };

  for (let i = 0; i < maxSteps; i++) {
    let r = step(240);
    if (r.d < 40) r = step(560);              // 小步没滚动也许只是没生效, 换大步确认是否真到底
    if (r.d < 40) break;
    if (r.d > 562) {
      const m = r.d % PITCH;
      if (Math.min(m, PITCH - m) > 30) unsafe++;
    }
    off += r.d; maxStep = Math.max(maxStep, r.d); steps.push(r.d);
    shots.push({ img: r.img, off });
  }

  return { shots, screens: shots.length, maxStep, unsafe, steps, total: off };
}

// 逐行从最合适的那一屏取带, 拼成一张读图
const ROW_TOP0 = 159;      // 列表第一行的行顶(屏幕坐标)
function stripFromShots(cap) {
  const { shots } = cap;
  const bands = [];
  const rowsInfo = [];
  for (let k = 0; ; k++) {
    const absTop = ROW_TOP0 + PITCH * k;
    let best = null;
    for (const s of shots) {
      const t = absTop - s.off;                 // 该行在这一屏里的行顶
      if (t < 118 || t > 680) continue;
      const d = Math.abs(t - 380);              // 越靠视口中部越稳
      if (!best || d < best.d) best = { img: s.img, t, d, off: s.off };
    }
    if (!best) break;
    let n = 0;
    for (let x = 30; x < 250; x += 2) {
      const [r, g, b] = px(best.img, x, best.t + 200);
      if ((r + g + b) / 3 < 90) n++;
    }
    if (n <= 50) break;                          // 这一行没有卡片了 -> 到底
    let cards = 0;
    for (const cx of COL_CX) {
      let d = 0;
      for (let dy = -30; dy <= 30; dy++) {
        const [r, g, b] = px(best.img, cx, best.t + 200 + dy);
        if ((r + g + b) / 3 < 90) d++;
      }
      if (d > 40) cards++;
    }
    rowsInfo.push({ k, cards });
    for (const key of ['name', 'vals']) {
      const b = cropBand(best.img, best.t + ROW_OFF[key][0], best.t + ROW_OFF[key][1]);
      if (b) bands.push(b);
    }
  }
  if (!bands.length) return { strip: null, rows: 0, cards: 0 };
  const w = 1862, gap = 4;
  const totalH = bands.reduce((a, b) => a + b.h + gap, 0);
  const out = { w, h: totalH, data: Buffer.alloc(w * totalH * 4) };
  for (let i = 0; i < w * totalH; i++) out.data[i * 4 + 3] = 255;
  let y = 0;
  for (const b of bands) { b.data.copy(out.data, y * w * 4); y += b.h + gap; }
  return { strip: out, rows: rowsInfo.length, cards: rowsInfo.reduce((a, r) => a + r.cards, 0), rowsInfo };
}

// 把一张 strip 竖着切成不超过 maxH 的几张读图
function emitStrip(st, prefix, maxH = 1500) {
  const outs = [];
  const gap = 10;
  for (let y0 = 0; y0 < st.h; y0 += maxH - gap) {
    const h = Math.min(maxH - gap, st.h - y0);
    const out = { w: st.w, h, data: Buffer.alloc(st.w * h * 4) };
    for (let i = 0; i < st.w * h; i++) out.data[i * 4 + 3] = 255;
    st.data.copy(out.data, 0, y0 * st.w * 4, (y0 + h) * st.w * 4);
    const p = path.join(PREV, `${prefix}-read-${outs.length}.png`).replace(/\\/g, '/');
    writePNG(p, out);
    outs.push(`${p} (${out.w}x${out.h})`);
  }
  return outs;
}

// ---------- CLI ----------
const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'state': { const s = shot(); console.log(stateOf(s), JSON.stringify(features(s.img))); break; }
  case 'sel': {
    let s = shot();
    if (!panelOpen(s)) { tap(1777, 70, 800); s = shot(); }
    for (let i = 0; i < 3 && !panelAtTop(s.img); i++) { swipe(200, 420, 200, 920, 350, 350); s = shot(); }
    console.log('舰种:', JSON.stringify(selectedTypes(s.img)));
    console.log('国籍:', JSON.stringify(selectedFactions(s.img)));
    break;
  }
  case 'tapbtn': {
    const kind = rest[0] === 'faction' ? 'faction' : 'shiptype';
    const selOf = kind === 'shiptype' ? selectedTypes : selectedFactions;
    const btn = kind === 'shiptype' ? shiptypeBtn : factionBtn;
    const times = Number(rest[2] || 1);
    let s = shot();
    if (!panelOpen(s)) { tap(1777, 70, 800); s = shot(); }
    for (let i = 0; i < 3 && !panelAtTop(s.img); i++) { swipe(200, 420, 200, 920, 350, 350); s = shot(); }
    const p = btn(rest[1]);
    console.log(`点前:`, JSON.stringify(selOf(s.img)));
    for (let i = 0; i < times; i++) { tap(p.x, p.y, 800); s = shot(); console.log(`第${i + 1}次:`, JSON.stringify(selOf(s.img))); }
    break;
  }
  case 'one': {
    // one <kind> <name> <prefix>
    const [kind, name, prefix] = rest;
    const r = setFilter(kind, name);
    if (!r.ok) { console.log(`	setFilter ${kind}/${name} FAIL: ${r.why}`); process.exit(2); }
    const top = goTop();
    const cap = captureWholeList(prefix);
    const res = stripFromShots(cap);
    if (!res.strip) { console.log(`${name}: 回顶=${top} 屏数=${cap.screens} 行数=0 (空列表或不是数值视图)`); break; }
    const outs = emitStrip(res.strip, prefix);
    console.log(`${name}: 回顶=${top} 屏数=${cap.screens} 行数=${res.rows} 卡片数=${res.cards} 步长[${cap.steps.join(',')}] 不安全=${cap.unsafe}`);
    for (const o of outs) console.log('  读图 ' + o);
    break;
  }
  case 'sweep': {
    // sweep <kind> <name1,name2,...>
    const kind = rest[0];
    const names = rest[1].split(',').map(s => s.trim()).filter(Boolean);
    const t0 = Date.now();
    for (const name of names) {
      const prefix = `${kind === 'shiptype' ? 't' : 'f'}_${name}`;
      const r = setFilter(kind, name);
      if (!r.ok) { console.log(`[${name}] setFilter FAIL: ${r.why}`); continue; }
      const top = goTop();
      const cap = captureWholeList(prefix);
      const res = stripFromShots(cap);
      const warn = cap.unsafe ? '  ⚠有 ' + cap.unsafe + ' 步可能漏行' : '';
      if (!res.strip) { console.log(`[${name}] 回顶=${top} 屏数=${cap.screens} 行数=0 (空列表?)  ${((Date.now() - t0) / 1000).toFixed(0)}s${warn}`); continue; }
      const outs = emitStrip(res.strip, prefix);
      console.log(`[${name}] 回顶=${top} 屏数=${cap.screens} 行数=${res.rows} 卡片数=${res.cards} 步长[${cap.steps.join(',')}] ${((Date.now() - t0) / 1000).toFixed(0)}s${warn}`);
      for (const o of outs) console.log('   读图 ' + o);
    }
    console.log(`全部用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    break;
  }
  case 'strip': {
    const img = readPNG(rest[0]);
    const yLo = rest[2] === undefined ? 20 : Number(rest[2]);
    const yHi = rest[3] === undefined ? img.h : Number(rest[3]);
    const st = stripImage(img, yLo, yHi);
    if (!st) { console.log('no rows'); break; }
    writePNG(rest[1], st);
    console.log(`${rest[0]} -> ${rest[1]} ${st.w}x${st.h} (行数 ${findRows(img, yLo, yHi).length})`);
    break;
  }
  case 'rows': console.log(findRows(readPNG(rest[0])).join(', ')); break;
  case 'mode': {
    // mode <TYPE序号, 1..5>  打开属性下拉并选第 n 项, 然后存一张卡片局部图供确认
    const n = Number(rest[0] || 2);
    for (let a = 0; a < 4; a++) {
      let s = shot();
      const items = findDropdownItems(s.img);
      if (items.length >= n) { tap(1296, items[n - 1], 900); break; }
      tap(1410, 70, 900);   // 打开下拉
    }
    const s = shot();
    fs.writeFileSync(path.join(PREV, '_mode.png').replace(/\\/g, '/'), s.buf);
    console.log('状态:', stateOf(s), '下拉项:', findDropdownItems(s.img).join(','));
    console.log('已存 preview/_mode.png (左上第一张卡片)');
    break;
  }
  case 'close': console.log(closePanel() ? 'closed' : 'STILL OPEN'); break;
  case 'panelshot': {
    // 打开筛选 + 盲滑到顶, 存图并打印各行的按钮/蓝色分布
    let s = shot();
    if (!panelOpen(s)) { tap(1777, 70, 800); s = shot(); }
    for (let i = 0; i < 4; i++) { swipe(200, 400, 200, 900, 350, 300); s = shot(); }
    const out = rest[0] || path.join(PREV, '_panel.png');
    fs.writeFileSync(out, s.buf);
    console.log('saved', out, 'atTop=', panelAtTop(s.img));
    for (const y of [204, 273, 373, 442, 547, 634, 703, 803, 895]) {
      const runs = [];
      let cur = null;
      for (let x = 320; x < 1830; x++) {
        const [r, g, b] = px(s.img, x, y);
        const kind = (b > 140 && b - r > 50 && g - r > 30) ? 'B' : (r > 190 && g > 190 && b > 190 ? 'L' : '.');
        if (!cur || cur.k !== kind) { if (cur && cur.n > 15) runs.push(cur.k + cur.x0 + '-' + cur.x1); cur = { k: kind, x0: x, x1: x, n: 1 }; }
        else { cur.x1 = x; cur.n++; }
      }
      if (cur && cur.n > 15) runs.push(cur.k + cur.x0 + '-' + cur.x1);
      console.log(`  y=${y}: ${runs.join(' ')}`);
    }
    break;
  }
  default: console.log('unknown cmd: ' + cmd);
}
