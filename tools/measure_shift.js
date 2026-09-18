/* 稳健的纵向位移测量: 内容上移 d 表示 B(y) ≈ A(y+d)
 * 用法: node tools/measure_shift.js <a.png> <b.png> [x0] [x1]
 * 只在重叠区比较, 并用全宽多列采样, 抗噪
 */
const { readPNG, px } = require('./png.js');

function bestShift(A, B, x0, x1) {
  const yLo = 165, yHi = 1045;
  const score = (d) => {
    let s = 0, n = 0;
    for (let y = yLo; y < yHi; y += 2) {
      const ay = y + d;
      if (ay < yLo || ay >= yHi) continue;
      for (let x = x0; x < x1; x += 6) {
        const a = px(A, x, ay), b = px(B, x, y);
        s += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        n++;
      }
    }
    return n > 500 ? s / n / 3 : 1e9;
  };
  const coarse = [];
  for (let d = 100; d <= 1000; d += 3) coarse.push([d, score(d)]);
  coarse.sort((p, q) => p[1] - q[1]);
  const fine = [];
  for (const [d0] of coarse.slice(0, 3)) for (let d = d0 - 3; d <= d0 + 3; d++) fine.push([d, score(d)]);
  fine.sort((p, q) => p[1] - q[1]);
  return fine.slice(0, 3);
}

const [a, b, xs, xe] = process.argv.slice(2);
const A = readPNG(a), B = readPNG(b);
for (const [d, s] of bestShift(A, B, xs ? +xs : 19, xe ? +xe : 1881)) {
  console.log(`d=${String(d).padStart(4)}px  = ${(d / 424).toFixed(2)} 行   sad=${s.toFixed(2)}`);
}
