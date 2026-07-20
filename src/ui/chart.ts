// A small multi-series line chart. It draws the two real work-factor curves
// (Prange and Stern) against the hint count, the polynomial floor, a vertical
// marker at the current hint count, and any measured dots from real runs. It
// illuminates the mechanism and redraws only on interaction — never idle motion.

import { svg } from './dom';

export interface Series {
  cls: string;
  points: [number, number][]; // [hints, bits]
}
export interface Marker {
  x: number;
  y: number;
  cls: string;
}
export interface HLine {
  y: number;
  cls: string;
}
export interface ChartSpec {
  xMax: number;
  yMax: number;
  xLabel: string;
  series: Series[];
  hlines?: HLine[];
  markers?: Marker[];
  vline?: number;
}

const W = 640;
const H = 280;
const PAD_L = 48;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 42;

export function drawChart(spec: ChartSpec): SVGElement {
  const xMax = spec.xMax || 1;
  const yMax = spec.yMax * 1.08 + 0.5;
  const x = (h: number) => PAD_L + (h / xMax) * (W - PAD_L - PAD_R);
  const y = (b: number) => H - PAD_B - (b / yMax) * (H - PAD_T - PAD_B);

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    role: 'img',
    'aria-labelledby': 'work-chart-cap work-chart-desc',
    preserveAspectRatio: 'xMidYMid meet',
  });

  root.append(
    svg('line', { class: 'axis-line', x1: PAD_L, y1: PAD_T, x2: PAD_L, y2: H - PAD_B }),
    svg('line', { class: 'axis-line', x1: PAD_L, y1: H - PAD_B, x2: W - PAD_R, y2: H - PAD_B }),
  );

  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const b = (yMax / yTicks) * i;
    const yy = y(b);
    root.append(
      svg('line', { class: 'axis-line', x1: PAD_L - 4, y1: yy, x2: PAD_L, y2: yy }),
      text(PAD_L - 8, yy + 3, b.toFixed(0), 'end'),
    );
  }
  const xStep = Math.max(1, Math.round(xMax / 6));
  for (let h = 0; h <= xMax; h += xStep) root.append(text(x(h), H - PAD_B + 16, String(h), 'middle'));
  root.append(text((W + PAD_L) / 2, H - 6, spec.xLabel, 'middle'));
  root.append(text(14, PAD_T + 6, 'log₂ ops', 'start'));

  // Current-hint vertical marker.
  if (spec.vline != null) {
    root.append(
      svg('line', { class: 'vline', x1: x(spec.vline), y1: PAD_T, x2: x(spec.vline), y2: H - PAD_B }),
    );
  }

  for (const hl of spec.hlines ?? []) {
    root.append(svg('line', { class: hl.cls, x1: PAD_L, y1: y(hl.y), x2: W - PAD_R, y2: y(hl.y) }));
  }

  for (const s of spec.series) {
    const d = s.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`)
      .join(' ');
    root.append(svg('path', { class: s.cls, d }));
  }

  for (const m of spec.markers ?? []) {
    root.append(svg('circle', { class: m.cls, cx: x(m.x), cy: y(m.y), r: 5 }));
  }

  return root;
}

function text(x: number, y: number, str: string, anchor: string): SVGElement {
  const t = svg('text', { x, y, 'text-anchor': anchor, 'font-size': 11 });
  t.textContent = str;
  return t;
}
