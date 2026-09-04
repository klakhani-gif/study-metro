import { AppState, Exam, JourneyRecord, LINE_COLORS, MetroLine, Station, StationStatus, createEmptyState } from "./model.js";
import { examCountdown, examDateLabel, examProgress, validateExam } from "./exams.js";
import { loadState, resetState, saveState, storageNotice, isStorageReadOnly } from "./storage.js";
import { JourneyTimer, formatRemaining } from "./timer.js";
import { nameError, topicsError, validDuration } from "./validation.js";
import { displayLineColor, renderMetroMap } from "./metro.js";
import { relayoutStations } from "./layout.js";

let state: AppState = createEmptyState();
let lastSaved = structuredClone(state);
const timer = new JourneyTimer();
let activeStation: Station | null = null;
let timerInterval: number | null = null;
let closeConfirmation: (() => void) | null = null;

const appEl = document.querySelector<HTMLDivElement>("#app");
if (!appEl) throw new Error("#app not found");
const app: HTMLDivElement = appEl;

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanName(value: FormDataEntryValue | null, fallback = "Untitled"): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.slice(0, 64) || fallback;
}

function parseTopics(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\n|;/)
    .map((topic) => topic.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function stationById(id: string | null): Station | null {
  if (!id) return null;
  return state.stations.find((station) => station.id === id) ?? null;
}

function lineById(id: string | null): MetroLine | null {
  if (!id) return null;
  return state.lines.find((line) => line.id === id) ?? null;
}

function lineName(lineId: string): string {
  return lineById(lineId)?.name ?? "LINE";
}

function totalFocusedSeconds(): number {
  return state.history.reduce((sum, journey) => sum + journey.focusedSeconds, 0);
}

function totalCompletedStations(): number {
  return state.stations.filter((station) => station.status === "completed" || station.status === "mastered").length;
}

function formatHours(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function persist(): void {
  try { writeState(state); }
  catch {
    state = structuredClone(lastSaved);
    if (state.activeJourney) timer.restore(state.activeJourney.timer); else timer.reset();
    activeStation = stationById(state.activeJourney?.stationId ?? null);
    if (timerInterval !== null) window.clearInterval(timerInterval);
    timerInterval = null;
    showStorageError();
    throw new SaveFailure();
  }
}

class SaveFailure extends Error {}
function writeState(next: AppState): void { saveState(next); lastSaved = structuredClone(next); }
function showStorageError(): void {
  if (document.querySelector(".storage-error")) return;
  const message = document.createElement("div");
  message.className = "storage-error";
  message.setAttribute("role", "alert");
  message.innerHTML = `Changes could not be saved. Browser storage may be full, unavailable, or from a newer version. Reload to recover the last saved state. <button type="button">Reload</button>`;
  message.querySelector("button")!.addEventListener("click", () => location.reload());
  document.body.append(message);
}
window.addEventListener("error", (event) => { if (event.error instanceof SaveFailure) event.preventDefault(); });

function formError(form: Element, error: string | null): boolean {
  let message = form.querySelector<HTMLElement>(".validation-message");
  if (!message) { message = document.createElement("p"); message.className = "validation-message"; message.setAttribute("role", "alert"); form.append(message); }
  message.textContent = error ?? "";
  return !!error;
}

function relayoutAndPersist(): void {
  state = relayoutStations(state);
  persist();
}

function ensureSelection(): void {
  if (state.selectedStationId && stationById(state.selectedStationId)) return;
  state.selectedStationId = state.lines.flatMap((line) => line.stationIds)[0] ?? null;
}

function createLine(name: string, color: string, topics: string[]): { line: MetroLine; stations: Station[] } {
  const lineId = uid("line");
  const stations = (topics.length ? topics : ["First topic"]).map((topic) => ({
    id: uid("station"),
    lineId,
    name: topic,
    x: 0,
    y: 0,
    status: "not_started" as StationStatus,
    estimatedMinutes: 50
  }));
  const line: MetroLine = {
    id: lineId,
    name: name.slice(0, 40),
    color,
    stationIds: stations.map((station) => station.id)
  };
  return { line, stations };
}

function renderOnboarding(): void {
  document.body.classList.remove("focus-mode");
  app.innerHTML = `
    <main class="onboarding-shell">
      <header class="onboarding-brand">
        <a class="brand" href="#" aria-label="Study Metro home">
          <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
          <span>STUDY METRO</span>
        </a>
        <span class="build-label">PUBLIC BETA</span>
      </header>

      <section class="onboarding-grid">
        <div class="onboarding-copy">
          <p class="eyebrow">BUILD YOUR FIRST LINE</p>
          <h1>Turn your syllabus into a network.</h1>
          <p>Subjects become lines. Topics become stations. Every focused journey moves your real academic map forward.</p>
          <div class="onboarding-diagram" aria-hidden="true">
            <span class="diagram-line"></span>
            <i></i><i></i><i></i><i></i><i></i>
            <b>YOUR FIRST SUBJECT</b>
          </div>
        </div>

        <form class="setup-form" id="setup-form">
          <label>
            <span>What are you studying?</span>
            <input name="studyArea" maxlength="64" placeholder="e.g. Medicine" required autocomplete="off" />
          </label>
          <label>
            <span>Semester / exam period</span>
            <input name="periodName" maxlength="64" placeholder="e.g. Semester 4" required autocomplete="off" />
          </label>
          <div class="setup-rule"></div>
          <label>
            <span>First subject line</span>
            <input name="lineName" maxlength="40" placeholder="e.g. Anatomy" required autocomplete="off" />
          </label>
          <label>
            <span>Topics · one per line</span>
            <textarea name="topics" rows="7" placeholder="Thorax&#10;Abdomen&#10;Pelvis&#10;Perineum&#10;Head & Neck" required></textarea>
          </label>
          <label class="color-field">
            <span>Line colour</span>
            <input type="color" name="lineColor" value="${LINE_COLORS[0]}" />
          </label>
          <button class="primary-button" type="submit"><span>Generate my network</span><span>→</span></button>
          <small class="fine-print">Your network is saved in this browser on this device. Clearing browser data removes it.</small>
        </form>
      </section>
    </main>
  `;

  document.querySelector<HTMLFormElement>("#setup-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const topics = parseTopics(data.get("topics"));
    const form = event.currentTarget as HTMLFormElement;
    if (formError(form, nameError(String(data.get("studyArea"))) ?? nameError(String(data.get("periodName"))) ?? nameError(String(data.get("lineName")), [], 40) ?? topicsError(topics))) return;
    const { line, stations } = createLine(cleanName(data.get("lineName"), "My Subject"), String(data.get("lineColor") ?? LINE_COLORS[0]), topics);
    state = relayoutStations({
      ...state,
      profile: {
        studyArea: cleanName(data.get("studyArea"), "My Studies"),
        periodName: cleanName(data.get("periodName"), "Current Term"),
        createdAt: Date.now()
      },
      lines: [line],
      stations,
      selectedStationId: stations[0]?.id ?? null,
      activeJourney: null
    });
    persist();
    render();
  });

}

function examDaysMessage(days: number): string {
  if (days === 0) return "Exam today";
  return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ${days > 0 ? "until" : "since"} exam`;
}

function renderExamBoard(exam: Exam): string {
  const line = lineById(exam.lineId);
  const stats = examProgress(state, exam);
  const code = String(state.lines.findIndex((item) => item.id === exam.lineId) + 1).padStart(2, "0");
  return `<aside class="journey-panel exam-board" aria-label="Exam terminal details" data-exam-id="${escapeHtml(exam.id)}" style="--route-color:${displayLineColor(line?.color ?? "#eeeae2")}">
    <div class="departure-heading"><p class="eyebrow">EXAM TERMINAL</p><span>${code} / E</span></div>
    <div class="station-information">
      <div class="route-badge"><span class="route-code">${code}</span><span>${escapeHtml(line?.name.toUpperCase() ?? "LINE")}</span></div>
      <h2>${escapeHtml(exam.name)}</h2>
      <p class="exam-date">${examDateLabel(exam.examDate)}</p>
      <p class="exam-days" data-exam-days-message>${examDaysMessage(stats.daysRemaining)}</p>
      <dl class="station-facts exam-facts">
        <div><dt>Total study stations</dt><dd>${stats.total}</dd></div>
        <div><dt>Completed</dt><dd>${stats.completed}</dd></div>
        <div><dt>Remaining</dt><dd>${stats.remaining}</dd></div>
        <div><dt>Estimated remaining</dt><dd>${stats.estimatedMinutes}<span> min</span></dd></div>
      </dl>
      ${exam.targetCompletionDate ? `<p class="exam-target">Target completion<br><strong>${examDateLabel(exam.targetCompletionDate)}</strong></p>` : ""}
      <p class="exam-status" data-exam-status>${stats.status}</p>
      <p class="exam-note">Pace check: one unfinished station per calendar day, before ${exam.targetCompletionDate ? "your target date" : "the exam date"}.</p>
    </div>
    <div class="exam-board-actions"><button class="secondary-button" data-action="edit-exam" data-line-id="${escapeHtml(exam.lineId)}">Edit exam <span aria-hidden="true">↗</span></button><button class="text-button danger" data-action="remove-selected-exam">Remove exam</button><p class="exam-note">Select a study station on the map to begin a journey.</p></div>
  </aside>`;
}

function render(): void {
  if (!state.profile || !state.lines.length) {
    renderOnboarding();
    return;
  }

  ensureSelection();
  const selected = stationById(state.selectedStationId);
  const selectedExam = state.exams.find((exam) => exam.id === state.selectedExamId) ?? null;
  if (!selected) {
    app.innerHTML = `<main class="modal-card"><p class="eyebrow">STUDY METRO</p><h1>Your network needs a station.</h1><p>Add a topic to an existing line to begin. Your saved lines and history are still here.</p><button class="secondary-button" id="repair-network">Edit network</button></main><div id="modal-root"></div>`;
    document.querySelector("#repair-network")?.addEventListener("click", () => showNetworkEditor(state.lines[0]?.id ?? null));
    return;
  }

  const selectedDuration = state.preferredDuration;
  const quickDurations = [25, 50, 90];
  const isQuickDuration = quickDurations.includes(selectedDuration);
  const periodLabel = state.profile.periodName.toUpperCase();
  const selectedLine = lineById(selected.lineId);
  const selectedLineCode = String(state.lines.findIndex((line) => line.id === selected.lineId) + 1).padStart(2, "0");
  const selectedStationCode = String((selectedLine?.stationIds.indexOf(selected.id) ?? 0) + 1).padStart(2, "0");

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" aria-label="Study Metro home">
        <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
        <span>STUDY METRO</span>
      </a>
      <nav class="nav-tabs" aria-label="Primary">
        <button class="nav-tab is-active">Network</button>
        <button class="nav-tab" data-action="history">Journey log</button>
        <button class="nav-tab" data-action="edit-network">Edit network</button>
      </nav>
    </header>

    <main class="shell">
      <section class="network-panel">
        <div class="network-heading">
          <div>
            <p class="eyebrow">${escapeHtml(state.profile.studyArea.toUpperCase())} · ${escapeHtml(periodLabel)}</p>
            <h1>Your study network.</h1>
          </div>
          <div class="network-heading-actions">
            <button class="text-button network-add-exam" data-action="add-exam">+ Add exam</button>
            <div class="network-stats" aria-label="Study statistics">
              <div><strong>${state.history.length}</strong><span>journeys</span></div>
              <div><strong>${totalCompletedStations()}</strong><span>stations</span></div>
              <div><strong>${formatHours(totalFocusedSeconds())}</strong><span>focused</span></div>
            </div>
          </div>
        </div>

        <div id="map-root" class="map-wrap" tabindex="0" role="region" aria-label="Study network map. Scroll to explore all stations."></div>

        <div class="legend" aria-label="Station legend">
          <span><i class="legend-dot completed"></i>Completed</span>
          <span><i class="legend-dot active"></i>In progress</span>
          <span><i class="legend-dot empty"></i>Not started</span>
          <span><i class="legend-dot terminal"></i>Terminal</span>
        </div>
      </section>

      ${selectedExam ? renderExamBoard(selectedExam) : `<aside class="journey-panel" aria-label="Station departure board" style="--route-color:${displayLineColor(selectedLine?.color ?? "#eeeae2")}">
        <div class="departure-heading"><p class="eyebrow">DEPARTURE BOARD</p><span>${selectedLineCode} / ${selectedStationCode}</span></div>
        <div class="station-information">
          <div class="route-badge"><span class="route-code">${selectedLineCode}</span><span>${escapeHtml(lineName(selected.lineId).toUpperCase())}</span></div>
          <p class="board-label">SELECTED STATION</p>
          <h2>${escapeHtml(selected.name)}</h2>
          <dl class="station-facts"><div><dt>Estimated study time</dt><dd>${selected.estimatedMinutes}<span> min</span></dd></div></dl>
        </div>
        <div class="departure-settings">
        <p class="board-label">FOCUS DURATION <span>MINUTES</span></p>
        <div class="duration-picker" role="group" aria-label="Focus duration">
          ${quickDurations.map((duration) => `<button class="duration-button ${selectedDuration === duration ? "is-selected" : ""}" data-duration="${duration}" aria-label="${duration} minutes, ${duration === 25 ? "Local" : duration === 50 ? "Express" : "Limited"}"><strong>${duration}</strong><span>${duration === 25 ? "Local" : duration === 50 ? "Express" : "Limited"}</span></button>`).join("")}
        </div>
        <label class="custom-duration">
          <span>Custom</span>
          <input id="custom-duration" type="number" inputmode="numeric" min="5" max="240" value="${isQuickDuration ? "" : selectedDuration}" placeholder="min" />
        </label>
        <p class="duration-label">${selectedDuration} minutes · ${durationMode(selectedDuration)}</p>
        </div>
        <div class="departure-service">
        <div class="service-status">
          <span class="status-light ${selected.status === "revision_due" ? "is-warning" : ""}"></span>
          <div>
            <strong>${selected.status === "revision_due" ? "Maintenance due" : "Normal service"}</strong>
            <small>${selected.status === "revision_due" ? "A revision journey is recommended" : "Ready for departure"}</small>
          </div>
        </div>
        <button class="primary-button" data-action="start" data-duration-selected="${selectedDuration}">
          <span>Start journey</span><span aria-hidden="true">→</span>
        </button>
        </div>
      </aside>`}
    </main>


    <footer class="footer">
      <span>Study Metro · Beta</span>
      <div class="footer-actions">
        <button class="text-button" data-action="reset">Start over</button>
      </div>
    </footer>

    <div id="modal-root"></div>
  `;

  const mapRoot = document.querySelector<HTMLElement>("#map-root");
  if (mapRoot) {
    renderMetroMap(mapRoot, state, (stationId) => {
      const { scrollLeft, scrollTop } = mapRoot;
      const restoreFocus = mapRoot.contains(document.activeElement);
      state.selectedExamId = null;
      state.selectedStationId = stationId;
      persist();
      render();
      const nextMap = document.querySelector<HTMLElement>("#map-root");
      if (nextMap) {
        nextMap.scrollTo(scrollLeft, scrollTop);
        if (restoreFocus) {
          nextMap.querySelector<SVGElement>(".metro-station.is-selected")?.focus({ preventScroll: true });
        }
      }
    }, (examId) => {
      const { scrollLeft, scrollTop } = mapRoot;
      state.selectedExamId = examId;
      persist();
      render();
      const nextMap = document.querySelector<HTMLElement>("#map-root");
      nextMap?.scrollTo(scrollLeft, scrollTop);
      nextMap?.querySelector<SVGElement>(".exam-terminal.is-selected")?.focus({ preventScroll: true });
    }, (lineId) => showExamModal(lineId));
  }

  bindInteractions();
  document.querySelector<HTMLElement>("[data-action='edit-exam']")?.addEventListener("click", (event) => {
    showExamModal((event.currentTarget as HTMLElement).dataset.lineId ?? null);
  });
  document.querySelector("[data-action='add-exam']")?.addEventListener("click", () => showExamModal());
  document.querySelector("[data-action='remove-selected-exam']")?.addEventListener("click", () => {
    if (selectedExam) confirmAction("Remove this exam? Your subject, stations and journey history will stay.", () => {
      const next = { ...state, exams: state.exams.filter((exam) => exam.id !== selectedExam.id), selectedExamId: null };
      try { writeState(next); state = next; render(); } catch { showStorageError(); }
    });
  });
}

function showExamModal(lineId: string | null = null): void {
  const modal = modalRoot();
  if (!modal) return;
  const existing = state.exams.find((exam) => exam.lineId === lineId);
  const eligible = state.lines.filter((line) => !state.exams.some((exam) => exam.lineId === line.id));
  modal.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card exam-dialog" role="dialog" aria-modal="true" aria-label="${existing ? "Edit exam" : "Add exam"}">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
    <p class="eyebrow">EXAM TERMINAL</p><h2>${existing ? "Edit exam" : "Add exam"}</h2>
    ${!existing && !eligible.length ? `<p class="modal-copy">Every subject line already has an exam. Select a terminal on the map to edit or remove it.</p>` : `
    <form id="quick-exam-form" class="setup-form compact-form">
      <label><span>Subject line</span><select name="lineId" ${existing ? "disabled" : ""}>${(existing ? state.lines.filter((line) => line.id === existing.lineId) : eligible).map((line) => `<option value="${escapeHtml(line.id)}" ${line.id === lineId ? "selected" : ""}>${escapeHtml(line.name)}</option>`).join("")}</select></label>
      <label><span>Exam name</span><input name="examName" required maxlength="64" value="${escapeHtml(existing?.name ?? "")}" placeholder="e.g. Anatomy Final" /></label>
      <label><span>Exam date</span><input name="examDate" type="date" required min="1000-01-01" max="9999-12-31" value="${existing?.examDate ?? ""}" /></label>
      <label><span>Target completion <small>optional</small></span><input name="targetDate" type="date" min="1000-01-01" max="9999-12-31" value="${existing?.targetCompletionDate ?? ""}" /></label>
      <p class="exam-form-message" role="status"></p><button class="secondary-button" type="submit">Save exam</button>
    </form>`}</section></div>`;
  bindModalClose(modal);
  const form = modal.querySelector<HTMLFormElement>("#quick-exam-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("examName") ?? "").trim().replace(/\s+/g, " ");
    const examDate = String(data.get("examDate") ?? "");
    const targetCompletionDate = String(data.get("targetDate") ?? "") || null;
    const subjectId = existing?.lineId ?? String(data.get("lineId"));
    const error = validateExam(name, examDate, targetCompletionDate);
    const message = form.querySelector<HTMLElement>(".exam-form-message")!;
    if (error) { message.textContent = error; return; }
    if (!existing && state.exams.some((exam) => exam.lineId === subjectId)) { message.textContent = "This line already has an exam."; return; }
    const exam: Exam = { id: existing?.id ?? uid("exam"), lineId: subjectId, name, examDate, targetCompletionDate };
    const next = { ...state, exams: [...state.exams.filter((item) => item.lineId !== subjectId), exam], selectedExamId: exam.id };
    try { writeState(next); } catch { message.textContent = "Could not save. Browser storage is unavailable or full. Please try again."; return; }
    state = next; render();
    document.querySelector<SVGElement>(".exam-terminal.is-selected")?.focus();
  });
}

function confirmAction(message: string, action: () => void): void {
  closeConfirmation?.();
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true" aria-label="Confirm action"><h2>Are you sure?</h2><p class="modal-copy">${escapeHtml(message)}</p><div class="editor-inline-actions"><button class="secondary-button" data-confirm>Confirm</button><button class="text-button modal-close-cancel" data-action="close-modal">Cancel</button></div></section></div>`;
  const close = bindModalClose(container);
  closeConfirmation = close;
  container.querySelector<HTMLElement>("[data-action='close-modal'] button[data-action='close-modal']")?.focus();
  container.querySelector("[data-confirm]")?.addEventListener("click", () => { close(); action(); });
}

function durationMode(duration: number): string {
  if (duration <= 30) return "Local service";
  if (duration >= 75) return "Deep work";
  return "Express service";
}

function bindInteractions(): void {
  const durationButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-duration]")];
  const startButton = document.querySelector<HTMLButtonElement>("[data-action='start']");
  const customDuration = document.querySelector<HTMLInputElement>("#custom-duration");

  const setDuration = (duration: number): void => {
    if (!Number.isFinite(duration)) return;
    const safeDuration = Math.max(5, Math.min(240, Math.round(duration)));
    state.preferredDuration = safeDuration;
    persist();
    durationButtons.forEach((button) => button.classList.toggle("is-selected", Number(button.dataset.duration) === safeDuration));
    if (startButton) startButton.dataset.durationSelected = String(safeDuration);
    const label = document.querySelector<HTMLElement>(".duration-label");
    if (label) label.textContent = `${safeDuration} minutes · ${durationMode(safeDuration)}`;
  };

  durationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (customDuration) customDuration.value = "";
      setDuration(Number(button.dataset.duration ?? 50));
    });
  });

  customDuration?.addEventListener("change", () => {
    if (!customDuration.value) return;
    if (!validDuration(Number(customDuration.value))) { customDuration.setCustomValidity("Enter a whole number from 5 to 240 minutes."); customDuration.reportValidity(); return; }
    customDuration.setCustomValidity(""); setDuration(Number(customDuration.value));
  });
  customDuration?.addEventListener("input", () => customDuration.setCustomValidity(""));

  startButton?.addEventListener("click", () => {
    if (customDuration && !customDuration.checkValidity()) { customDuration.reportValidity(); return; }
    const station = stationById(state.selectedStationId);
    if (!station) return;
    const duration = customDuration?.value ? Number(customDuration.value) : Number(startButton.dataset.durationSelected ?? state.preferredDuration);
    if (!validDuration(duration)) return;
    state.preferredDuration = duration;
    startJourney(station, duration);
  });

  document.querySelector<HTMLElement>("[data-action='history']")?.addEventListener("click", showHistory);
  document.querySelectorAll<HTMLElement>("[data-action='edit-network']").forEach((element) => element.addEventListener("click", () => showNetworkEditor(selectedLineIdForEditor())));
  document.querySelector<HTMLElement>("[data-action='reset']")?.addEventListener("click", () => {
    confirmAction("Start over? This removes the Study Metro data stored in this browser.", () => {
    try { resetState(); } catch { showStorageError(); return; }
    state = loadState();
    lastSaved = structuredClone(state);
    timer.reset();
    activeStation = null;
    render();
    });
  });
}

