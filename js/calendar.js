/* TimeTracker — week calendar: drag to draw time blocks, click to edit */
"use strict";

const HOUR_H = 52;          // px per hour — keep in sync with .wg-day CSS background
const SNAP_MIN = 15;
const DAY_END = 24 * 60;

let calWeekStart = startOfWeek(new Date());
let calScrolled = false;
let dialogEntryId = null;   // null while creating a new entry
let dialogDraft = null;     // {date,start,end} for a new entry
let lastDialogProject = "";
let ghostEl = null;
let nowLineTimer = null;

let clipboardEntry = null;  // {projectId, description, duration} set by ⌘/Ctrl+C
let hoverEntryId = null;    // block currently under the cursor (copy source)
let cursorGrid = null;      // {date, min} the cursor points at in the grid (paste target)
let toastTimer = null;

/* ---------- init ---------- */
function initCalendar() {
  document.querySelectorAll("#entryViewToggle button").forEach(btn =>
    btn.addEventListener("click", () => setEntryView(btn.dataset.entryview)));

  document.getElementById("weekPrev").addEventListener("click", () => stepWeek(-7));
  document.getElementById("weekNext").addEventListener("click", () => stepWeek(7));
  document.getElementById("weekToday").addEventListener("click", () => {
    calWeekStart = startOfWeek(new Date());
    renderCalendar();
  });

  initEntryDialog();

  const last = [...Store.state.entries].sort((a, b) => b.id < a.id ? -1 : 1)[0];
  if (last) lastDialogProject = last.projectId || "";

  nowLineTimer = setInterval(updateNowLine, 60000);
  window.addEventListener("resize", () => {
    if (currentEntryView() === "week") syncHeaderGutter();
  });

  // Copy/paste: track what the cursor points at, then act on ⌘/Ctrl+C / +V.
  const grid = document.getElementById("weekGrid");
  grid.addEventListener("pointermove", trackCursor);
  grid.addEventListener("pointerleave", () => { hoverEntryId = null; cursorGrid = null; });
  document.addEventListener("keydown", onCalKey);

  // Narrow screens scroll the grid sideways; keep the Mon–Sun header aligned.
  const weekScroll = document.getElementById("weekScroll");
  weekScroll.addEventListener("scroll", () => {
    document.getElementById("weekDays").scrollLeft = weekScroll.scrollLeft;
  });

  updateEntryView();
}

function currentEntryView() {
  return Store.state.settings.entryView === "week" ? "week" : "list";
}

function setEntryView(view) {
  Store.state.settings.entryView = view;
  Store.save();
  updateEntryView();
}

function updateEntryView() {
  const week = currentEntryView() === "week";
  document.querySelectorAll("#entryViewToggle button").forEach(b =>
    b.classList.toggle("active", (b.dataset.entryview === "week") === week));
  document.getElementById("weekNav").classList.toggle("hidden", !week);
  document.getElementById("manualCard").classList.toggle("hidden", week);
  document.getElementById("entryList").classList.toggle("hidden", week);
  document.getElementById("weekCal").classList.toggle("hidden", !week);
  if (week) {
    renderCalendar();
    if (!calScrolled) {
      document.getElementById("weekScroll").scrollTop = 7.5 * HOUR_H;
      calScrolled = true;
    }
  }
}

function stepWeek(days) {
  calWeekStart = addDays(calWeekStart, days);
  renderCalendar();
}

