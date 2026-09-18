/* 判断当前截图是哪个界面, 让批量脚本每步先确认状态再动作（避免盲点）。
 * 用法: node tools/screen.js <png>
 * 输出: dock-stats | dock-cards | filter | detail | unknown  + 诊断数字
 *
 * 依据:
 *   dock 顶栏有一块「属性」实心青色按钮 (~x1192-1387, y48-93)
 *   filter 面板是中央一大片浅灰按钮区
 *   dock-stats 卡片区域整体很暗; dock-cards(TYPE1) 卡片上半是亮立绘
 *   detail 左侧是大立绘 + 右下各项数值
 */
const { readPNG, px } = require('./png.js');

const file = process.argv[2];
const img = readPNG(file);

function countCyan(x0, y0, x1, y1) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [r, g, b] = px(img, x, y);
    if (g > 150 && b > 150 && r < 130 && b - r > 60) n++;
  }
  return n;
}
function countLight(x0, y0, x1, y1) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [r, g, b] = px(img, x, y);
    if (r > 200 && g > 200 && b > 200) n++;
  }
  return n;
}
// 卡片内部亮度（第一列第一行卡片的数值区, 排除了立绘)
function meanLum(x0, y0, x1, y1) {
  let s = 0, n = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const [r, g, b] = px(img, x, y); s += (r + g + b) / 3; n++;
  }
  return s / n;
}
// 卡片顶部立绘区亮度 (TYPE1 高, TYPE2 低)
const artLum = meanLum(40, 200, 250, 480);

const cyanTop = countCyan(1192, 48, 1387, 93);
const lightCenter = countLight(350, 200, 1700, 850);

let state;
if (lightCenter > 120000) state = 'filter';
else if (cyanTop > 2500) state = artLum > 75 ? 'dock-cards' : 'dock-stats';
else state = 'detail';

console.log(`${state}  (cyanTop=${cyanTop} lightCenter=${lightCenter} artLum=${artLum.toFixed(1)})  ${file}`);