function selectedLineIdForEditor(): string | null {
  return state.exams.find((exam) => exam.id === state.selectedExamId)?.lineId ?? stationById(state.selectedStationId)?.lineId ?? state.lines[0]?.id ?? null;
}

function syncActiveJourney(): void {
  if (!state.activeJourney) return;
  state.activeJourney = { ...state.activeJourney, timer: timer.export() };
  persist();
}

function startJourney(station: Station, durationMinutes: number): void {
  if (state.activeJourney || !validDuration(durationMinutes)) return;
  activeStation = station;
  timer.start(durationMinutes);
  state.activeJourney = {
    stationId: station.id,
    lineId: station.lineId,
    durationMinutes,
    previousStationStatus: station.status,
    timer: timer.export()
  };
  state.stations = state.stations.map((item) => item.id === station.id ? { ...item, status: "studying" } : item);
  persist();
  document.body.classList.add("focus-mode");
  renderFocus();
  startTimerLoop();
}

function startTimerLoop(): void {
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = window.setInterval(() => {
    timer.tick();
    renderFocusTick();
    if (timer.state.phase === "complete") finishJourney();
  }, 250);
}

function focusRouteMarkup(origin: string, destination: string, pct: number, arrived = false): string {
  return `
    <div class="focus-route ${arrived ? "has-arrived" : ""}">
      <div class="focus-track" id="focus-route-progress" role="progressbar" aria-label="Journey progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(pct)}">
        <span class="focus-origin" aria-hidden="true"></span>
        <span class="focus-progress" id="focus-progress" style="width:${pct}%" aria-hidden="true"></span>
        <span class="focus-destination" aria-hidden="true"></span>
        <span class="focus-train" id="focus-train" style="left:${pct}%" aria-hidden="true"><svg viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="26" height="15" rx="2"/><path d="M8 8h6v5H8zM18 8h6v5h-6zM8 19v2m16-2v2"/></svg></span>
      </div>
      <div class="focus-stations">
        <div><span>DEPARTURE</span><strong>${escapeHtml(origin)}</strong></div>
        <span class="focus-route-arrow" aria-hidden="true">→</span>
        <div><span>DESTINATION</span><strong>${escapeHtml(destination)}</strong></div>
      </div>
    </div>
  `;
}