/* ---------- render ---------- */
function renderCalendar() {
  if (currentEntryView() !== "week") return;

  const days = Array.from({ length: 7 }, (_, i) => toDateStr(addDays(calWeekStart, i)));
  const byDay = new Map(days.map(d => [d, []]));
  for (const en of Store.state.entries) {
    if (byDay.has(en.date)) byDay.get(en.date).push(en);
  }

  /* header: week label + totals */
  const weekTotal = days.reduce((s, d) => s + byDay.get(d).reduce((x, e) => x + e.hours, 0), 0);
  const thisWeek = toDateStr(calWeekStart) === toDateStr(startOfWeek(new Date()));
  document.getElementById("weekLabel").textContent =
    `${thisWeek ? "This week" : fmtShortDate(calWeekStart)} · W${isoWeek(calWeekStart)}`;
  document.getElementById("weekTotal").textContent = `Week total ${fmtHours(weekTotal)}`;

  const today = todayStr();
  document.getElementById("weekDays").innerHTML =
    `<div class="wd-gutter"></div>` +
    days.map((d, i) => {
      const list = byDay.get(d);
      const total = list.reduce((s, e) => s + e.hours, 0);
      const untimed = list.filter(e => e.start == null || e.end == null);
      const date = addDays(calWeekStart, i);
      return `<div class="wd-day ${d === today ? "today" : ""}">
        <span class="wd-num">${date.getDate()}</span>
        <span class="wd-meta"><span class="wd-name">${WEEKDAYS[i].toUpperCase()}</span>
        <span class="wd-total">${fmtHours(total)}</span></span>
        ${untimed.length ? `<button class="wd-untimed" data-gotolist="1" title="Entries without start/end times — edit them in List view">+${untimed.length} untimed</button>` : ""}
      </div>`;
    }).join("");
  document.querySelectorAll("[data-gotolist]").forEach(b =>
    b.addEventListener("click", () => setEntryView("list")));

  /* grid */
  const gutter = `<div class="wg-gutter">${
    Array.from({ length: 23 }, (_, i) =>
      `<span class="wg-hour" style="top:${(i + 1) * HOUR_H - 8}px">${fmtHourLabel((i + 1) * 60)}</span>`
    ).join("")}</div>`;

  const cols = days.map(d => {
    const blocks = layoutDayBlocks(byDay.get(d));
    const html = blocks.map(b => {
      const p = getProject(b.entry.projectId);
      const color = p ? colorVar(p.color) : "var(--series-none)";
      const h = Math.max(18, (b.entry.end - b.entry.start) / 60 * HOUR_H - 2);
      return `<div class="cal-block ${h < 36 ? "compact" : ""}" data-entry="${b.entry.id}"
        style="top:${b.entry.start / 60 * HOUR_H}px;height:${h}px;left:${b.left}%;width:calc(${b.width}% - 3px);--pc:${color}">
        <span class="cb-desc">${escapeHtml(b.entry.description) || (p ? escapeHtml(p.name) : "No project")}</span>
        <span class="cb-time">${fmtTime(b.entry.start)} – ${fmtTime(b.entry.end)} · ${fmtHours(b.entry.hours)}</span>
      </div>`;
    }).join("");
    return `<div class="wg-day ${d === today ? "today" : ""}" data-date="${d}">${html}</div>`;
  }).join("");

  document.getElementById("weekGrid").innerHTML = gutter + cols;

  document.querySelectorAll(".cal-block").forEach(el => {
    el.addEventListener("pointerdown", e => startBlockDrag(e, el));
    const en = Store.state.entries.find(x => x.id === el.dataset.entry);
    if (en) {
      const p = getProject(en.projectId);
      attachTip(el, () =>
        `<div class="tip-title">${escapeHtml(p ? p.name : "No project")}</div>` +
        `${escapeHtml(en.description) || "<span class='tip-muted'>(no description)</span>"}` +
        `<div class="tip-muted">${fmtTime(en.start)} – ${fmtTime(en.end)} · ${fmtHours(en.hours)}</div>`);
    }
  });

  document.querySelectorAll(".wg-day").forEach(el =>
    el.addEventListener("pointerdown", startDraw));

  syncHeaderGutter();
  updateNowLine();
}

/* The grid's vertical scrollbar squeezes its columns; pad the date header by the
   same width so the header dividers line up with the grid lines below. */
function syncHeaderGutter() {
  const scroll = document.getElementById("weekScroll");
  document.getElementById("weekDays").style.paddingRight =
    `${scroll.offsetWidth - scroll.clientWidth}px`;
}

