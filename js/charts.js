/* TimeTracker — hand-rolled SVG charts: stacked bars, donut, heatmap, trend line */
"use strict";

/* ---------- Tooltip ---------- */
function showTip(html, evt) {
  const tip = document.getElementById("tooltip");
  tip.innerHTML = html;
  tip.classList.remove("hidden");
  moveTip(evt);
}
function moveTip(evt) {
  const tip = document.getElementById("tooltip");
  const pad = 14;
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  const r = tip.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
function hideTip() {
  document.getElementById("tooltip").classList.add("hidden");
}

function attachTip(el, htmlFn) {
  el.addEventListener("mouseenter", e => showTip(htmlFn(), e));
  el.addEventListener("mousemove", moveTip);
  el.addEventListener("mouseleave", hideTip);
}

/* ---------- SVG helpers ---------- */
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function svgText(x, y, str, attrs = {}) {
  const t = svgEl("text", { x, y, ...attrs });
  t.textContent = str;
  return t;
}

/* Rect with only the top corners rounded (bar caps: round at data end, square at baseline) */
function roundedTopRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/* Clean y-axis: pick a tick step so there are 3–5 ticks */
function niceTicks(maxVal) {
  const max = Math.max(maxVal, 1);
  for (const step of [0.5, 1, 2, 3, 4, 5, 10, 20, 40, 80]) {
    if (max / step <= 5) {
      const top = Math.ceil(max / step) * step;
      const ticks = [];
      for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
      return { top, ticks };
    }
  }
  return { top: max, ticks: [0, max] };
}

/* ================= Stacked bar chart =================
   bars: [{ label, tipTitle, total, segments: [{ name, color, hours }] }] */
function renderStackedBars(host, bars) {
  host.innerHTML = "";
  const totalAll = bars.reduce((s, b) => s + b.total, 0);
  if (!totalAll) {
    host.innerHTML = `<div class="chart-empty">No time tracked in this range.</div>`;
    return;
  }

  const W = 820, H = 240;
  const m = { l: 42, r: 8, t: 20, b: 26 };
  const plotW = W - m.l - m.r, plotH = H - m.t - m.b;
  const { top, ticks } = niceTicks(Math.max(...bars.map(b => b.total)));
  const yOf = v => m.t + plotH - (v / top) * plotH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Hours per day, stacked by project" });

  // gridlines + y labels
  for (const v of ticks) {
    const y = yOf(v);
    svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: v === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }));
    svg.appendChild(svgText(m.l - 8, y + 3.5, `${v}h`, { "text-anchor": "end" }));
  }

  const slot = plotW / bars.length;
  const barW = Math.min(24, Math.max(4, slot * 0.55));
  const showCapLabels = bars.length <= 10;
  const labelEvery = bars.length <= 10 ? 1 : Math.ceil(bars.length / 12);

  bars.forEach((bar, i) => {
    const x = m.l + slot * i + (slot - barW) / 2;
    const segs = bar.segments.filter(s => s.hours > 0);
    let acc = 0;
    segs.forEach((seg, si) => {
      const yTop = yOf(acc + seg.hours);
      const yBot = yOf(acc);
      const isTop = si === segs.length - 1;
      // 2px surface gaps between touching segments
      const gapTop = isTop ? 0 : 1;
      const gapBot = si === 0 ? 0 : 1;
      const h = Math.max(0.75, yBot - yTop - gapTop - gapBot);
      const y = yTop + gapTop;
      const shape = isTop
        ? svgEl("path", { d: roundedTopRect(x, y, barW, h, 4), fill: seg.color })
        : svgEl("rect", { x, y, width: barW, height: h, fill: seg.color });
      shape.style.cursor = "default";
      attachTip(shape, () =>
        `<div class="tip-title">${escapeHtml(bar.tipTitle)}</div>` +
        `${escapeHtml(seg.name)} — ${fmtHours(seg.hours)}` +
        `<div class="tip-muted">Day total ${fmtHours(bar.total)}</div>`);
      svg.appendChild(shape);
      acc += seg.hours;
    });

    if (showCapLabels && bar.total > 0) {
      svg.appendChild(svgText(x + barW / 2, yOf(bar.total) - 6, fmtHours(bar.total),
        { "text-anchor": "middle", class: "cap-label" }));
    }
    if (i % labelEvery === 0) {
      svg.appendChild(svgText(x + barW / 2, H - 8, bar.label, { "text-anchor": "middle" }));
    }
  });

  host.appendChild(svg);
}