function renderFocus(): void {
  if (!activeStation || !state.activeJourney) return;
  const line = lineById(activeStation.lineId);
  const previousStationId = line?.stationIds[line.stationIds.indexOf(activeStation.id) - 1];
  const departure = stationById(previousStationId ?? null)?.name ?? "Line entrance";
  const paused = timer.state.phase === "paused";
  const pct = timer.progress() * 100;
  app.innerHTML = `
    <main class="focus-shell ${paused ? "is-paused" : ""}" style="--focus-line:${displayLineColor(line?.color ?? "#eeeae2")}">
      <header class="focus-topline">
        <div class="brand focus-brand"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>STUDY METRO</span></div>
        <span class="focus-line-name">${escapeHtml(line?.name.toUpperCase() ?? "LINE")}</span>
        <button class="focus-exit" data-action="end" aria-label="Exit journey and return to network" title="End this journey and return to the network"><span aria-hidden="true">←</span> Exit</button>
      </header>

      <section class="focus-stage">
        <p class="focus-service" role="status"><span aria-hidden="true"></span>${paused ? "PAUSED" : "IN TRANSIT"}</p>
        <h1>${escapeHtml(activeStation.name)}</h1>
        <div class="focus-time" id="focus-time" role="timer" aria-label="${paused ? "Paused, time remaining" : "Time remaining"}">${formatRemaining(timer.remainingMs())}</div>
        <p class="focus-time-caption">REMAINING</p>
        ${focusRouteMarkup(departure, activeStation.name, pct)}
        <div class="focus-journey-meta"><span>${state.activeJourney.durationMinutes} MIN JOURNEY</span><span id="focus-percentage">${Math.floor(pct)}% complete</span></div>
      </section>

      <footer class="focus-controls">
        <button class="secondary-button" data-action="pause">${timer.state.phase === "paused" ? "Resume" : "Pause"}</button>
        <button class="text-button danger" data-action="end">End journey</button>
      </footer>
    </main>
  `;

  document.querySelector<HTMLElement>("[data-action='pause']")?.addEventListener("click", () => {
    togglePause();
    document.querySelector<HTMLElement>("[data-action='pause']")?.focus({ preventScroll: true });
  });
  document.querySelectorAll<HTMLElement>(".focus-shell [data-action='end']").forEach((button) => button.addEventListener("click", cancelJourney));
  renderFocusTick();
}

