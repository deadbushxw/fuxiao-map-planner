/* 地图渲染 + 交互
 *
 * 用 SVG 按游戏内的真实坐标绘制（坐标系取地图数据的 screen，缺省 1920x1080），
 * 所以网页上的布局和游戏里一致。
 * 每次状态变化整体重绘 —— 节点只有 20 个，重绘成本可以忽略，换来代码简单可预测。
 *
 * 交互:
 *   点可达节点 -> 延伸路线
 *   点路线末端的上一个节点 -> 退回一步
 *   点不可达节点 -> 不改动路线，提示当前能去哪
 */
(function (root) {
  'use strict';
  var FX = root.FX = root.FX || {};
  var SVGNS = 'http://www.w3.org/2000/svg';

  var COLOR = {
    start:  { fill: '#9fd8ff', stroke: '#e8f6ff' },
    battle: { fill: '#6fd3ff', stroke: '#d6f2ff' },
    supply: { fill: '#8ce06f', stroke: '#e2ffd8' },
    boss:   { fill: '#e2405a', stroke: '#ffd0d8' }
  };

  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /** 正六边形顶点：顶点在左右两侧，上下各一条平边（和游戏图标一致） */
  function hexPoints(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i);
      pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  function drawSkull(g, cx, cy, r, col) {
    el('circle', { cx: cx, cy: cy - r * 0.22, r: r * 0.78, fill: col.fill, stroke: col.stroke, 'stroke-width': 2 }, g);
    el('rect', { x: cx - r * 0.42, y: cy + r * 0.34, width: r * 0.84, height: r * 0.5, rx: r * 0.16,
                 fill: col.fill, stroke: col.stroke, 'stroke-width': 2 }, g);
    var eye = r * 0.24;
    el('ellipse', { cx: cx - r * 0.3, cy: cy - r * 0.28, rx: eye, ry: eye * 1.15, fill: '#2a0a12' }, g);
    el('ellipse', { cx: cx + r * 0.3, cy: cy - r * 0.28, rx: eye, ry: eye * 1.15, fill: '#2a0a12' }, g);
  }

  function drawCan(g, cx, cy, r, col) {
    el('rect', { x: cx - r * 0.62, y: cy - r * 0.5, width: r * 1.24, height: r * 1.15, rx: r * 0.2,
                 fill: col.fill, stroke: col.stroke, 'stroke-width': 2 }, g);
    el('rect', { x: cx - r * 0.28, y: cy - r * 0.78, width: r * 0.56, height: r * 0.3, rx: r * 0.08,
                 fill: col.fill, stroke: col.stroke, 'stroke-width': 2 }, g);
    el('path', {
      d: 'M ' + cx + ' ' + (cy - r * 0.24) + ' q ' + (r * 0.34) + ' ' + (r * 0.42) + ' 0 ' + (r * 0.62) +
         ' q ' + (-r * 0.34) + ' ' + (-r * 0.2) + ' 0 ' + (-r * 0.62) + ' z',
      fill: '#2b3a18'
    }, g);
  }

  /* 弹药点：金色子弹。游戏里油点是绿色油罐、弹药点是金色子弹，这里跟着游戏走，
   * 用颜色把两类「补给点」分开。纯内联 SVG，不引图片，file:// 下一样能用。 */
  var AMMO_COLOR = { fill: '#ffd24a', stroke: '#fff3c4' };

  function drawBullet(g, cx, cy, r) {
    var col = AMMO_COLOR;
    // 弹头（上）
    el('path', {
      d: 'M ' + cx + ' ' + (cy - r * 0.94) +
         ' L ' + (cx + r * 0.33) + ' ' + (cy - r * 0.28) +
         ' L ' + (cx - r * 0.33) + ' ' + (cy - r * 0.28) + ' z',
      fill: col.fill, stroke: col.stroke, 'stroke-width': 2, 'stroke-linejoin': 'round'
    }, g);
    // 弹体（下）
    el('rect', { x: cx - r * 0.33, y: cy - r * 0.28, width: r * 0.66, height: r * 0.74,
                 fill: col.fill, stroke: col.stroke, 'stroke-width': 2 }, g);
    // 弹壳底缘
    el('rect', { x: cx - r * 0.42, y: cy + r * 0.42, width: r * 0.84, height: r * 0.2, rx: r * 0.05,
                 fill: col.fill, stroke: col.stroke, 'stroke-width': 2 }, g);
  }

  /* 回血点：绿色爱心 + 右下角「+」。游戏里油点是绿色油罐、弹药点是金色子弹、
   * 回血点是爱心 —— 三类在游戏里都叫「补给点」，这里跟着游戏用图标区分。 */
  function drawHeal(g, cx, cy, r, col) {
    el('path', {
      d: 'M ' + cx + ' ' + (cy + r * 0.78) +
         ' C ' + (cx - r * 1.05) + ' ' + (cy - r * 0.10) + ' ' +
                 (cx - r * 0.60) + ' ' + (cy - r * 0.85) + ' ' +
                 cx + ' ' + (cy - r * 0.26) +
         ' C ' + (cx + r * 0.60) + ' ' + (cy - r * 0.85) + ' ' +
                 (cx + r * 1.05) + ' ' + (cy - r * 0.10) + ' ' +
                 cx + ' ' + (cy + r * 0.78) + ' z',
      fill: col.fill, stroke: col.stroke, 'stroke-width': 3, 'stroke-linejoin': 'round'
    }, g);
    var bx = cx + r * 0.62, by = cy + r * 0.52, br = r * 0.36;
    el('circle', { cx: bx, cy: by, r: br, fill: col.fill, stroke: col.stroke, 'stroke-width': 3 }, g);
    var t = r * 0.09, len = r * 0.22;
    el('rect', { x: bx - t, y: by - len, width: t * 2, height: len * 2, fill: '#eaffdf' }, g);
    el('rect', { x: bx - len, y: by - t, width: len * 2, height: t * 2, fill: '#eaffdf' }, g);
  }

  function drawPin(g, cx, cy, r, col) {
    el('circle', { cx: cx, cy: cy - r * 0.3, r: r * 0.55, fill: col.fill, stroke: col.stroke, 'stroke-width': 2 }, g);
    el('path', {
      d: 'M ' + (cx - r * 0.34) + ' ' + (cy + r * 0.05) + ' L ' + cx + ' ' + (cy + r * 0.85) +
         ' L ' + (cx + r * 0.34) + ' ' + (cy + r * 0.05) + ' z',
      fill: col.fill, stroke: col.stroke, 'stroke-width': 2
    }, g);
  }

  function drawNodeShape(g, node, cx, cy, r) {
    var col = COLOR[node.type] || COLOR.battle;
    if (node.type === 'boss') return drawSkull(g, cx, cy, r, col);
    if (node.type === 'supply') {
      var sk = FX.graph && FX.graph.supplyKind ? FX.graph.supplyKind(node) : 'fuel';
      if (sk === 'ammo') return drawBullet(g, cx, cy, r);
      if (sk === 'heal') return drawHeal(g, cx, cy, r, col);
      return drawCan(g, cx, cy, r, col);
    }
    if (node.type === 'start') return drawPin(g, cx, cy, r, col);
    el('polygon', { points: hexPoints(cx, cy, r), fill: 'none', stroke: col.stroke, 'stroke-width': 7 }, g);
    el('polygon', { points: hexPoints(cx, cy, r * 0.82), fill: 'none', stroke: col.fill, 'stroke-width': 5 }, g);
  }

  function describe(node, map, isVisited, mapMode) {
    var lines = [node.label + '（' + typeLabel(node.type) + '）' + (isVisited ? ' ✅已通过' : '')];
    if (node.type === 'boss') {
      var armors = FX.graph && FX.graph.armorList ? FX.graph.armorList(node) : (node.armor ? [node.armor] : []);
      var bn = FX.graph && FX.graph.bossTotal ? FX.graph.bossTotal(node) : 0;
      lines.push('装甲: ' + (armors.join('+') || '?') + (bn > 1 ? '（' + bn + ' 个 BOSS）' : '') + '  LV.' + (node.lv || '?'));
    }
    // 补给点按效果分三类（油点 / 弹药点 / 回血点），游戏里都叫「补给点」，靠图标与效果文本区分
    if (node.type === 'supply') {
      var se = node.effect;
      var sk = FX.graph && FX.graph.supplyKind ? FX.graph.supplyKind(node) : ((se && se.kind) || 'fuel');
      if (!se) lines.push('补给点');
      else if (sk === 'fuel') lines.push('可取得 ' + se.percent + '% 燃料');
      else if (sk === 'ammo') lines.push((se.raw || '弹药-1') + '（经过它要扣 1 发弹药：该点前一个战斗节点的出战队伍少一次作战次数）');
      else lines.push(se.raw || '补给点');
    }
    (node.next || []).forEach(function (e) {
      lines.push('→ ' + e.to + '：' + (e.raw || '') + (e.prob ? '（概率 ' + e.prob + '）' : ''));
    });
    if (!(node.next || []).length) lines.push('（终点，无后续）');
    // 「金色非UP掉落」是限时活动的 UP 机制才有的概念；档案没有掉落加成，不提示
    if (node.polluted && mapMode !== 'archive') lines.push('⚠ 已标记：有金色非UP掉落（污染）');
    return lines.join('\n');
  }

  function typeLabel(t) {
    return { start: '起点', battle: '战斗点', boss: 'BOSS点', supply: '补给点' }[t] || t;
  }

  /**
   * 渲染地图。
   * opts: { routeNodes, analysis, reachable:Set, onNodeClick }
   */
  function render(host, map, opts) {
    opts = opts || {};
    var routeNodes = opts.routeNodes || [map.start];
    var analysis = opts.analysis;
    var reachable = opts.reachable || {};
    var onPath = {};
    routeNodes.forEach(function (id) { onPath[id] = true; });

    host.innerHTML = '';
    // 地图坐标系取数据里的 screen（游戏内截图尺寸，缺省 1920x1080）。
    // 不同设备/模拟器的横屏分辨率不一样（例如手机 2316x1080），按各自的原生尺寸画，
    // 节点坐标才和游戏画面一一对应，拖截图识别时也才采样得准。
    var SW = (map.screen && map.screen.w) || 1920, SH = (map.screen && map.screen.h) || 1080;
    var svg = el('svg', { viewBox: '0 0 ' + SW + ' ' + SH, class: 'fx-map' }, host);

    // 背景网格
    var defs = el('defs', {}, svg);
    var pat = el('pattern', { id: 'grid', width: 80, height: 80, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M 80 0 L 0 0 0 80', fill: 'none', stroke: '#1d3c56', 'stroke-width': 1.5 }, pat);
    el('rect', { x: 0, y: 0, width: SW, height: SH, fill: '#0d2135' }, svg);
    el('rect', { x: 0, y: 0, width: SW, height: SH, fill: 'url(#grid)' }, svg);

    // 边
    var edgeLayer = el('g', {}, svg);
    Object.keys(map.nodes).forEach(function (id) {
      var a = map.nodes[id];
      (a.next || []).forEach(function (e) {
        var b = map.nodes[e.to];
        if (!b) return;
        var isPath = onPath[id] && onPath[e.to] &&
                     routeNodes.indexOf(e.to) === routeNodes.indexOf(id) + 1;
        el('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          stroke: isPath ? '#ffd633' : '#7f95a8',
          'stroke-width': isPath ? 8 : 4,
          'stroke-dasharray': isPath ? '' : '14 10',
          'stroke-linecap': 'round',
          opacity: isPath ? 1 : 0.55
        }, edgeLayer);
      });
    });

    // 节点
    var nodeLayer = el('g', {}, svg);
    Object.keys(map.nodes).forEach(function (id) {
      var n = map.nodes[id];
      var isVisited = !!(opts.visited && opts.visited[id]);
      var g = el('g', {
        class: 'fx-node' + (onPath[id] ? ' on-path' : '') + (reachable[id] ? ' reachable' : '') +
               (isVisited ? ' visited' : '') + (opts.pending && opts.pending[id] ? ' pending' : '')
      }, nodeLayer);
      g.setAttribute('data-node', id);
      g.style.cursor = 'pointer';
      if (isVisited) g.setAttribute('opacity', '0.34');

      if (reachable[id] && !onPath[id]) {
        el('circle', { cx: n.x, cy: n.y, r: 40, fill: 'none', stroke: '#ffd633',
                       'stroke-width': 3, 'stroke-dasharray': '8 7', opacity: 0.9 }, g);
      }

      // 扩大点击判定范围到「可去」时那个黄色虚线圈那么大（r=40），
      // 这样圆圈内的空白处也能点中，不用精确戳到六边形/骷髅上。
      // 用 fill=transparent + pointer-events=all：fill="none" 是不接收指针事件的。
      el('circle', { cx: n.x, cy: n.y, r: 40, fill: 'transparent', 'pointer-events': 'all' }, g);

      drawNodeShape(g, n, n.x, n.y, 26);

      // 还没通过、且规划里仍需覆盖的节点：左上角一个橙点
      if (opts.pending && opts.pending[id]) {
        el('circle', { cx: n.x - 30, cy: n.y - 30, r: 10, fill: '#ff9b3d',
                       stroke: '#3a1f06', 'stroke-width': 2 }, g);
      }

      var labelColor = onPath[id] ? '#ffe680' : '#dfe9f2';
      var t = el('text', {
        x: n.x, y: n.y - 38, 'text-anchor': 'middle',
        'font-size': 34, 'font-weight': 'bold',
        fill: labelColor, stroke: '#0a1a2a', 'stroke-width': 5, 'paint-order': 'stroke'
      }, g);
      t.textContent = n.label;

      // 出战序号 / 油点说明
      if (analysis && onPath[id]) {
        var bi = analysis.battleIndex[id];
        if (bi) {
          el('circle', { cx: n.x + 30, cy: n.y - 30, r: 17, fill: '#ffd633', stroke: '#2a2000', 'stroke-width': 2 }, g);
          var bt = el('text', { x: n.x + 30, y: n.y - 24, 'text-anchor': 'middle',
                                'font-size': 22, 'font-weight': 'bold', fill: '#2a2000' }, g);
          bt.textContent = bi;
        }
        var op = analysis.oilPoints.filter(function (o) { return o.node === id; })[0];
        if (op) {
          var ot = el('text', { x: n.x, y: n.y + 58, 'text-anchor': 'middle', 'font-size': 26,
                                'font-weight': 'bold', fill: '#8ce06f',
                                stroke: '#0a1a2a', 'stroke-width': 5, 'paint-order': 'stroke' }, g);
          ot.textContent = '第' + op.afterBattle + '战后';
        }
        // 弹药点：同一套位置显示「弹药-1」，颜色跟着子弹走
        var ap = (analysis.ammoPoints || []).filter(function (o) { return o.node === id; })[0];
        if (ap) {
          var at = el('text', { x: n.x, y: n.y + 58, 'text-anchor': 'middle', 'font-size': 26,
                                'font-weight': 'bold', fill: '#ffd24a',
                                stroke: '#0a1a2a', 'stroke-width': 5, 'paint-order': 'stroke' }, g);
          at.textContent = '弹药-1';
        }
      }

      var title = el('title', {}, g);
      title.textContent = describe(n, map, isVisited, opts.mapMode);
      g.addEventListener('click', function (ev) {
        // Shift+点击 切换"已通过"，普通点击延伸路线
        if (ev.shiftKey) { opts.onToggleVisited && opts.onToggleVisited(id); return; }
        opts.onNodeClick && opts.onNodeClick(id);
      });
    });

    return svg;
  }

  FX.mapUi = { render: render, COLOR: COLOR, typeLabel: typeLabel };
})(typeof window !== 'undefined' ? window : globalThis);
