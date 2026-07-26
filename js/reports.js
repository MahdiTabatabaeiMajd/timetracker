/* TimeTracker — Reports: range picker, aggregation, stat cards, charts, CSV */
"use strict";

let reportPreset = "thisweek";
let heatMonth = null; // {year, month}

function initReports() {
  const urlRange = new URLSearchParams(location.search).get("range");
  if (["thisweek", "lastweek", "thismonth", "lastmonth"].includes(urlRange)) {
    reportPreset = urlRange;
    document.querySelectorAll("#rangePresets button").forEach(b =>
      b.classList.toggle("active", b.dataset.range === urlRange));
  }

  document.querySelectorAll("#rangePresets button").forEach(btn =>
    btn.addEventListener("click", () => {
      reportPreset = btn.dataset.range;
      document.querySelectorAll("#rangePresets button").forEach(b =>
        b.classList.toggle("active", b === btn));
      document.getElementById("customRange").classList.toggle("hidden", reportPreset !== "custom");
      if (reportPreset === "custom" && !document.getElementById("rangeFrom").value) {
        const now = new Date();
        document.getElementById("rangeFrom").value = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
        document.getElementById("rangeTo").value = todayStr();
      }
      heatMonth = null; // re-anchor calendar to the new range
      renderReports();
    }));

  for (const id of ["rangeFrom", "rangeTo"]) {
    document.getElementById(id).addEventListener("change", () => {
      heatMonth = null;
      renderReports();
    });
  }

  document.getElementById("heatPrev").addEventListener("click", () => stepHeatMonth(-1));
  document.getElementById("heatNext").addEventListener("click", () => stepHeatMonth(1));
  document.getElementById("csvBtn").addEventListener("click", exportCsv);
  document.getElementById("csvSummaryBtn").addEventListener("click", exportSummaryCsv);

  // "Prepared by / for" labels, stored in settings and shown on the PDF header
  for (const [id, key] of [["reportBy", "reportBy"], ["reportFor", "reportFor"]]) {
    const input = document.getElementById(id);
    input.value = Store.state.settings[key] || "";
    input.addEventListener("input", () => {
      Store.state.settings[key] = input.value.trim();
      Store.save();
    });
  }

  document.getElementById("pdfBtn").addEventListener("click", () => {
    switchView("reports");
    setTimeout(() => window.print(), 60); // let the view render before the print dialog
  });
  window.addEventListener("beforeprint", preparePrint);
  window.addEventListener("afterprint", restoreAfterPrint);
}

/* Printing always produces the light-theme report, whatever is on screen */
let printPrevTheme;