function renderFocusTick(): void {
  const time = document.querySelector<HTMLElement>("#focus-time");
  const progress = document.querySelector<HTMLElement>("#focus-progress");
  const train = document.querySelector<HTMLElement>("#focus-train");
  if (time) time.textContent = formatRemaining(timer.remainingMs());
  const pct = timer.progress() * 100;
  if (progress) progress.style.width = `${pct}%`;
  if (train) train.style.left = `${pct}%`;
  const percentage = document.querySelector<HTMLElement>("#focus-percentage");
  if (percentage) percentage.textContent = `${Math.floor(pct)}% complete`;
  document.querySelector<HTMLElement>("#focus-route-progress")?.setAttribute("aria-valuenow", String(Math.floor(pct)));
}

function togglePause(): void {
  timer.tick();
  if (timer.state.phase === "complete") { finishJourney(); return; }
  if (timer.state.phase === "paused") {
    timer.resume();
  } else {
    timer.pause();
  }
  syncActiveJourney();
  renderFocus();
}

function finishJourney(): void {
  if (!activeStation || !state.activeJourney) return;
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = null;

  const journey = state.activeJourney;
  const now = Date.now();
  const startedAt = timer.state.startedAt ?? now - journey.durationMinutes * 60_000;
  const record: JourneyRecord = {
    id: uid("journey"),
    stationId: activeStation.id,
    lineId: activeStation.lineId,
    startedAt,
    completedAt: now,
    focusedSeconds: journey.durationMinutes * 60
  };

  state.history.unshift(record);
  state.stations = state.stations.map((station) => station.id === activeStation?.id ? { ...station, status: "completed" } : station);
  state.activeJourney = null;
  persist();
  closeConfirmation?.(); closeConfirmation = null;
  renderArrival(activeStation, journey.durationMinutes);
}

