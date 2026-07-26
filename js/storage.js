/* TimeTracker (web version) — persistence via the browser's own localStorage.
   No server, no network: your data lives only in this browser, on this device.

   The public surface (Store.state / load / save / saveNow) is identical to the
   server-backed desktop version, so every other file in the app is unchanged.
   Extra: exportJSON / importJSON power the Back up / Restore buttons. */
"use strict";

const STORAGE_KEY = "timetracker_v1";
const BACKUP_KEY  = "timetracker_v1_unreadable_backup";

/* The empty starting state (previously provided by the Python server). */
function defaultData() {
  return {
    projects: [],
    entries: [],
    timer: { running: false, startedAt: null, projectId: null, description: "" },
    settings: { theme: "auto", weekStartsMonday: true, entryView: "week",
                reportBy: "", reportFor: "" },
  };
}

/* Fill in any missing top-level keys so an older or partial save still loads. */
function mergeWithDefaults(data) {
  const base = defaultData();
  if (!data || typeof data !== "object") return base;
  return {
    projects: Array.isArray(data.projects) ? data.projects : base.projects,
    entries:  Array.isArray(data.entries)  ? data.entries  : base.entries,
    timer:    (data.timer && typeof data.timer === "object")    ? { ...base.timer, ...data.timer }       : base.timer,
    settings: (data.settings && typeof data.settings === "object") ? { ...base.settings, ...data.settings } : base.settings,
  };
}

/* Validate an imported backup before trusting it. Returns {ok, error}. */
function validateImport(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "That file isn't a data object." };
  if (!Array.isArray(obj.projects))    return { ok: false, error: 'Missing or invalid "projects" list.' };
  if (!Array.isArray(obj.entries))     return { ok: false, error: 'Missing or invalid "entries" list.' };
  for (const e of obj.entries) {
    if (!e || typeof e !== "object" || typeof e.date !== "string" || typeof e.hours !== "number") {
      return { ok: false, error: "One or more entries are malformed (each needs a date and hours)." };
    }
  }
  return { ok: true };
}

const Store = {
  state: null,
  _saveTimer: null,

  /* Kept async so the existing `await Store.load()` in app.js is unchanged. */
  async load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.state = raw ? mergeWithDefaults(JSON.parse(raw)) : defaultData();
    } catch (err) {
      // Preserve the unreadable data instead of destroying it, then start clean.
      try { localStorage.setItem(BACKUP_KEY, localStorage.getItem(STORAGE_KEY) || ""); } catch (_) {}
      console.error(`Saved data was unreadable — starting empty. A copy was kept under "${BACKUP_KEY}".`, err);
      this.state = defaultData();
    }
  },

  /* Debounced save for rapid edits; timer start/stop uses saveNow(). */
  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 400);
  },

  saveNow() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.error(err);
      alert("Could not save — your browser's storage may be full or disabled (private mode?).");
    }
  },

  /* Full-fidelity backup: the exact data, pretty-printed. */
  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  },

  /* Restore from a backup string. Returns {ok, error}; replaces all data on success. */
  importJSON(text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (_) { return { ok: false, error: "That file isn't valid JSON." }; }
    const v = validateImport(obj);
    if (!v.ok) return v;
    this.state = mergeWithDefaults(obj);
    this.saveNow();
    return { ok: true };
  },
};

/* Flush any pending debounced save when the tab closes (localStorage is sync). */
window.addEventListener("pagehide", () => {
  if (Store._saveTimer && Store.state) Store.saveNow();
});

/* ---------- Shared accessors (identical to the server version) ---------- */
function getProject(id) {
  return Store.state.projects.find(p => p.id === id) || null;
}

function activeProjects() {
  return Store.state.projects.filter(p => !p.archived);
}

/* Fill every project <select> with the current project list */
function renderProjectSelects() {
  const options = [`<option value="">(No project)</option>`]
    .concat(activeProjects().map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`))
    .concat([`<option value="__new__">+ New project…</option>`])
    .join("");
  for (const id of ["timerProject", "entryProject"]) {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = options;
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  }
  const t = Store.state.timer;
  if (t.running && t.projectId) document.getElementById("timerProject").value = t.projectId;
}
