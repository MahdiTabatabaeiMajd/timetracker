/* TimeTracker — shared helpers, theme, navigation, bootstrap */
"use strict";

/* ---------- Project color palette (fixed slot order) ---------- */
/* First 8: colorblind-validated set in a deliberate order (chart-safe defaults).
   Second 8: extra choices for people with many projects. */
const PALETTE = [
  { key: "blue", label: "Blue" },
  { key: "orange", label: "Orange" },
  { key: "aqua", label: "Aqua" },
  { key: "yellow", label: "Yellow" },
  { key: "magenta", label: "Magenta" },
  { key: "green", label: "Green" },
  { key: "violet", label: "Violet" },
  { key: "red", label: "Red" },
  { key: "teal", label: "Teal" },
  { key: "navy", label: "Navy" },
  { key: "plum", label: "Plum" },
  { key: "rose", label: "Rose" },
  { key: "brown", label: "Brown" },
  { key: "olive", label: "Olive" },
  { key: "slate", label: "Slate" },
  { key: "gold", label: "Gold" },
];

function isHexColor(v) {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

/* A project's color is either a palette key ("blue") or a custom hex ("#3fa7d6") */
function colorVar(key) {
  if (isHexColor(key)) return key;
  return `var(--series-${PALETTE.some(p => p.key === key) ? key : "none"})`;
}

/* ---------- Small utilities ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ---------- Dates (all local-time; entry dates are "YYYY-MM-DD") ---------- */
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function todayStr() { return toDateStr(new Date()); }

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d) { // Monday
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (r.getDay() + 6) % 7;
  return addDays(r, -shift);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function fmtDayLabel(dateStr) {
  const today = todayStr();
  if (dateStr === today) return "Today";
  if (dateStr === toDateStr(addDays(new Date(), -1))) return "Yesterday";
  const d = fromDateStr(dateStr);
  const base = `${WEEKDAYS[(d.getDay() + 6) % 7]}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

function fmtShortDate(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/* ---------- Hours formatting & parsing ---------- */
function fmtHours(h) { // 1.5 -> "1:30"
  const totalMin = Math.round(h * 60);
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, "0")}`;
}

function fmtClock(seconds) { // 3725 -> "1:02:05"
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* Minutes-from-midnight <-> "HH:MM" (the format <input type="time"> uses) */
function fmtTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function parseTimeToMin(str) {
  const m = String(str || "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? clamp(Number(m[1]) * 60 + Number(m[2]), 0, 24 * 60) : null;
}

/* Short grid label: 0 -> "12 AM", 600 -> "10 AM", 810 -> "1:30 PM" */
function fmtHourLabel(min) {
  const h24 = Math.floor(min / 60), m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

function isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

/* Accepts "1.5", "1,5", "1:30", "90m", "2h", "2h15", "2h 15m" — returns hours or null */
function parseHoursInput(raw) {
  const s = String(raw).trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{1,3}):([0-5]?\d)$/))) return Number(m[1]) + Number(m[2]) / 60;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?(?:\s*(\d{1,2})\s*m?(?:in)?)?$/))) {
    return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*m(?:in)?s?$/))) return Number(m[1]) / 60;
  if ((m = s.match(/^\d+(?:\.\d+)?$/))) return Number(s);
  return null;
}

/* ---------- Theme ---------- */
const THEME_ORDER = ["auto", "light", "dark"];

function applyTheme() {
  const theme = Store.state.settings.theme || "auto";
  const root = document.documentElement;
  if (theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  document.getElementById("themeLabel").textContent =
    `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
  for (const t of THEME_ORDER) {
    document.getElementById(`themeIcon${t[0].toUpperCase()}${t.slice(1)}`)
      .classList.toggle("hidden", t !== theme);
  }
}

/* ---------- Navigation ---------- */
const VIEWS = ["timer", "reports", "projects"];

function switchView(name) {
  if (!VIEWS.includes(name)) name = "timer";
  document.querySelectorAll(".nav-item[data-view]").forEach(b =>
    b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach(v =>
    v.classList.toggle("active", v.id === `view-${name}`));
  if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  if (name === "reports") renderReports();
}

/* ---------- Global re-render ---------- */
function renderAll() {
  renderProjectSelects();
  renderEntries();
  renderCalendar();
  renderProjects();
  if (document.getElementById("view-reports").classList.contains("active")) renderReports();
}

/* ---------- Bootstrap ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  await Store.load();
  applyTheme();

  document.querySelectorAll(".nav-item[data-view]").forEach(btn =>
    btn.addEventListener("click", () => switchView(btn.dataset.view)));

  document.getElementById("themeToggle").addEventListener("click", () => {
    const cur = Store.state.settings.theme || "auto";
    Store.state.settings.theme = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
    Store.save();
    applyTheme();
  });

  initProjectQuickAdd(); // must attach before initTimer so "__new__" resolves first
  initEntries();
  initTimer();
  initProjects();
  initReports();
  initCalendar();
  renderAll();

  if (location.hash) switchView(location.hash.slice(1));
  window.addEventListener("hashchange", () => switchView(location.hash.slice(1)));
});