function renderArrival(station: Station, durationMinutes: number): void {
  const line = lineById(station.lineId);
  const previousStationId = line?.stationIds[line.stationIds.indexOf(station.id) - 1];
  const departure = stationById(previousStationId ?? null)?.name ?? "Line entrance";
  app.innerHTML = `
    <main class="focus-shell arrival-shell" style="--focus-line:${displayLineColor(line?.color ?? "#eeeae2")}">
      <header class="focus-topline">
        <div class="brand focus-brand"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>STUDY METRO</span></div>
        <span class="focus-line-name">${escapeHtml(line?.name.toUpperCase() ?? "LINE")}</span>
      </header>
      <section class="focus-stage arrival-board">
        <p class="focus-service" role="status"><span aria-hidden="true"></span>ARRIVED</p>
        <h1 tabindex="-1" id="arrival-title">${escapeHtml(station.name)}</h1>
        <p class="arrival-summary">${durationMinutes} min completed</p>
        ${focusRouteMarkup(departure, station.name, 100, true)}
        <div class="focus-journey-meta"><span>JOURNEY ${String(state.history.length).padStart(4, "0")}</span><span>100% complete</span></div>
      </section>
      <footer class="focus-controls arrival-controls">
        <button class="primary-button" data-action="return">Return to network <span>→</span></button>
      </footer>
    </main>
  `;
  document.querySelector<HTMLElement>("#arrival-title")?.focus({ preventScroll: true });
  document.querySelector<HTMLElement>("[data-action='return']")?.addEventListener("click", () => {
    document.body.classList.remove("focus-mode");
    activeStation = null;
    timer.reset();
    render();
  });
}

function cancelJourney(): void {
  timer.tick();
  if (timer.state.phase === "complete") { finishJourney(); return; }
  confirmAction("End this journey? It will not be added to your journey log.", () => {
  timer.tick();
  if (timer.state.phase === "complete") { finishJourney(); return; }
  const activeJourney = state.activeJourney;
  timer.cancel();
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = null;

  if (activeJourney) {
    state.stations = state.stations.map((station) => station.id === activeJourney.stationId ? { ...station, status: activeJourney.previousStationStatus } : station);
  }
  state.activeJourney = null;
  persist();
  document.body.classList.remove("focus-mode");
  activeStation = null;
  timer.reset();
  render();
  });
}

function modalRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#modal-root");
}