/* side-by-side layout for overlapping blocks (calendar-app style) */
function layoutDayBlocks(entries) {
  const timed = entries
    .filter(e => e.start != null && e.end != null && e.end > e.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out = [];
  let cluster = [], clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const colEnds = [];
    const placed = cluster.map(e => {   // never mutate entries here — they get saved to disk
      let col = colEnds.findIndex(end => end <= e.start);
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = e.end;
      return { e, col };
    });
    const n = colEnds.length;
    for (const { e, col } of placed) {
      out.push({ entry: e, left: (col / n) * 100, width: 100 / n });
    }
    cluster = [];
  };

  for (const e of timed) {
    if (cluster.length && e.start >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  flush();
  return out;
}

/* ---------- drop-target math (pure — unit tested) ---------- */

/* Screen Y within a day column -> snapped minutes-from-midnight. */
function clientToMin(clientY, colTop) {
  return clamp(Math.round(((clientY - colTop) / HOUR_H) * 60 / SNAP_MIN) * SNAP_MIN, 0, DAY_END);
}

/* Which day column an x-coordinate falls in; clamps to the nearest edge column
   so a drag that strays past the grid still lands on Mon or Sun. */
function columnAt(x, cols) {
  if (!cols.length) return null;
  for (const c of cols) if (x >= c.left && x < c.right) return c;
  return x < cols[0].left ? cols[0] : cols[cols.length - 1];
}

/* Place a block of `durationMin` on `date` starting at `desiredStart`, snapped
   to the grid and kept fully inside the day. Returns entry-shaped fields. */
function placeBlock(durationMin, date, desiredStart) {
  const dur = Math.max(SNAP_MIN, durationMin);
  const start = clamp(Math.round(desiredStart / SNAP_MIN) * SNAP_MIN, 0, DAY_END - dur);
  return { date, start, end: start + dur, hours: Math.round((dur / 60) * 100) / 100 };
}

function updateNowLine() {
  document.querySelectorAll(".now-line").forEach(el => el.remove());
  const todayCol = document.querySelector(`.wg-day[data-date="${todayStr()}"]`);
  if (!todayCol) return;
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  const line = document.createElement("div");
  line.className = "now-line";
  line.style.top = `${(min / 60) * HOUR_H}px`;
  todayCol.appendChild(line);
}

/* ---------- pointer gestures (mouse AND touch) ----------
   Mouse: press engages a gesture immediately (exactly the old behavior).
   Touch: hold still for TOUCH_HOLD_MS to engage; moving first means the user is
   scrolling, so the gesture bows out and the browser pans normally. While a
   touch gesture is engaged, a non-passive touchmove listener suppresses
   scrolling so the drag owns the finger. */
const TOUCH_HOLD_MS = 350;  // press-and-hold delay before a touch drag engages
const SCROLL_SLOP = 8;      // px of touch movement that means "scrolling, not holding"

/* ---------- drag to draw (mouse: drag; touch: hold, then drag) ---------- */
function startDraw(e) {
  if (e.button !== 0 || !e.isPrimary || e.target.closest(".cal-block")) return;

  const dayEl = e.currentTarget;
  const touch = e.pointerType !== "mouse";
  if (!touch) e.preventDefault();          // mouse: stop text selection, as before

  const rect = dayEl.getBoundingClientRect();
  const minAt = clientY =>
    clamp(Math.round(((clientY - rect.top) / HOUR_H) * 60 / SNAP_MIN) * SNAP_MIN, 0, DAY_END);

  const anchor = minAt(e.clientY);
  const startX = e.clientX, startY = e.clientY;
  let a = anchor, b = anchor;
  let engaged = !touch;                    // mouse engages immediately
  let cancelled = false;
  let holdTimer = null;

  function makeGhost() {
    ghostEl = document.createElement("div");
    ghostEl.className = "cal-ghost";
    dayEl.appendChild(ghostEl);
  }

  function engage() {
    engaged = true;
    makeGhost();
    document.body.classList.add("dragging");
    drawGhost(a, Math.max(b, a + SNAP_MIN));
  }

  function drawGhost(lo, hi) {
    ghostEl.style.top = `${(lo / 60) * HOUR_H}px`;
    ghostEl.style.height = `${((hi - lo) / 60) * HOUR_H}px`;
    ghostEl.textContent = `${fmtTime(lo)} – ${fmtTime(hi)}`;
  }

  const stopScroll = ev => { if (engaged) ev.preventDefault(); };

  function cleanup() {
    clearTimeout(holdTimer);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", stopScroll);
    document.body.classList.remove("dragging");
  }

  function onMove(ev) {
    if (ev.pointerId !== e.pointerId) return;
    if (!engaged) {                        // touch, still waiting for the hold
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > SCROLL_SLOP) {
        cancelled = true;                  // user is scrolling — let the browser have it
        cleanup();
      }
      return;
    }
    b = minAt(ev.clientY);
    drawGhost(Math.min(a, b), Math.max(Math.min(a, b) + SNAP_MIN, Math.max(a, b)));
  }

  function onUp(ev) {
    if (ev.pointerId !== e.pointerId) return;
    cleanup();
    if (cancelled) return;

    let start = Math.min(a, b), end = Math.max(a, b);
    if (end - start < SNAP_MIN) {          // simple click/tap: default 1-hour block
      end = Math.min(start + 60, DAY_END);
      start = end - 60;
    }
    if (!ghostEl) makeGhost();             // touch tap skipped engage(): still show the ghost
    drawGhost(start, end);
    openEntryDialog(null, { date: dayEl.dataset.date, start, end });
  }

  function onCancel(ev) {
    if (ev.pointerId !== e.pointerId) return;
    cancelled = true;
    cleanup();
    removeGhost();
  }

  if (touch) holdTimer = setTimeout(engage, TOUCH_HOLD_MS);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  if (touch) window.addEventListener("touchmove", stopScroll, { passive: false });
}

function removeGhost() {
  if (ghostEl) { ghostEl.remove(); ghostEl = null; }
}

/* ---------- drag a block to another day/time (Alt/⌘ = duplicate) ----------
   Mouse: click = edit, drag (after a 4px threshold) = move, Alt/⌘-drag = copy.
   Touch: tap = edit, press-and-hold lifts the block, then drag moves it.
   (Copying on touch: use the Duplicate button in the edit dialog.) */
const DRAG_THRESHOLD = 4;   // px of mouse movement before a click becomes a drag

function startBlockDrag(e, el) {
  if (e.button !== 0 || !e.isPrimary) return;
  const entry = Store.state.entries.find(x => x.id === el.dataset.entry);
  if (!entry || entry.start == null || entry.end == null) return;

  const touch = e.pointerType !== "mouse";
  if (!touch) e.preventDefault();          // mouse: stop text selection, as before
  e.stopPropagation();       // don't let the day column start drawing a new block

  const duration = entry.end - entry.start;
  const cols = [...document.querySelectorAll(".wg-day")].map(c => {
    const r = c.getBoundingClientRect();
    return { date: c.dataset.date, left: r.left, right: r.right, top: r.top, el: c };
  });
  const origin = cols.find(c => c.date === entry.date) || cols[0];
  const grabOffset = clientToMin(e.clientY, origin.top) - entry.start; // where on the block we grabbed

  const startX = e.clientX, startY = e.clientY;
  let moved = false, place = null;
  let engaged = !touch;                    // mouse can start dragging right away
  let cancelled = false;
  let holdTimer = null;
  const isCopy = ev => ev.altKey || ev.metaKey || ev.ctrlKey;

  function lift() {                        // visual "picked up" state
    engaged = true;
    moved = true;
    document.body.classList.add("dragging-block");
    el.classList.add("dragging");
    hideTip();
  }

  const stopScroll = ev => { if (engaged) ev.preventDefault(); };

  function cleanup() {
    clearTimeout(holdTimer);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", stopScroll);
    document.body.classList.remove("dragging-block");
    el.classList.remove("dragging", "copying");
  }

  function onMove(ev) {
    if (ev.pointerId !== e.pointerId) return;
    if (!engaged) {                        // touch, still waiting for the hold
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > SCROLL_SLOP) {
        cancelled = true;                  // user is scrolling — bow out
        cleanup();
      }
      return;
    }
    if (!moved &&
        Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
        Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
    if (!moved) lift();
    const col = columnAt(ev.clientX, cols);
    place = placeBlock(duration, col.date, clientToMin(ev.clientY, col.top) - grabOffset);
    el.classList.toggle("copying", isCopy(ev));
    if (el.parentElement !== col.el) col.el.appendChild(el);   // live preview across columns
    el.style.top = `${place.start / 60 * HOUR_H}px`;
    el.style.left = "2px";
    el.style.width = "calc(100% - 4px)";
  }

  function onUp(ev) {
    if (ev.pointerId !== e.pointerId) return;
    cleanup();
    if (cancelled) return;

    if (!moved || !place) { openEntryDialog(entry); return; }  // click/tap -> edit
    if (isCopy(ev)) {
      Store.state.entries.push({ id: uid(), projectId: entry.projectId, description: entry.description, ...place });
      flashHint(`Copied to ${fmtTime(place.start)} on ${fmtDayLabel(place.date)}`);
    } else {
      Object.assign(entry, place);
    }
    Store.save();
    renderAll();
  }

  function onCancel(ev) {
    if (ev.pointerId !== e.pointerId) return;
    cancelled = true;
    cleanup();
    renderAll();               // put the block back where it was
  }

  if (touch) holdTimer = setTimeout(lift, TOUCH_HOLD_MS);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  if (touch) window.addEventListener("touchmove", stopScroll, { passive: false });
}

/* ---------- copy / paste (⌘/Ctrl+C on a block, ⌘/Ctrl+V over a day) ---------- */
function trackCursor(e) {
  const block = e.target.closest(".cal-block");
  hoverEntryId = block ? block.dataset.entry : null;
  const dayEl = e.target.closest(".wg-day");
  cursorGrid = dayEl
    ? { date: dayEl.dataset.date, min: clientToMin(e.clientY, dayEl.getBoundingClientRect().top) }
    : null;
}

function onCalKey(e) {
  if (currentEntryView() !== "week") return;
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
  if ([...document.querySelectorAll("dialog")].some(d => d.open)) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;

  const key = e.key.toLowerCase();
  if (key === "c") {
    const en = hoverEntryId && Store.state.entries.find(x => x.id === hoverEntryId);
    if (!en || en.start == null || en.end == null) return;
    clipboardEntry = { projectId: en.projectId, description: en.description, duration: en.end - en.start };
    e.preventDefault();
    const p = getProject(en.projectId);
    const name = en.description || (p ? p.name : "block");
    flashHint(`Copied “${name}” — point at a day and press ${modKey()}V to paste`);
  } else if (key === "v") {
    if (!clipboardEntry || !cursorGrid) return;
    e.preventDefault();
    const place = placeBlock(clipboardEntry.duration, cursorGrid.date, cursorGrid.min);
    Store.state.entries.push({
      id: uid(), projectId: clipboardEntry.projectId, description: clipboardEntry.description, ...place,
    });
    Store.save();
    renderAll();
    flashHint(`Pasted at ${fmtTime(place.start)} on ${fmtDayLabel(place.date)}`);
  }
}

function modKey() {
  return /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+";
}

/* Brief self-dismissing confirmation toast, reused for drag-copy and paste. */
function flashHint(msg) {
  let t = document.getElementById("calToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "calToast";
    t.className = "cal-toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

/* ---------- entry dialog ---------- */
function initEntryDialog() {
  const dlg = document.getElementById("entryDialog");

  document.getElementById("dialogForm").addEventListener("submit", e => {
    e.preventDefault();
    saveDialog();
  });
  document.getElementById("dialogCancel").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", removeGhost);
  dlg.addEventListener("cancel", removeGhost);

  for (const id of ["dialogStart", "dialogEnd"]) {
    document.getElementById(id).addEventListener("input", updateDialogDuration);
  }

  document.getElementById("dialogDelete").addEventListener("click", () => {
    const en = Store.state.entries.find(x => x.id === dialogEntryId);
    if (!en) return;
    if (!confirm("Delete this entry?")) return;
    Store.state.entries = Store.state.entries.filter(x => x.id !== dialogEntryId);
    dlg.close();
    Store.save();
    renderAll();
  });

  // Duplicate: the no-keyboard way to copy an entry (the only way on touch).
  // Creates the copy, then reopens the dialog on it so date/time can be adjusted.
  document.getElementById("dialogDuplicate").addEventListener("click", () => {
    const en = Store.state.entries.find(x => x.id === dialogEntryId);
    if (!en) return;
    const copy = { ...en, id: uid() };
    Store.state.entries.push(copy);
    dlg.close();
    Store.save();
    renderAll();
    openEntryDialog(copy);
    flashHint("Duplicated — adjust the copy's date or time, then Save");
  });
}

function openEntryDialog(entry, draft) {
  dialogEntryId = entry ? entry.id : null;
  dialogDraft = draft || null;

  const sel = document.getElementById("dialogProject");
  sel.innerHTML = [`<option value="">(No project)</option>`]
    .concat(activeProjects().map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`))
    .concat([`<option value="__new__">+ New project…</option>`])
    .join("");

  document.getElementById("dialogTitle").textContent = entry ? "Edit time entry" : "New time entry";
  sel.value = entry ? (entry.projectId || "") : lastDialogProject;
  if (![...sel.options].some(o => o.value === sel.value)) sel.value = "";
  document.getElementById("dialogDesc").value = entry ? entry.description : "";
  document.getElementById("dialogDate").value = entry ? entry.date : draft.date;
  document.getElementById("dialogStart").value = fmtTime(entry ? entry.start : draft.start);
  document.getElementById("dialogEnd").value = fmtTime(entry ? entry.end : draft.end);
  document.getElementById("dialogDelete").classList.toggle("hidden", !entry);
  document.getElementById("dialogDuplicate").classList.toggle("hidden", !entry);
  updateDialogDuration();

  document.getElementById("entryDialog").showModal();
  document.getElementById("dialogDesc").focus();
}

function updateDialogDuration() {
  const s = parseTimeToMin(document.getElementById("dialogStart").value);
  const e = parseTimeToMin(document.getElementById("dialogEnd").value);
  const el = document.getElementById("dialogDuration");
  if (s == null || e == null) { el.textContent = ""; return; }
  el.textContent = e > s ? `Duration: ${fmtHours((e - s) / 60)}` : "End must be after start";
  el.classList.toggle("invalid", e <= s);
}

function saveDialog() {
  const date = document.getElementById("dialogDate").value;
  const start = parseTimeToMin(document.getElementById("dialogStart").value);
  const end = parseTimeToMin(document.getElementById("dialogEnd").value);
  if (!date || start == null || end == null) return;
  if (end <= start) { updateDialogDuration(); return; }

  const rawProject = document.getElementById("dialogProject").value;
  const fields = {
    date,
    projectId: rawProject && rawProject !== "__new__" ? rawProject : null,
    description: document.getElementById("dialogDesc").value.trim(),
    start,
    end,
    hours: Math.round(((end - start) / 60) * 100) / 100,
  };
  lastDialogProject = fields.projectId || "";

  if (dialogEntryId) {
    const en = Store.state.entries.find(x => x.id === dialogEntryId);
    if (en) Object.assign(en, fields);
  } else {
    Store.state.entries.push({ id: uid(), ...fields });
    if (dialogDraft) calWeekStart = startOfWeek(fromDateStr(date));
  }

  document.getElementById("entryDialog").close();
  Store.save();
  renderAll();
}