function preparePrint() {
  printPrevTheme = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", "light");
  renderReports();
  const now = new Date();
  const meta = `${document.getElementById("rangeLabel").textContent} · exported ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const by = Store.state.settings.reportBy || "";
  const forWhom = Store.state.settings.reportFor || "";
  let who = "";
  if (by && forWhom) who = `Prepared by ${by} for ${forWhom}`;
  else if (by) who = `Prepared by ${by}`;
  else if (forWhom) who = `Prepared for ${forWhom}`;
  document.getElementById("printMeta").innerHTML =
    escapeHtml(meta) + (who ? `<br><b>${escapeHtml(who)}</b>` : "");
}

function restoreAfterPrint() {
  if (printPrevTheme == null) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", printPrevTheme);
}

function currentRange() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (reportPreset) {
    case "thisweek": {
      const from = startOfWeek(today);
      return { from, to: addDays(from, 6) };
    }
    case "lastweek": {
      const from = addDays(startOfWeek(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case "thismonth":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1),
               to: new Date(today.getFullYear(), today.getMonth() + 1, 0) };
    case "lastmonth":
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
               to: new Date(today.getFullYear(), today.getMonth(), 0) };
    default: {
      let from = document.getElementById("rangeFrom").value;
      let to = document.getElementById("rangeTo").value;
      from = from ? fromDateStr(from) : new Date(today.getFullYear(), today.getMonth(), 1);
      to = to ? fromDateStr(to) : today;
      return from > to ? { from: to, to: from } : { from, to };
    }
  }
}

function projectMeta(projectId) {
  const p = getProject(projectId);
  return p
    ? { name: p.name, color: colorVar(p.color) }
    : { name: "No project", color: "var(--series-none)" };
}

function renderReports() {
  const { from, to } = currentRange();
  const fromStr = toDateStr(from), toStr = toDateStr(to);
  const inRange = Store.state.entries.filter(e => e.date >= fromStr && e.date <= toStr);

  const sameYear = from.getFullYear() === to.getFullYear();
  document.getElementById("rangeLabel").textContent =
    `${fmtShortDate(from)}${sameYear ? "" : ` ${from.getFullYear()}`} – ${fmtShortDate(to)} ${to.getFullYear()}`;

  /* ---- stat cards ---- */
  const total = inRange.reduce((s, e) => s + e.hours, 0);
  const daysWorked = new Set(inRange.map(e => e.date)).size;
  document.getElementById("statTotal").textContent = fmtHours(total);
  document.getElementById("statAvg").textContent = daysWorked ? fmtHours(total / daysWorked) : "0:00";
  document.getElementById("statDays").textContent = daysWorked;

  const byProject = new Map();
  for (const e of inRange) {
    const k = e.projectId || "";
    byProject.set(k, (byProject.get(k) || 0) + e.hours);
  }
  const topEl = document.getElementById("statTop");
  if (byProject.size) {
    const [topId] = [...byProject.entries()].sort((a, b) => b[1] - a[1])[0];
    const meta = projectMeta(topId || null);
    topEl.innerHTML = `<span class="proj-dot" style="--dot:${meta.color}"></span>${escapeHtml(meta.name)}`;
  } else {
    topEl.textContent = "–";
  }

  renderBarReport(from, to, inRange);
  renderDonutReport(byProject);
  renderHeatReport(from);
  renderTrendReport();
  renderBreakdown(inRange);
}

/* ---- project & description breakdown (Toggl-style summary table) ---- */
function renderBreakdown(entries) {
  const host = document.getElementById("breakdownTable");
  const total = entries.reduce((s, e) => s + e.hours, 0);
  if (!total) {
    host.innerHTML = `<div class="chart-empty">No time tracked in this range.</div>`;
    return;
  }

  // project -> description -> hours
  const tree = new Map();
  for (const e of entries) {
    const pk = e.projectId || "";
    if (!tree.has(pk)) tree.set(pk, new Map());
    const descs = tree.get(pk);
    const dk = e.description || "";
    descs.set(dk, (descs.get(dk) || 0) + e.hours);
  }

  const projects = [...tree.entries()]
    .map(([pk, descs]) => ({
      pk,
      meta: projectMeta(pk || null),
      hours: [...descs.values()].reduce((s, h) => s + h, 0),
      descs: [...descs.entries()].sort((a, b) => b[1] - a[1]),
    }))
    .sort((a, b) => b.hours - a.hours);

  host.innerHTML = `<table class="bd-table">
    <thead><tr><th>Project / description</th><th class="num">Duration</th><th class="num">%</th></tr></thead>
    <tbody>${projects.map(p => `
      <tr class="bd-proj">
        <td><span class="proj-dot" style="--dot:${p.meta.color}"></span>${escapeHtml(p.meta.name)}</td>
        <td class="num">${fmtHours(p.hours)}</td>
        <td class="num">${Math.round((p.hours / total) * 100)}%</td>
      </tr>
      ${p.descs.map(([desc, h]) => `
      <tr class="bd-desc">
        <td>${desc ? escapeHtml(desc) : `<span class="bd-nodesc">(no description)</span>`}</td>
        <td class="num">${fmtHours(h)}</td>
        <td class="num">${Math.round((h / p.hours) * 100)}%</td>
      </tr>`).join("")}
    `).join("")}</tbody>
  </table>`;
}

/* ---- stacked bars: daily for spans ≤ 40 days, else weekly buckets ---- */
function renderBarReport(from, to, entries) {
  const spanDays = Math.round((to - from) / 864e5) + 1;
  const weekly = spanDays > 40;
  document.getElementById("barTitle").textContent = weekly ? "Hours per week" : "Hours per day";

  // fixed segment order = project creation order, "No project" last
  const order = Store.state.projects.map(p => p.id).concat([""]);

  const buckets = [];
  if (weekly) {
    for (let d = startOfWeek(from); d <= to; d = addDays(d, 7)) {
      buckets.push({ start: toDateStr(d), end: toDateStr(addDays(d, 6)),
        label: fmtShortDate(d), tipTitle: `Week of ${fmtShortDate(d)}` });
    }
  } else {
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      const ds = toDateStr(d);
      buckets.push({ start: ds, end: ds,
        label: spanDays <= 10 ? `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}` : `${d.getDate()}`,
        tipTitle: fmtDayLabel(ds) });
    }
  }

  const bars = buckets.map(b => {
    const perProject = new Map();
    for (const e of entries) {
      if (e.date >= b.start && e.date <= b.end) {
        const k = e.projectId || "";
        perProject.set(k, (perProject.get(k) || 0) + e.hours);
      }
    }
    const segments = order
      .filter(id => perProject.has(id))
      .map(id => {
        const meta = projectMeta(id || null);
        return { name: meta.name, color: meta.color, hours: perProject.get(id) };
      });
    return { label: b.label, tipTitle: b.tipTitle, segments,
      total: segments.reduce((s, x) => s + x.hours, 0) };
  });

  renderStackedBars(document.getElementById("barChart"), bars);
}

function renderDonutReport(byProject) {
  const slices = [...byProject.entries()]
    .map(([id, hours]) => ({ ...projectMeta(id || null), hours }))
    .sort((a, b) => b.hours - a.hours);
  const host = document.getElementById("donutChart");
  let legend = host.querySelector(".donut-legend");
  if (!legend) {
    legend = document.createElement("div");
    legend.className = "donut-legend";
    host.appendChild(legend);
  }
  renderDonut(host, slices, legend);
}

function renderHeatReport(rangeFrom) {
  if (!heatMonth) heatMonth = { year: rangeFrom.getFullYear(), month: rangeFrom.getMonth() };
  document.getElementById("heatTitle").textContent =
    `${MONTHS[heatMonth.month]} ${heatMonth.year}`;

  const hoursByDate = new Map();
  for (const e of Store.state.entries) {
    hoursByDate.set(e.date, (hoursByDate.get(e.date) || 0) + e.hours);
  }
  renderHeatmap(document.getElementById("heatChart"), heatMonth.year, heatMonth.month, hoursByDate);
}

function stepHeatMonth(dir) {
  if (!heatMonth) return;
  const d = new Date(heatMonth.year, heatMonth.month + dir, 1);
  heatMonth = { year: d.getFullYear(), month: d.getMonth() };
  renderHeatReport(new Date(heatMonth.year, heatMonth.month, 1));
}

function renderTrendReport() {
  const thisWeek = startOfWeek(new Date());
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    const s = toDateStr(start), e = toDateStr(addDays(start, 6));
    const hours = Store.state.entries.reduce(
      (sum, en) => (en.date >= s && en.date <= e ? sum + en.hours : sum), 0);
    weeks.push({ label: fmtShortDate(start), tipTitle: `Week of ${fmtShortDate(start)}`, hours });
  }
  renderTrend(document.getElementById("trendChart"), weeks);
}

/* ---- CSV export ---- */
function exportCsv() {
  const { from, to } = currentRange();
  const fromStr = toDateStr(from), toStr = toDateStr(to);
  const rows = Store.state.entries
    .filter(e => e.date >= fromStr && e.date <= toStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!rows.length) return alert("No entries in the selected range.");

  const csv = ["Date,Project,Description,Start,End,Hours,Duration"]
    .concat(rows.map(e => [
      e.date,
      csvEsc(getProject(e.projectId)?.name || ""),
      csvEsc(e.description),
      e.start != null ? fmtTime(e.start) : "",
      e.end != null ? fmtTime(e.end) : "",
      e.hours.toFixed(2),
      fmtHours(e.hours),
    ].join(",")))
    .join("\n");

  downloadCsv(csv, `timetracker_${fromStr}_${toStr}.csv`);
}

/* ---- summary CSV: hours per project & description ---- */
function exportSummaryCsv() {
  const { from, to } = currentRange();
  const fromStr = toDateStr(from), toStr = toDateStr(to);
  const rows = Store.state.entries.filter(e => e.date >= fromStr && e.date <= toStr);
  if (!rows.length) return alert("No entries in the selected range.");

  const tree = new Map();
  for (const e of rows) {
    const pk = getProject(e.projectId)?.name || "(No project)";
    const dk = e.description || "(no description)";
    if (!tree.has(pk)) tree.set(pk, new Map());
    tree.get(pk).set(dk, (tree.get(pk).get(dk) || 0) + e.hours);
  }

  const lines = ["Project,Description,Hours,Duration"];
  const projects = [...tree.entries()].map(([name, descs]) => ({
    name, descs, hours: [...descs.values()].reduce((s, h) => s + h, 0),
  })).sort((a, b) => b.hours - a.hours);
  for (const p of projects) {
    lines.push([csvEsc(p.name), csvEsc("(all)"), p.hours.toFixed(2), fmtHours(p.hours)].join(","));
    for (const [desc, h] of [...p.descs.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push([csvEsc(p.name), csvEsc(desc), h.toFixed(2), fmtHours(h)].join(","));
    }
  }

  downloadCsv(lines.join("\n"), `timetracker_summary_${fromStr}_${toStr}.csv`);
}

function csvEsc(v) {
  let s = String(v ?? "");
  if (/^[=+@\t-]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv(text, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
