/* TimeTracker — manual entries: add/edit/delete + grouped day list */
"use strict";

let editingEntryId = null;

function initEntries() {
  const form = document.getElementById("entryForm");
  document.getElementById("entryDate").value = todayStr();

  form.addEventListener("submit", e => {
    e.preventDefault();
    const date = document.getElementById("entryDate").value;
    const hours = parseHoursInput(document.getElementById("entryHours").value);
    if (!date) return alert("Pick a date.");
    if (hours === null || hours <= 0 || hours > 24) {
      return alert("Enter hours like 1.5, 1:30, 90m or 2h15 (0–24h).");
    }
    const entry = {
      date,
      projectId: document.getElementById("entryProject").value || null,
      description: document.getElementById("entryDesc").value.trim(),
      hours: Math.round(hours * 100) / 100,
    };

    if (editingEntryId) {
      const existing = Store.state.entries.find(en => en.id === editingEntryId);
      if (existing) Object.assign(existing, entry);
      stopEditingEntry();
    } else {
      Store.state.entries.push({ id: uid(), ...entry });
      document.getElementById("entryDesc").value = "";
      document.getElementById("entryHours").value = "";
    }
    Store.save();
    renderAll();
  });

  document.getElementById("entryCancel").addEventListener("click", stopEditingEntry);
}

function startEditingEntry(id) {
  const en = Store.state.entries.find(e => e.id === id);
  if (!en) return;
  if (en.start != null && en.end != null) {  // timed entries edit in the calendar dialog
    openEntryDialog(en);
    return;
  }
  editingEntryId = id;
  document.getElementById("entryDate").value = en.date;
  document.getElementById("entryProject").value = en.projectId || "";
  document.getElementById("entryDesc").value = en.description;
  document.getElementById("entryHours").value = fmtHours(en.hours);
  document.getElementById("entrySubmit").textContent = "Save";
  document.getElementById("entryCancel").classList.remove("hidden");
  document.getElementById("entryDesc").focus();
}

function stopEditingEntry() {
  editingEntryId = null;
  document.getElementById("entryForm").reset();
  document.getElementById("entryDate").value = todayStr();
  document.getElementById("entrySubmit").textContent = "Add";
  document.getElementById("entryCancel").classList.add("hidden");
}

function deleteEntry(id) {
  const en = Store.state.entries.find(e => e.id === id);
  if (!en) return;
  const p = getProject(en.projectId);
  if (!confirm(`Delete this entry?\n${fmtDayLabel(en.date)} · ${p ? p.name : "No project"} · ${fmtHours(en.hours)}`)) return;
  Store.state.entries = Store.state.entries.filter(e => e.id !== id);
  if (editingEntryId === id) stopEditingEntry();
  Store.save();
  renderAll();
}

const MAX_DAY_GROUPS = 30;

function renderEntries() {
  const host = document.getElementById("entryList");
  const entries = Store.state.entries;

  if (!entries.length) {
    host.innerHTML = `<div class="card empty-state">
      <strong>No time tracked yet</strong>
      Start the timer above, or add an entry manually.
      ${Store.state.projects.length ? "" : `<br>Tip: create your first project in the <b>Projects</b> tab to get colored reports.`}
    </div>`;
    return;
  }

  const byDay = new Map();
  for (const en of entries) {
    if (!byDay.has(en.date)) byDay.set(en.date, []);
    byDay.get(en.date).push(en);
  }
  const days = [...byDay.keys()].sort().reverse();
  const shown = days.slice(0, MAX_DAY_GROUPS);

  let html = "";
  for (const day of shown) {
    const dayEntries = byDay.get(day);
    const total = dayEntries.reduce((s, e) => s + e.hours, 0);
    const rows = dayEntries.map(en => {
      const p = getProject(en.projectId);
      return `<div class="entry-row">
        <span class="proj-chip">
          <span class="proj-dot" style="--dot:${p ? colorVar(p.color) : "var(--series-none)"}"></span>
          <span class="proj-name ${p ? "" : "none"}">${p ? escapeHtml(p.name) : "No project"}</span>
        </span>
        <span class="entry-desc">${escapeHtml(en.description)}</span>
        ${en.start != null && en.end != null ? `<span class="entry-time">${fmtTime(en.start)} – ${fmtTime(en.end)}</span>` : ""}
        <span class="entry-hours">${fmtHours(en.hours)}</span>
        <span class="entry-actions">
          <button class="icon-btn" data-edit="${en.id}" aria-label="Edit entry" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z M13.5 6.5l3 3"/></svg>
          </button>
          <button class="icon-btn danger" data-del="${en.id}" aria-label="Delete entry" title="Delete">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
          </button>
        </span>
      </div>`;
    }).join("");

    html += `<div class="day-group">
      <div class="day-head">
        <span class="day-title">${fmtDayLabel(day)}</span>
        <span class="day-total">${fmtHours(total)}</span>
      </div>
      <div class="entry-rows">${rows}</div>
    </div>`;
  }
  if (days.length > shown.length) {
    html += `<p class="hint">Showing the ${MAX_DAY_GROUPS} most recent days — older entries stay in your data and reports.</p>`;
  }
  host.innerHTML = html;

  host.querySelectorAll("[data-edit]").forEach(b =>
    b.addEventListener("click", () => startEditingEntry(b.dataset.edit)));
  host.querySelectorAll("[data-del]").forEach(b =>
    b.addEventListener("click", () => deleteEntry(b.dataset.del)));
}
