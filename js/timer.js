/* TimeTracker — live start/stop timer (start timestamp persists on disk) */
"use strict";

let timerInterval = null;

function initTimer() {
  document.getElementById("timerBtn").addEventListener("click", toggleTimer);

  document.getElementById("timerDesc").addEventListener("input", e => {
    if (Store.state.timer.running) {
      Store.state.timer.description = e.target.value;
      Store.save();
    }
  });
  document.getElementById("timerProject").addEventListener("change", e => {
    if (Store.state.timer.running) {
      Store.state.timer.projectId = e.target.value || null;
      Store.save();
    }
  });

  const t = Store.state.timer;
  if (t.running) {
    document.getElementById("timerDesc").value = t.description || "";
    startTicking();
  }
  updateTimerUI();
}

function toggleTimer() {
  const t = Store.state.timer;
  if (t.running) {
    stopTimer();
  } else {
    t.running = true;
    t.startedAt = Date.now();
    t.projectId = document.getElementById("timerProject").value || null;
    t.description = document.getElementById("timerDesc").value.trim();
    Store.saveNow();
    startTicking();
    updateTimerUI();
  }
}

function stopTimer() {
  const t = Store.state.timer;
  const elapsedH = (Date.now() - t.startedAt) / 3.6e6;
  const hours = Math.max(0.01, Math.round(elapsedH * 100) / 100);

  if (elapsedH * 3600 < 30 &&
      !confirm("Timer ran for less than 30 seconds — save this entry anyway?")) {
    // discard
  } else {
    const startDate = new Date(t.startedAt);
    const entry = {
      id: uid(),
      date: toDateStr(startDate),
      projectId: t.projectId,
      description: t.description,
      hours,
    };
    if (entry.date === todayStr()) { // same-day: keep clock times so it shows on the calendar
      entry.start = startDate.getHours() * 60 + startDate.getMinutes();
      entry.end = Math.min(24 * 60, Math.max(entry.start + 1, Math.round(entry.start + hours * 60)));
    }
    Store.state.entries.push(entry);
  }

  Store.state.timer = { running: false, startedAt: null, projectId: null, description: "" };
  clearInterval(timerInterval);
  timerInterval = null;
  document.getElementById("timerDesc").value = "";
  Store.saveNow();
  updateTimerUI();
  renderAll();
}

function startTicking() {
  clearInterval(timerInterval);
  tick();
  timerInterval = setInterval(tick, 1000);
}

function tick() {
  const t = Store.state.timer;
  if (!t.running) return;
  const clock = fmtClock((Date.now() - t.startedAt) / 1000);
  document.getElementById("timerClock").textContent = clock;
  document.title = `▶ ${clock} · TimeTracker`;
}

function updateTimerUI() {
  const t = Store.state.timer;
  const btn = document.getElementById("timerBtn");
  btn.classList.toggle("running", t.running);
  btn.setAttribute("aria-label", t.running ? "Stop timer" : "Start timer");
  document.getElementById("timerIconPlay").classList.toggle("hidden", t.running);
  document.getElementById("timerIconStop").classList.toggle("hidden", !t.running);
  if (!t.running) {
    document.getElementById("timerClock").textContent = "0:00:00";
    document.title = "TimeTracker";
  }
}
