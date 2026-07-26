/* TimeTracker (web version) — Back up / Restore all your data as a JSON file.
   This is how you carry data between devices or browsers (there is no server to
   sync it) and how you bring in data from the desktop version's
   data/timetracker.json. Self-initializing so app.js needs no changes. */
"use strict";

function initBackup() {
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const fileInput = document.getElementById("importFile");
  if (!exportBtn || !importBtn || !fileInput) return;

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([Store.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timetracker-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const count = (Store.state.entries || []).length;
      const proceed = !count || confirm(
        `Import will REPLACE the data in this browser ` +
        `(${count} ${count === 1 ? "entry" : "entries"} right now).\n\n` +
        `Tip: press "Back up" first if you want to keep the current data. Continue?`);
      if (!proceed) { fileInput.value = ""; return; }

      const res = Store.importJSON(String(reader.result));
      if (res.ok) {
        renderAll();
        applyTheme();
        alert("Import complete — your data has been restored into this browser.");
      } else {
        alert(`Import failed: ${res.error}\n\nNothing was changed.`);
      }
      fileInput.value = "";
    };
    reader.onerror = () => { alert("Could not read that file."); fileInput.value = ""; };
    reader.readAsText(file);
  });
}

document.addEventListener("DOMContentLoaded", initBackup);
