/* 裁剪/放大/拼图 CLI，替代 crop_grid.ps1 / compose_rows.ps1（纯 node，设备像素坐标）
 *
 *   node tools/crop.js <src.png> <out.png> <x0> <y0> <x1> <y1> [scale] [gridStep]
 *   node tools/crop.js --stack <out.png> <scale> <src1.png:x0,y0,x1,y1> [src2.png:...] ...
 *
 * gridStep > 0 时叠加设备像素网格（红线 + 黄色坐标数字）。
 */
const { readPNG, writePNG, crop } = require('./png.js');

function withGrid(img, step, x0, y0, scale) {
  if (!step) return img;
  const draw = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const i = (y * img.w + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
  };
  const firstX = Math.ceil(x0 / step) * step;
  for (let dx = firstX; dx < x0 + img.w / scale; dx += step) {
    const px = (dx - x0) * scale;
    for (let y = 0; y < img.h; y++) draw(Math.round(px), y, 255, 40, 40);
  }
  const firstY = Math.ceil(y0 / step) * step;
  for (let dy = firstY; dy < y0 + img.h / scale; dy += step) {
    const py = (dy - y0) * scale;
    for (let x = 0; x < img.w; x++) draw(x, Math.round(py), 255, 40, 40);
  }
  return img;
}

// 3x5 点阵数字，给网格标坐标（省得依赖字体）
const GLYPH = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  '-': ['000', '000', '111', '000', '000'], ',': ['000', '000', '000', '010', '100'],
};
function drawText(img, text, x, y, scale) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPH[ch];
    if (g) {
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r][c] === '1') {
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
            const px = cx + c * scale + dx, py = y + r * scale + dy;
            if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
            const i = (py * img.w + px) * 4;
            img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 0;
          }
        }
      }
    }
    cx += 4 * scale;
  }
}

function labelGrid(img, step, x0, y0, scale) {
  if (!step) return img;
  const ts = Math.max(1, Math.round(scale));
  for (let dx = Math.ceil(x0 / step) * step; dx < x0 + img.w / scale; dx += step) {
    const px = Math.round((dx - x0) * scale);
    drawText(img, String(dx), px + 2, 2, ts);
  }
  for (let dy = Math.ceil(y0 / step) * step; dy < y0 + img.h / scale; dy += step) {
    const py = Math.round((dy - y0) * scale);
    drawText(img, String(dy), 2, py + 2, ts);
  }
  return img;
}

const args = process.argv.slice(2);
if (args[0] === '--stack') {
  const [, out, scaleS, ...specs] = args;
  const scale = Number(scaleS || 1);
  const bands = specs.map(s => {
    const [file, box] = s.split(':');
    const [x0, y0, x1, y1] = box.split(',').map(Number);
    return crop(readPNG(file), x0, y0, x1, y1, scale);
  });
  const w = Math.max(...bands.map(b => b.w));
  const gap = 6, totalH = bands.reduce((a, b) => a + b.h + gap, 0);
  const outImg = { w, h: totalH, data: Buffer.alloc(w * totalH * 4) };
  for (let i = 0; i < w * totalH; i++) outImg.data[i * 4 + 3] = 255;
  let y = 0;
  for (const b of bands) { b.data.copy(outImg.data, y * w * 4); y += b.h + gap; }
  writePNG(out, outImg);
  console.log(`stacked ${bands.length} bands (scale ${scale}) -> ${out} ${outImg.w}x${outImg.h}`);
} else {
  const [src, out, x0, y0, x1, y1, scaleS, stepS] = args;
  const scale = Number(scaleS || 1);
  const step = Number(stepS || 0);
  const img = crop(readPNG(src), +x0, +y0, +x1, +y1, scale);
  withGrid(img, step, +x0, +y0, scale);
  labelGrid(img, step, +x0, +y0, scale);
  writePNG(out, img);
  console.log(`crop (${x0},${y0})-(${x1},${y1}) scale=${scale} step=${step} -> ${out} ${img.w}x${img.h}`);
}
