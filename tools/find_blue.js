/* 在截图里找出「被选中」的蓝色按钮矩形, 输出设备像素坐标。
 * 用途: 标定筛选面板按钮位置, 便于 adb tap 精确点击。
 * 用法: node tools/find_blue.js <png> [minW] [minH]
 */
const { readPNG, px } = require('./png.js');

const file = process.argv[2];
const minW = Number(process.argv[3] || 60);
const minH = Number(process.argv[4] || 30);
const img = readPNG(file);

const isBlue = (x, y) => {
  const [r, g, b] = px(img, x, y);
  return b > 140 && b - r > 50 && g - r > 30;
};

let active = []; // {x0,x1,minY,maxY}
const boxes = [];
for (let y = 0; y < img.h; y++) {
  const runs = [];
  let start = -1;
  for (let x = 0; x < img.w; x++) {
    if (isBlue(x, y)) { if (start < 0) start = x; }
    else { if (start >= 0 && x - start > 20) runs.push([start, x - 1]); start = -1; }
  }
  if (start >= 0 && img.w - start > 20) runs.push([start, img.w - 1]);

  const next = [];
  const used = new Set();
  for (const r of runs) {
    const hit = active.find(a => !used.has(a) && !(r[1] < a.x0 - 3 || r[0] > a.x1 + 3));
    if (hit) {
      used.add(hit);
      hit.x0 = Math.min(hit.x0, r[0]); hit.x1 = Math.max(hit.x1, r[1]);
      hit.maxY = y;
      next.push(hit);
    } else next.push({ x0: r[0], x1: r[1], minY: y, maxY: y });
  }
  for (const a of active) if (!used.has(a)) boxes.push(a);
  active = next;
}
boxes.push(...active);

const out = boxes
  .filter(b => (b.x1 - b.x0 + 1) >= minW && (b.maxY - b.minY + 1) >= minH)
  .map(b => ({ x0: b.x0, x1: b.x1, y0: b.minY, y1: b.maxY,
               cx: Math.round((b.x0 + b.x1) / 2), cy: Math.round((b.minY + b.maxY) / 2),
               w: b.x1 - b.x0 + 1, h: b.maxY - b.minY + 1 }))
  .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

console.log(`${file}: ${out.length} 个蓝色矩形 (${img.w}x${img.h})`);
for (const b of out) console.log(`  box x=${b.x0}..${b.x1} y=${b.y0}..${b.y1}  中心(${b.cx},${b.cy})  ${b.w}x${b.h}`);
