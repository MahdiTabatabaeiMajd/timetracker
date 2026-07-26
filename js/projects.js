/* TimeTracker — Projects view: create, rename, recolor, archive, delete */
"use strict";

let selectedColor = PALETTE[0].key;

function initProjects() {
  initProjectDialog();
  selectedColor = nextFreeColor();
  renderColorPicker();
  document.getElementById("projectForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = document.getElementById("projectName").value.trim();
    if (!name) return;
    if (Store.state.projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return alert("A project with that name already exists.");
    }
    Store.state.projects.push({ id: uid(), name, color: selectedColor, archived: false });
    document.getElementById("projectName").value = "";
    selectedColor = nextFreeColor();
    renderColorPicker();
    Store.save();
    renderAll();
  });
}

/* "+ New project…" option inside the project dropdowns (Timer bar, entry
   form, calendar dialog): prompts for a name and creates it on the spot. */
function initProjectQuickAdd() {
  for (const id of ["timerProject", "entryProject", "dialogProject"]) {
    const sel = document.getElementById(id);
    sel.addEventListener("focus", () => {
      if (sel.value !== "__new__") sel.dataset.prev = sel.value;
    });
    sel.addEventListener("change", () => {
      if (sel.value !== "__new__") {
        sel.dataset.prev = sel.value;
        return;
      }
      sel.value = sel.dataset.prev || ""; // revert while the dialog is open
      openProjectDialog({
        onCreated: project => {
          // the entry dialog's select is only rebuilt on open — patch it directly
          if (![...sel.options].some(o => o.value === project.id)) {
            const opt = document.createElement("option");
            opt.value = project.id;
            opt.textContent = project.name;
            sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
          }
          sel.value = project.id;
          sel.dispatchEvent(new Event("change")); // let the timer listener react too
        },
      });
    });
  }
}

/* Prefer a palette slot no active project uses yet */
function nextFreeColor() {
  const used = new Set(activeProjects().map(p => p.color));
  return (PALETTE.find(p => !used.has(p.key)) || PALETTE[0]).key;
}

/* Shared swatch picker: 16 palette swatches + a color-wheel "any color" swatch.
   onPick(color, {silent}) — silent means "don't re-render", used while the
   native color wheel is open so live-dragging doesn't destroy the input. */
function renderSwatchPicker(host, selected, onPick) {
  const custom = isHexColor(selected);
  const wheel = "conic-gradient(#e34948,#eda100,#008300,#1baf7a,#2a78d6,#4a3aa7,#e87ba4,#e34948)";
  host.innerHTML = PALETTE.map(p => `
    <button type="button" role="radio" aria-checked="${p.key === selected}"
      class="color-swatch ${p.key === selected ? "selected" : ""}"
      style="--sw:${colorVar(p.key)}" data-color="${p.key}"
      aria-label="${p.label}" title="${p.label}"></button>`).join("") + `
    <label class="color-swatch custom ${custom ? "selected" : ""}"
      style="--sw:${custom ? selected : wheel}" title="Any color…">
      <input type="color" value="${custom ? selected : "#7c5cbf"}" aria-label="Pick any color">
    </label>`;

  host.querySelectorAll("[data-color]").forEach(b =>
    b.addEventListener("click", () => onPick(b.dataset.color, {})));

  const label = host.querySelector("label.custom");
  label.querySelector("input").addEventListener("input", e => {
    host.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
    label.classList.add("selected");
    label.style.setProperty("--sw", e.target.value);
    onPick(e.target.value, { silent: true });
  });
}

function renderColorPicker() {
  renderSwatchPicker(document.getElementById("colorPicker"), selectedColor, (c, o) => {
    selectedColor = c;
    if (!o.silent) renderColorPicker();
  });
}

/* ---------- New/Edit project dialog (also used by "+ New project…") ---------- */
let projectDialogState = null;

function openProjectDialog(opts = {}) {
  const p = opts.project || null;
  projectDialogState = {
    project: p,
    onCreated: opts.onCreated || null,
    color: p ? p.color : nextFreeColor(),
  };
  document.getElementById("projectDialogTitle").textContent = p ? "Edit project" : "New project";
  document.getElementById("projectDialogSave").textContent = p ? "Save" : "Create";
  document.getElementById("projectDialogName").value = p ? p.name : "";
  renderProjectDialogSwatches();
  document.getElementById("projectDialog").showModal();
  document.getElementById("projectDialogName").focus();
}

