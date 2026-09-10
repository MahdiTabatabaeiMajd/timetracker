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
  document.getElementById("xlsxBtn").addEventListener("click", exportExcel);
  document.getElementById("csvBtn").addEventListener("click", exportCsv);
  document.getElementById("csvSummaryBtn").addEventListener("click", exportSummaryCsv);
  initCsvMenu();

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

/* ---- Exports ----
   Export to Excel is the main export: a real .xlsx (see xlsx.js) opens in proper
   columns on any computer, with dates, times and hours as real values.

   CSV stays as a secondary format. Which character separates CSV columns is NOT
   universal: Excel splits a .csv on the computer's "list separator", a semicolon
   wherever the decimal sign is a comma (Denmark, Germany, France, …) and a comma
   elsewhere. The browser can't see that setting (its language can differ from
   the system's number format), so the CSV menu keeps a remembered choice:
   settings.csvSeparator = "auto" | "comma" | "semicolon". "auto" makes a first
   guess from the browser language; a wrong guess is one click away in the menu. */

function entriesInRange() {
  const { from, to } = currentRange();
  const fromStr = toDateStr(from), toStr = toDateStr(to);
  const rows = Store.state.entries
    .filter(e => e.date >= fromStr && e.date <= toStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { rows, fromStr, toStr };
}

/* Hours per project and description: projects by total (desc), each preceded by
   an "(all)" total row. Shared by the Summary sheet and the summary CSV. */
function summarizeByProject(rows) {
  const tree = new Map();
  for (const e of rows) {
    const pk = getProject(e.projectId)?.name || "(No project)";
    const dk = e.description || "(no description)";
    if (!tree.has(pk)) tree.set(pk, new Map());
    tree.get(pk).set(dk, (tree.get(pk).get(dk) || 0) + e.hours);
  }
  const out = [];
  const projects = [...tree.entries()].map(([name, descs]) => ({
    name, descs, hours: [...descs.values()].reduce((s, h) => s + h, 0),
  })).sort((a, b) => b.hours - a.hours);
  for (const p of projects) {
    out.push({ project: p.name, description: "(all)", hours: p.hours });
    for (const [desc, h] of [...p.descs.entries()].sort((a, b) => b[1] - a[1])) {
      out.push({ project: p.name, description: desc, hours: h });
    }
  }
  return out;
}

/* ---- Excel workbook: an "Entries" sheet and a "Summary" sheet ---- */
function buildWorkbook(rows) {
  const C = xlsxCell;
  const entries = {
    name: "Entries",
    widths: [12, 26, 44, 8, 8, 8, 10],
    rows: [
      ["Date", "Project", "Description", "Start", "End", "Hours", "Duration"].map(C.header),
      ...rows.map(e => [
        C.date(e.date),
        C.text(getProject(e.projectId)?.name || ""),
        C.text(e.description),
        e.start != null ? C.time(e.start) : null,
        e.end != null ? C.time(e.end) : null,
        C.num(e.hours),
        C.duration(e.hours),
      ]),
    ],
  };
  const summary = {
    name: "Summary",
    widths: [26, 44, 8, 10],
    rows: [
      ["Project", "Description", "Hours", "Duration"].map(C.header),
      ...summarizeByProject(rows).map(r =>
        [C.text(r.project), C.text(r.description), C.num(r.hours), C.duration(r.hours)]),
    ],
  };
  return [entries, summary];
}

function exportExcel() {
  const { rows, fromStr, toStr } = entriesInRange();
  if (!rows.length) return alert("No entries in the selected range.");
  downloadFile(buildXlsx(buildWorkbook(rows)),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `timetracker_${fromStr}_${toStr}.xlsx`);
}

/* ---- CSV ---- */
const CSV_DIALECTS = {
  comma:     { sep: ",", decimal: "." },   // 1.50 — US/UK Excel, Numbers, Google Sheets
  semicolon: { sep: ";", decimal: "," },   // 1,50 — Excel where the decimal sign is a comma
};

/* "comma" or "semicolon" for a BCP-47 language tag, from its decimal sign. */
function detectCsvSeparator(lang) {
  try {
    const parts = new Intl.NumberFormat(lang).formatToParts(1.1);
    return parts.some(p => p.type === "decimal" && p.value === ",") ? "semicolon" : "comma";
  } catch (_) {
    return "comma";
  }
}

/* Resolve the user's preference ("auto" or missing = detect) to {key, sep, decimal}. */
function csvDialect(pref, lang) {
  const key = (pref === "comma" || pref === "semicolon") ? pref : detectCsvSeparator(lang);
  return { key, ...CSV_DIALECTS[key] };
}

function currentCsvDialect() {
  return csvDialect(Store.state.settings.csvSeparator, navigator.language);
}

function csvNum(n, d) {            // 1.5 -> "1.50" or "1,50"
  return n.toFixed(2).replace(".", d.decimal);
}

function buildEntriesCsv(rows, d) {
  return [["Date", "Project", "Description", "Start", "End", "Hours", "Duration"].join(d.sep)]
    .concat(rows.map(e => [
      e.date,
      csvEsc(getProject(e.projectId)?.name || ""),
      csvEsc(e.description),
      e.start != null ? fmtTime(e.start) : "",
      e.end != null ? fmtTime(e.end) : "",
      csvNum(e.hours, d),
      fmtHours(e.hours),
    ].join(d.sep)))
    .join("\n");
}

function exportCsv() {
  const { rows, fromStr, toStr } = entriesInRange();
  if (!rows.length) return alert("No entries in the selected range.");
  downloadCsv(buildEntriesCsv(rows, currentCsvDialect()), `timetracker_${fromStr}_${toStr}.csv`);
}

function buildSummaryCsv(rows, d) {
  return [["Project", "Description", "Hours", "Duration"].join(d.sep)]
    .concat(summarizeByProject(rows).map(r =>
      [csvEsc(r.project), csvEsc(r.description), csvNum(r.hours, d), fmtHours(r.hours)].join(d.sep)))
    .join("\n");
}

function exportSummaryCsv() {
  const { rows, fromStr, toStr } = entriesInRange();
  if (!rows.length) return alert("No entries in the selected range.");
  downloadCsv(buildSummaryCsv(rows, currentCsvDialect()), `timetracker_summary_${fromStr}_${toStr}.csv`);
}

function csvEsc(v) {
  let s = String(v ?? "");
  if (/^[=+@\t-]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
  return `"${s.replace(/"/g, '""')}"`;
}

/* The CSV menu: a <details> disclosure holding the "Opens correctly in" choice
   and the two CSV buttons. Closes after an export, on Escape, or on a click
   anywhere outside it. */
function initCsvMenu() {
  const menu = document.getElementById("csvMenu");
  const sel = document.getElementById("csvSeparator");
  const names = {
    comma: "Excel (US/UK), Numbers, Google Sheets",
    semicolon: "Excel (Denmark and most of Europe)",
  };
  sel.querySelector('option[value="auto"]').textContent =
    `Automatic: ${names[csvDialect("auto", navigator.language).key]}`;
  const pref = Store.state.settings.csvSeparator;
  sel.value = (pref === "comma" || pref === "semicolon") ? pref : "auto";
  sel.addEventListener("change", () => {
    Store.state.settings.csvSeparator = sel.value;
    Store.save();
  });
  for (const id of ["csvBtn", "csvSummaryBtn"]) {
    document.getElementById(id).addEventListener("click", () => { menu.open = false; });
  }
  menu.addEventListener("keydown", e => { if (e.key === "Escape") menu.open = false; });
  document.addEventListener("pointerdown", e => { if (!menu.contains(e.target)) menu.open = false; });
}

/* ---- download helpers ---- */
function downloadFile(data, type, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadCsv(text, filename) {
  // Prefix the UTF-8 byte-order mark (U+FEFF): it tells Excel the file is UTF-8,
  // so æ ø å and any other non-ASCII text survive instead of turning to garbage.
  // Numbers, Google Sheets and LibreOffice simply ignore it.
  downloadFile(String.fromCharCode(0xFEFF) + text, "text/csv;charset=utf-8", filename);
}