/* ================= Donut =================
   slices: [{ name, color, hours }], sorted desc by caller */
function renderDonut(host, slices, legendHost) {
  host.querySelectorAll("svg, .chart-empty").forEach(el => el.remove());
  legendHost.innerHTML = "";
  const total = slices.reduce((s, x) => s + x.hours, 0);
  if (!total) {
    host.insertAdjacentHTML("afterbegin", `<div class="chart-empty">No time tracked in this range.</div>`);
    return;
  }

  const S = 190, cx = S / 2, cy = S / 2, rOuter = 90, ring = 27;
  const rMid = rOuter - ring / 2;
  const svg = svgEl("svg", { viewBox: `0 0 ${S} ${S}`, role: "img", "aria-label": "Share of hours per project" });

  const polar = (r, a) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)];

  let a0 = 0;
  for (const sl of slices) {
    const frac = sl.hours / total;
    const a1 = a0 + frac * Math.PI * 2;
    let arc;
    if (frac > 0.999) {
      arc = svgEl("circle", { cx, cy, r: rMid, fill: "none", stroke: sl.color, "stroke-width": ring });
    } else {
      const [x0, y0] = polar(rMid, a0);
      const [x1, y1] = polar(rMid, a1);
      arc = svgEl("path", {
        d: `M${x0},${y0} A${rMid},${rMid} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`,
        fill: "none",
        stroke: sl.color,
        "stroke-width": ring,
      });
    }
    const pct = Math.round(frac * 100);
    attachTip(arc, () => `<div class="tip-title">${escapeHtml(sl.name)}</div>${fmtHours(sl.hours)} · ${pct}%`);
    svg.appendChild(arc);
    a0 = a1;
  }

  /* 2px surface gaps between slices (drawn over the ring boundaries) */
  if (slices.length > 1) {
    let a = 0;
    for (const sl of slices) {
      const [xi, yi] = polar(rOuter - ring, a);
      const [xo, yo] = polar(rOuter, a);
      svg.appendChild(svgEl("line", { x1: xi, y1: yi, x2: xo, y2: yo, stroke: "var(--surface)", "stroke-width": 2 }));
      a += (sl.hours / total) * Math.PI * 2;
    }
  }

  svg.appendChild(svgText(cx, cy + 1, fmtHours(total), { "text-anchor": "middle", class: "donut-total" }));
  svg.appendChild(svgText(cx, cy + 20, "hours", { "text-anchor": "middle", class: "donut-caption" }));
  host.insertAdjacentElement("afterbegin", svg);

  legendHost.innerHTML = slices.map(sl => `
    <div class="legend-row">
      <span class="proj-dot" style="--dot:${sl.color}"></span>
      <span class="legend-name">${escapeHtml(sl.name)}</span>
      <span class="legend-val">${fmtHours(sl.hours)}</span>
      <span class="legend-pct">${Math.round((sl.hours / total) * 100)}%</span>
    </div>`).join("");
}

/* ================= Month calendar heatmap =================
   hoursByDate: Map("YYYY-MM-DD" -> hours) */