const modalCleanups = new WeakMap<HTMLElement, () => void>();
function bindModalClose(modal: HTMLElement): () => void {
  modalCleanups.get(modal)?.();
  const opener = document.activeElement;
  const siblings = [...(modal.parentElement?.children ?? [])].filter((element): element is HTMLElement => element !== modal && element instanceof HTMLElement);
  const inertBefore = siblings.map((element) => element.inert);
  siblings.forEach((element) => { element.inert = true; });
  const cleanup = (): void => { siblings.forEach((element, index) => { element.inert = inertBefore[index]; }); modalCleanups.delete(modal); };
  modalCleanups.set(modal, cleanup);
  const close = (): void => {
    cleanup();
    modal.innerHTML = "";
    modal.onkeydown = null;
    if ((opener instanceof HTMLElement || opener instanceof SVGElement) && opener.isConnected) opener.focus({ preventScroll: true });
    if (modal.id !== "modal-root") modal.remove();
  };
  modal.querySelectorAll<HTMLElement>("[data-action='close-modal']").forEach((element) => {
    element.addEventListener("click", close);
  });
  modal.querySelector<HTMLElement>(".modal-card")?.addEventListener("click", (event) => event.stopPropagation());
  modal.onkeydown = (event): void => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const controls = [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  modal.querySelector<HTMLElement>(".modal-close")?.focus({ preventScroll: true });
  return close;
}

function showHistory(): void {
  const modal = modalRoot();
  if (!modal) return;
  const rows = state.history.length
    ? state.history.slice(0, 30).map((journey) => {
        const station = stationById(journey.stationId);
        const date = new Date(journey.completedAt);
        return `<li><div><strong>${escapeHtml(station?.name ?? "Deleted station")}</strong><span>${escapeHtml(lineName(journey.lineId))}</span></div><div><strong>${Math.round(journey.focusedSeconds / 60)}m</strong><span>${date.toLocaleDateString()}</span></div></li>`;
      }).join("")
    : `<li class="empty-log">No completed journeys yet. Your first arrival will appear here.</li>`;

  modal.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-card history-card" role="dialog" aria-modal="true" aria-label="Journey log">
        <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        <p class="eyebrow">JOURNEY LOG</p>
        <h2>Your recent travel</h2>
        <ul class="history-list">${rows}</ul>
      </section>
    </div>
  `;
  bindModalClose(modal);
}

function showNetworkEditor(requestedLineId: string | null): void {
  const modal = modalRoot();
  if (!modal) return;
  const line = lineById(requestedLineId) ?? state.lines[0] ?? null;
  if (!line) return;
  const lineStations = line.stationIds.map((id) => stationById(id)).filter((station): station is Station => Boolean(station));
  const exam = state.exams.find((item) => item.lineId === line.id);

  modal.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-card editor-card" role="dialog" aria-modal="true" aria-label="Edit network">
        <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        <div class="editor-head">
          <div>
            <p class="eyebrow">NETWORK CONTROL</p>
            <h2>Edit your lines</h2>
          </div>
          <button class="secondary-button compact-button" data-action="add-line">+ New line</button>
        </div>

        <div class="editor-layout">
          <aside class="editor-lines" aria-label="Subject lines">
            ${state.lines.map((item, index) => `
              <div class="editor-line-item ${item.id === line.id ? "is-active" : ""}">
                <button class="line-select" data-action="select-line" data-line-id="${item.id}">
                  <i style="background:${displayLineColor(item.color)}"></i>
                  <span>${escapeHtml(item.name)}</span>
                  <small>${item.stationIds.length}</small>
                </button>
                <div class="line-order-actions">
                  <button data-action="move-line" data-line-id="${item.id}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move line up">↑</button>
                  <button data-action="move-line" data-line-id="${item.id}" data-direction="1" ${index === state.lines.length - 1 ? "disabled" : ""} aria-label="Move line down">↓</button>
                </div>
              </div>
            `).join("")}
          </aside>

          <div class="editor-detail">
            <form class="line-settings" id="line-settings">
              <input type="hidden" name="lineId" value="${line.id}" />
              <label><span>Line name</span><input name="lineName" maxlength="40" value="${escapeHtml(line.name)}" required /></label>
              <label class="color-field"><span>Colour</span><input type="color" name="lineColor" value="${line.color}" /></label>
              <div class="editor-inline-actions">
                <button class="secondary-button compact-button" type="submit">Save line</button>
                <button class="text-button danger" type="button" data-action="delete-line" data-line-id="${line.id}">Delete line</button>
              </div>
            </form>

            <details class="exam-editor" ${exam ? "open" : ""}>
              <summary>Exam terminal <span>${exam ? "Edit exam" : "Add exam"}</span></summary>
              <form id="exam-form" class="exam-form">
                <label class="exam-name-field"><span>Exam name</span><input name="examName" maxlength="64" required placeholder="e.g. Anatomy Final" value="${escapeHtml(exam?.name ?? "")}" /></label>
                <label><span>Exam date</span><input name="examDate" type="date" min="1000-01-01" max="9999-12-31" required value="${exam?.examDate ?? ""}" /></label>
                <label><span>Target completion <small>optional</small></span><input name="targetDate" type="date" min="1000-01-01" max="9999-12-31" value="${exam?.targetCompletionDate ?? ""}" /></label>
                <p class="exam-note">One terminal per line. Study stations and journeys stay separate.</p>
                <p class="exam-form-message" role="status" aria-live="polite"></p>
                <div class="exam-form-actions"><button class="secondary-button compact-button" type="submit">${exam ? "Save exam" : "Add exam"}</button>${exam ? `<button class="text-button danger" type="button" data-action="remove-exam">Remove exam</button>` : ""}</div>
                <div class="exam-remove-confirm" hidden><p>Remove this exam? Your subject, study stations and journey history will stay.</p><button class="secondary-button compact-button" type="button" data-action="confirm-remove-exam">Remove exam only</button><button class="text-button" type="button" data-action="keep-exam">Keep exam</button></div>
              </form>
            </details>

            <div class="station-editor-head">
              <div><strong>Stations</strong><span>Order controls map position.</span></div>
            </div>

            <ol class="station-editor-list">
              ${lineStations.map((station, index) => `
                <li>
                  <span class="drag-index">${String(index + 1).padStart(2, "0")}</span>
                  <input data-station-name="${station.id}" maxlength="64" value="${escapeHtml(station.name)}" aria-label="Station name" />
                  <input class="minute-input" data-station-minutes="${station.id}" type="number" min="5" max="240" value="${station.estimatedMinutes}" aria-label="Estimated minutes" />
                  <button data-action="move-station" data-station-id="${station.id}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(station.name)} up">↑</button>
                  <button data-action="move-station" data-station-id="${station.id}" data-direction="1" ${index === lineStations.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(station.name)} down">↓</button>
                  <button class="station-delete" data-action="delete-station" data-station-id="${station.id}" aria-label="Delete ${escapeHtml(station.name)}">×</button>
                </li>
              `).join("")}
            </ol>

            <form class="add-station-form" id="add-station-form">
              <input name="stationName" maxlength="64" placeholder="New station name" aria-label="New station name" required autocomplete="off" />
              <input name="minutes" class="minute-input" type="number" min="5" max="240" value="50" aria-label="Estimated minutes" />
              <button class="secondary-button compact-button" type="submit">Add station</button>
            </form>
          </div>
        </div>
      </section>
    </div>
  `;

  bindModalClose(modal);

  modal.querySelectorAll<HTMLElement>("[data-action='select-line']").forEach((element) => {
    element.addEventListener("click", () => showNetworkEditor(element.dataset.lineId ?? null));
  });

  modal.querySelector<HTMLElement>("[data-action='add-line']")?.addEventListener("click", showAddLineModal);

  const examForm = modal.querySelector<HTMLFormElement>("#exam-form");
  const commitExam = (exams: Exam[], selectedExamId: string | null, message: string): void => {
    const nextState = { ...state, exams, selectedExamId };
    try { writeState(nextState); }
    catch {
      const status = examForm?.querySelector<HTMLElement>(".exam-form-message");
      if (status) { status.textContent = "Could not save the exam. Browser storage may be full or unavailable. Your changes have not been applied; try again."; status.classList.add("is-error"); }
      return;
    }
    state = nextState;
    render();
    document.querySelector<SVGElement>(".exam-terminal.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    showNetworkEditor(line.id);
    const details = modalRoot()?.querySelector<HTMLDetailsElement>(".exam-editor");
    if (details) details.open = true;
    const status = modalRoot()?.querySelector<HTMLElement>(".exam-form-message");
    if (status) status.textContent = message;
    modalRoot()?.querySelector<HTMLButtonElement>("#exam-form button[type='submit']")?.focus({ preventScroll: true });
  };
  examForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(examForm);
    const name = String(data.get("examName") ?? "").trim().replace(/\s+/g, " ");
    const examDate = String(data.get("examDate") ?? "");
    const targetCompletionDate = String(data.get("targetDate") ?? "") || null;
    const error = validateExam(name, examDate, targetCompletionDate);
    const status = examForm.querySelector<HTMLElement>(".exam-form-message");
    if (error) { if (status) { status.textContent = error; status.classList.add("is-error"); } return; }
    const nextExam: Exam = { id: exam?.id ?? uid("exam"), lineId: line.id, name, examDate, targetCompletionDate };
    commitExam([...state.exams.filter((item) => item.lineId !== line.id), nextExam], nextExam.id, "Exam saved.");
  });
  const removal = examForm?.querySelector<HTMLElement>(".exam-remove-confirm");
  examForm?.querySelector<HTMLElement>("[data-action='remove-exam']")?.addEventListener("click", () => {
    if (removal) { removal.hidden = false; removal.querySelector<HTMLButtonElement>("button")?.focus(); }
  });
  examForm?.querySelector<HTMLElement>("[data-action='keep-exam']")?.addEventListener("click", () => {
    if (removal) removal.hidden = true;
    examForm.querySelector<HTMLButtonElement>("[data-action='remove-exam']")?.focus();
  });
  examForm?.querySelector<HTMLElement>("[data-action='confirm-remove-exam']")?.addEventListener("click", () => {
    if (exam) commitExam(state.exams.filter((item) => item.id !== exam.id), state.selectedExamId === exam.id ? null : state.selectedExamId, "Exam removed. Study stations are unchanged.");
  });

  modal.querySelector<HTMLFormElement>("#line-settings")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const lineId = String(data.get("lineId") ?? "");
    if (formError(event.currentTarget as HTMLFormElement, nameError(String(data.get("lineName")), state.lines.filter((item) => item.id !== lineId).map((item) => item.name), 40))) return;
    state.lines = state.lines.map((item) => item.id === lineId ? {
      ...item,
      name: cleanName(data.get("lineName"), item.name),
      color: String(data.get("lineColor") ?? item.color)
    } : item);
    relayoutAndPersist();
    render();
    showNetworkEditor(lineId);
  });

  modal.querySelectorAll<HTMLInputElement>("[data-station-name]").forEach((input) => {
    input.addEventListener("change", () => {
      const stationId = input.dataset.stationName;
      if (!stationId) return;
      const name = input.value.trim().replace(/\s+/g, " ").slice(0, 64);
      const error = nameError(name, state.stations.filter((station) => station.lineId === line.id && station.id !== stationId).map((station) => station.name));
      if (error) { input.setCustomValidity(error); input.reportValidity(); return; }
      state.stations = state.stations.map((station) => station.id === stationId ? { ...station, name } : station);
      persist();
      render();
      showNetworkEditor(line.id);
    });
  });

  modal.querySelectorAll<HTMLInputElement>("[data-station-minutes]").forEach((input) => {
    input.addEventListener("change", () => {
      const stationId = input.dataset.stationMinutes;
      if (!stationId) return;
      if (!validDuration(Number(input.value))) { input.setCustomValidity("Enter a whole number from 5 to 240."); input.reportValidity(); return; }
      const estimatedMinutes = Number(input.value);
      state.stations = state.stations.map((station) => station.id === stationId ? { ...station, estimatedMinutes } : station);
      persist();
      render();
      showNetworkEditor(line.id);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-action='move-station']").forEach((button) => {
    button.addEventListener("click", () => {
      const stationId = button.dataset.stationId;
      const direction = Number(button.dataset.direction ?? 0);
      if (!stationId || !direction) return;
      const current = line.stationIds.indexOf(stationId);
      const target = current + direction;
      if (current < 0 || target < 0 || target >= line.stationIds.length) return;
      const nextIds = [...line.stationIds];
      [nextIds[current], nextIds[target]] = [nextIds[target], nextIds[current]];
      state.lines = state.lines.map((item) => item.id === line.id ? { ...item, stationIds: nextIds } : item);
      relayoutAndPersist();
      render();
      showNetworkEditor(line.id);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-action='move-line']").forEach((button) => {
    button.addEventListener("click", () => {
      const lineId = button.dataset.lineId;
      const direction = Number(button.dataset.direction ?? 0);
      if (!lineId || !direction) return;
      const current = state.lines.findIndex((item) => item.id === lineId);
      const target = current + direction;
      if (current < 0 || target < 0 || target >= state.lines.length) return;
      const nextLines = [...state.lines];
      [nextLines[current], nextLines[target]] = [nextLines[target], nextLines[current]];
      state.lines = nextLines;
      relayoutAndPersist();
      render();
      showNetworkEditor(lineId);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-action='delete-station']").forEach((button) => {
    button.addEventListener("click", () => {
      const stationId = button.dataset.stationId;
      if (!stationId) return;
      const station = stationById(stationId);
      if (!station) return;
      if (line.stationIds.length === 1) {
        formError(modal.querySelector(".editor-detail")!, "A line needs at least one station. Add another station before deleting this one.");
        return;
      }
      confirmAction(`Delete station “${station.name}”? Its local journey history will also be removed.`, () => {
      state.stations = state.stations.filter((item) => item.id !== stationId);
      state.history = state.history.filter((journey) => journey.stationId !== stationId);
      state.lines = state.lines.map((item) => item.id === line.id ? { ...item, stationIds: item.stationIds.filter((id) => id !== stationId) } : item);
      if (state.selectedStationId === stationId) state.selectedStationId = line.stationIds.find((id) => id !== stationId) ?? state.lines.flatMap((item) => item.stationIds)[0] ?? null;
      relayoutAndPersist();
      render();
      showNetworkEditor(line.id);
      });
    });
  });

  modal.querySelector<HTMLButtonElement>("[data-action='delete-line']")?.addEventListener("click", () => {
    if (state.lines.length === 1) {
      formError(modal.querySelector(".editor-detail")!, "Keep at least one line. Add another line first, or use Start over for a new network.");
      return;
    }
    confirmAction(`Delete the ${line.name} line, its exam and its local journey history?`, () => {
    const stationIds = new Set(line.stationIds);
    state.lines = state.lines.filter((item) => item.id !== line.id);
    state.exams = state.exams.filter((item) => item.lineId !== line.id);
    if (!state.exams.some((item) => item.id === state.selectedExamId)) state.selectedExamId = null;
    state.stations = state.stations.filter((station) => !stationIds.has(station.id));
    state.history = state.history.filter((journey) => !stationIds.has(journey.stationId));
    ensureSelection();
    relayoutAndPersist();
    render();
    showNetworkEditor(state.lines[0]?.id ?? null);
    });
  });

  modal.querySelector<HTMLFormElement>("#add-station-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const name = cleanName(data.get("stationName"), "New Station");
    if (formError(event.currentTarget as HTMLFormElement, nameError(String(data.get("stationName")), lineStations.map((item) => item.name)))) return;
    const station: Station = {
      id: uid("station"),
      lineId: line.id,
      name,
      x: 0,
      y: 0,
      status: "not_started",
      estimatedMinutes: Math.max(5, Math.min(240, Number(data.get("minutes")) || 50))
    };
    state.stations.push(station);
    state.lines = state.lines.map((item) => item.id === line.id ? { ...item, stationIds: [...item.stationIds, station.id] } : item);
    state.selectedStationId = station.id;
    state.selectedExamId = null;
    relayoutAndPersist();
    render();
    showNetworkEditor(line.id);
  });
}

function showAddLineModal(): void {
  const modal = modalRoot();
  if (!modal) return;
  const defaultColor = LINE_COLORS[state.lines.length % LINE_COLORS.length];
  modal.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-card add-line-card" role="dialog" aria-modal="true" aria-label="Add subject line">
        <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        <p class="eyebrow">NETWORK EXPANSION</p>
        <h2>Add a subject line</h2>
        <form class="setup-form compact-form" id="add-line-form">
          <label><span>Subject</span><input name="lineName" maxlength="40" placeholder="e.g. Biochemistry" required /></label>
          <label><span>Topics · one per line</span><textarea name="topics" rows="8" placeholder="Enzymes&#10;Fed / fast cycle&#10;Hormones&#10;Kidney biochemistry" required></textarea></label>
          <label class="color-field"><span>Line colour</span><input type="color" name="lineColor" value="${defaultColor}" /></label>
          <button class="primary-button" type="submit"><span>Add line</span><span>→</span></button>
        </form>
      </section>
    </div>
  `;
  bindModalClose(modal);

  modal.querySelector<HTMLFormElement>("#add-line-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const topics = parseTopics(data.get("topics"));
    if (formError(event.currentTarget as HTMLFormElement, nameError(String(data.get("lineName")), state.lines.map((line) => line.name), 40) ?? topicsError(topics))) return;
    const { line, stations } = createLine(cleanName(data.get("lineName"), "New Line"), String(data.get("lineColor") ?? defaultColor), topics);
    state.lines.push(line);
    state.stations.push(...stations);
    state.selectedStationId = stations[0]?.id ?? state.selectedStationId;
    state.selectedExamId = null;
    relayoutAndPersist();
    render();
    showNetworkEditor(line.id);
  });
}

function recoverActiveJourney(): boolean {
  const saved = state.activeJourney;
  if (!saved) return false;
  const station = stationById(saved.stationId);
  if (!station) {
    state.activeJourney = null;
    persist();
    return false;
  }

  activeStation = station;
  timer.restore(saved.timer);
  timer.tick();
  document.body.classList.add("focus-mode");

  if (timer.state.phase === "complete") {
    finishJourney();
    return true;
  }

  if (timer.state.phase === "cancelled" || timer.state.phase === "idle") {
    state.activeJourney = null;
    persist();
    return false;
  }

  renderFocus();
  startTimerLoop();
  return true;
}

function bootstrap(): void {
  if (recoverActiveJourney()) return;
  render();
}

// Calendar readouts refresh independently of the focus timer, without rerendering forms.
function refreshExamDates(): void {
  document.querySelectorAll<HTMLElement | SVGElement>("[data-exam-id]").forEach((element) => {
    const exam = state.exams.find((item) => item.id === element.dataset.examId);
    if (!exam) return;
    const stats = examProgress(state, exam);
    const countdown = element.querySelector(".exam-countdown");
    if (countdown) {
      countdown.textContent = examCountdown(stats.daysRemaining);
      element.setAttribute("aria-label", `${exam.name}, ${lineName(exam.lineId)}, exam terminal, ${examCountdown(stats.daysRemaining)}, ${stats.status}`);
    }
    const days = element.querySelector("[data-exam-days-message]");
    if (days) days.textContent = examDaysMessage(stats.daysRemaining);
    const status = element.querySelector("[data-exam-status]");
    if (status) status.textContent = stats.status;
  });
}

function scheduleExamDateRefresh(): void {
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  window.setTimeout(() => { refreshExamDates(); scheduleExamDateRefresh(); }, nextDay - Date.now() + 100);
}

document.addEventListener("input", (event) => { if (event.target instanceof HTMLInputElement) event.target.setCustomValidity(""); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshExamDates();
    if (state.activeJourney) { timer.tick(); renderFocusTick(); if (timer.state.phase === "complete") finishJourney(); }
  }
});
window.addEventListener("focus", refreshExamDates);
// One writable tab per origin prevents stale tabs overwriting a live journey or network.
async function openApp(): Promise<void> {
  const blocked = (): void => {
    app.innerHTML = `<main class="onboarding-shell"><section class="modal-card"><h1>Open in another tab</h1><p class="modal-copy">Keep one Study Metro tab open to protect your network and active journey. Close the other tab, then reload here.</p><button class="secondary-button" id="reload-app">Reload</button></section></main>`;
    document.querySelector("#reload-app")?.addEventListener("click", () => location.reload());
  };
  if (!navigator.locks) {
    app.innerHTML = `<main class="modal-card"><h1>Secure browser required</h1><p>Open Study Metro over HTTPS in a current browser to safely save your network.</p></main>`;
    return;
  }
  await navigator.locks.request("study-metro-writer", { ifAvailable: true }, async (lock) => {
    if (!lock) { blocked(); return; }
    state = loadState(); lastSaved = structuredClone(state);
    if (isStorageReadOnly()) {
      app.innerHTML = `<main class="modal-card"><h1>Newer version required</h1><p>${escapeHtml(storageNotice)}</p></main>`;
    } else {
      try { bootstrap(); } catch (error) { if (!(error instanceof SaveFailure)) throw error; }
    }
    if (storageNotice) {
      const notice = document.createElement("p"); notice.className = "storage-error"; notice.setAttribute("role", "alert"); notice.textContent = storageNotice; document.body.append(notice);
    }
    await new Promise<void>(() => {});
  });
}
void openApp();
scheduleExamDateRefresh();