function renderProjectDialogSwatches() {
  renderSwatchPicker(document.getElementById("projectDialogColors"),
    projectDialogState.color, (c, o) => {
      projectDialogState.color = c;
      if (!o.silent) renderProjectDialogSwatches();
    });
}

function initProjectDialog() {
  document.getElementById("projectDialogCancel").addEventListener("click", () =>
    document.getElementById("projectDialog").close());

  document.getElementById("projectDialogForm").addEventListener("submit", e => {
    e.preventDefault();
    const st = projectDialogState;
    const name = document.getElementById("projectDialogName").value.trim();
    if (!name) return;
    const clash = Store.state.projects.find(x =>
      x.name.toLowerCase() === name.toLowerCase() && x !== st.project);

    let project;
    if (st.project) {
      if (clash) return alert("Another project already has that name.");
      st.project.name = name;
      st.project.color = st.color;
      project = st.project;
    } else if (clash) {
      clash.archived = false; // same name typed again: just select the existing one
      project = clash;
    } else {
      project = { id: uid(), name, color: st.color, archived: false };
      Store.state.projects.push(project);
    }

    document.getElementById("projectDialog").close();
    Store.save();
    renderAll();
    if (st.onCreated) st.onCreated(project);
  });
}

function renderProjects() {
  const host = document.getElementById("projectList");
  const projects = Store.state.projects;
  if (!projects.length) {
    host.innerHTML = `<div class="card empty-state">
      <strong>No projects yet</strong>
      Projects give your entries a color and unlock the per-project reports.
    </div>`;
    return;
  }

  const hoursBy = {};
  const countBy = {};
  for (const en of Store.state.entries) {
    const k = en.projectId || "";
    hoursBy[k] = (hoursBy[k] || 0) + en.hours;
    countBy[k] = (countBy[k] || 0) + 1;
  }

  const rows = projects.map(p => `
    <div class="project-row">
      <span class="proj-chip">
        <span class="proj-dot" style="--dot:${colorVar(p.color)}"></span>
        <span class="proj-name">${escapeHtml(p.name)}</span>
        ${p.archived ? `<span class="badge">archived</span>` : ""}
      </span>
      <span class="project-stats">${fmtHours(hoursBy[p.id] || 0)} · ${countBy[p.id] || 0} entries</span>
      <span class="entry-actions">
        <button class="icon-btn" data-editproj="${p.id}" aria-label="Edit project" title="Edit name & color">
          <svg viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z M13.5 6.5l3 3"/></svg>
        </button>
        <button class="icon-btn" data-archive="${p.id}" aria-label="${p.archived ? "Unarchive" : "Archive"} project" title="${p.archived ? "Unarchive" : "Archive"}">
          <svg viewBox="0 0 24 24"><path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4"/></svg>
        </button>
        <button class="icon-btn danger" data-delproj="${p.id}" aria-label="Delete project" title="Delete">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
        </button>
      </span>
    </div>`).join("");

  host.innerHTML = `<div class="entry-rows">${rows}</div>`;

  host.querySelectorAll("[data-editproj]").forEach(b => b.addEventListener("click", () =>
    openProjectDialog({ project: getProject(b.dataset.editproj) })));

  host.querySelectorAll("[data-archive]").forEach(b => b.addEventListener("click", () => {
    const p = getProject(b.dataset.archive);
    p.archived = !p.archived;
    Store.save();
    renderAll();
  }));

  host.querySelectorAll("[data-delproj]").forEach(b => b.addEventListener("click", () => {
    const p = getProject(b.dataset.delproj);
    const n = Store.state.entries.filter(e => e.projectId === p.id).length;
    if (n > 0) {
      return alert(`"${p.name}" has ${n} time ${n === 1 ? "entry" : "entries"}.\nArchive it instead to keep your history — delete its entries first if you really want it gone.`);
    }
    if (!confirm(`Delete project "${p.name}"?`)) return;
    Store.state.projects = Store.state.projects.filter(x => x.id !== p.id);
    Store.save();
    renderAll();
  }));
}