function renderHeatmap(host, year, month, hoursByDate) {
  host.innerHTML = "";
  const cell = 26, gap = 5, headH = 18;
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startCol = (first.getDay() + 6) % 7; // Monday-first
  const rows = Math.ceil((startCol + daysInMonth) / 7);

  const W = 7 * (cell + gap) - gap;
  const H = headH + rows * (cell + gap) - gap;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Calendar of hours per day", style: "max-width:260px" });

  "MTWTFSS".split("").forEach((ch, i) =>
    svg.appendChild(svgText(i * (cell + gap) + cell / 2, 11, ch, { "text-anchor": "middle" })));

  let monthMax = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    monthMax = Math.max(monthMax, hoursByDate.get(toDateStr(new Date(year, month, d))) || 0);
  }

  const today = todayStr();
  for (let d = 1; d <= daysInMonth; d++) {
    const idx = startCol + d - 1;
    const x = (idx % 7) * (cell + gap);
    const y = headH + Math.floor(idx / 7) * (cell + gap);
    const dateStr = toDateStr(new Date(year, month, d));
    const hours = hoursByDate.get(dateStr) || 0;
    const bin = hours <= 0 ? 0 : clamp(Math.ceil((hours / monthMax) * 5), 1, 5);

    const rect = svgEl("rect", {
      x, y, width: cell, height: cell, rx: 6,
      fill: bin ? `var(--heat-${bin})` : "transparent",
      stroke: bin ? "none" : "var(--grid)",
      "stroke-width": 1,
    });
    attachTip(rect, () => `<div class="tip-title">${fmtDayLabel(dateStr)}</div>${hours ? fmtHours(hours) : "No time tracked"}`);
    svg.appendChild(rect);

    const num = svgText(x + cell / 2, y + cell / 2 + 3.5, d, {
      "text-anchor": "middle", class: "day-num", "pointer-events": "none",
      fill: bin ? `var(--heat-ink-${bin})` : "var(--muted)",
      "font-weight": dateStr === today ? 700 : 400,
    });
    svg.appendChild(num);
  }

  host.appendChild(svg);
}

/* ================= Weekly trend line =================
   weeks: [{ label, tipTitle, hours }] */
function renderTrend(host, weeks) {
  host.innerHTML = "";
  if (!weeks.some(w => w.hours > 0)) {
    host.innerHTML = `<div class="chart-empty">No time tracked in the last 12 weeks.</div>`;
    return;
  }

  const W = 820, H = 200;
  const m = { l: 42, r: 56, t: 16, b: 26 };
  const plotW = W - m.l - m.r, plotH = H - m.t - m.b;
  const { top, ticks } = niceTicks(Math.max(...weeks.map(w => w.hours)));
  const xOf = i => m.l + (weeks.length === 1 ? plotW / 2 : (i / (weeks.length - 1)) * plotW);
  const yOf = v => m.t + plotH - (v / top) * plotH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Total hours per week, last 12 weeks" });

  for (const v of ticks) {
    const y = yOf(v);
    svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: v === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }));
    svg.appendChild(svgText(m.l - 8, y + 3.5, `${v}h`, { "text-anchor": "end" }));
  }

  const pts = weeks.map((w, i) => [xOf(i), yOf(w.hours)]);
  const lineD = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");

  svg.appendChild(svgEl("path", {
    d: `${lineD} L${pts[pts.length - 1][0]},${yOf(0)} L${pts[0][0]},${yOf(0)} Z`,
    fill: "var(--series-blue)", "fill-opacity": 0.1, stroke: "none",
  }));
  svg.appendChild(svgEl("path", {
    d: lineD, fill: "none", stroke: "var(--series-blue)",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round",
  }));

  const crosshair = svgEl("line", { y1: m.t, y2: m.t + plotH, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" });
  svg.appendChild(crosshair);

  weeks.forEach((w, i) => {
    const [x, y] = pts[i];
    svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 4, fill: "var(--series-blue)", stroke: "var(--surface)", "stroke-width": 2, "pointer-events": "none" }));
    if (i % 2 === 0) svg.appendChild(svgText(x, H - 8, w.label, { "text-anchor": "middle" }));
  });
  const last = weeks.length - 1;
  svg.appendChild(svgText(pts[last][0] + 10, pts[last][1] + 4, fmtHours(weeks[last].hours), { class: "end-label" }));

  /* nearest-point hover across the whole plot */
  const overlay = svgEl("rect", { x: m.l, y: m.t, width: plotW, height: plotH, fill: "transparent" });
  overlay.addEventListener("mousemove", e => {
    const box = svg.getBoundingClientRect();
    const mx = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - mx) < Math.abs(pts[best][0] - mx)) best = i;
    crosshair.setAttribute("x1", pts[best][0]);
    crosshair.setAttribute("x2", pts[best][0]);
    crosshair.setAttribute("visibility", "visible");
    showTip(`<div class="tip-title">${escapeHtml(weeks[best].tipTitle)}</div>${fmtHours(weeks[best].hours)}`, e);
  });
  overlay.addEventListener("mouseleave", () => {
    crosshair.setAttribute("visibility", "hidden");
    hideTip();
  });
  svg.appendChild(overlay);

  host.appendChild(svg);
}
