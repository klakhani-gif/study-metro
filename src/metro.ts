import { AppState, MetroLine, Station } from "./model.js";
import { MAP_WIDTH, mapHeight } from "./layout.js";
import { examCountdown, examProgress } from "./exams.js";
import { isCompletedStation, isMaintenanceDue } from "./revision.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Presentation-only equivalents: persisted line colours remain untouched.
export function displayLineColor(color: string): string {
  const tokens: Record<string, string> = {
    "#E4572E": "orange", "#2E6F95": "blue", "#6A4C93": "violet", "#2E8B57": "green",
    "#D49A20": "amber", "#A23B72": "rose", "#3D5A80": "slate", "#7A6C5D": "stone"
  };
  const token = tokens[color.toUpperCase()];
  return token ? `var(--metro-${token}, ${color})` : color;
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function stationClass(station: Station): string {
  return `metro-station metro-station--${station.status}`;
}

function linePath(line: MetroLine, stations: Station[]): string {
  const points = line.stationIds
    .map((id) => stations.find((s) => s.id === id))
    .filter((s): s is Station => Boolean(s));
  return points.map((s, i) => `${i === 0 ? "M" : "L"} ${s.x} ${s.y}`).join(" ");
}

export function renderMetroMap(
  container: HTMLElement,
  state: AppState,
  onSelect: (stationId: string) => void,
  onSelectExam: (examId: string) => void,
  onAddExam: (lineId: string) => void
): void {
  container.innerHTML = "";
  const height = mapHeight(state.lines.length) - 40;
  const svg = el("svg", {
    viewBox: `0 0 ${MAP_WIDTH} ${height}`,
    class: "metro-map",
    role: "group",
    "aria-label": "Your Study Metro network"
  });
  // Dense networks expand the canvas instead of shrinking labels and targets.
  const maxStations = Math.max(1, ...state.lines.map((line) => line.stationIds.length));
  const studyWidth = Math.max(MAP_WIDTH, (maxStations - 1) * 150 + 190);
  const width = studyWidth + (state.exams.length ? 190 : 0);
  const examX = studyWidth + 95;
  const scaleX = (studyWidth - 190) / (MAP_WIDTH - 190);
  const mapX = (x: number): number => 95 + (x - 95) * scaleX;
  const displayStations = state.stations.map((station) => ({ ...station, x: mapX(station.x), y: station.y - 20 }));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.setProperty("--map-min-width", `${Math.max(780, width * .86)}px`);
  svg.style.setProperty("--map-min-height", `${height * .86}px`);

  const grid = el("g", { class: "map-grid" });
  for (let x = 40; x < width; x += 40) grid.append(el("line", { x1: String(x), y1: "20", x2: String(x), y2: String(height - 20), class: x % 200 === 0 ? "grid-major" : "" }));
  for (let y = 40; y < height; y += 40) grid.append(el("line", { x1: "20", y1: String(y), x2: String(width - 20), y2: String(y), class: y % 200 === 0 ? "grid-major" : "" }));
  svg.append(grid);

  state.lines.forEach((line, index) => {
    if (!line.stationIds.length) return;
    const exam = state.exams.find((item) => item.lineId === line.id);
    const last = displayStations.find((station) => station.id === line.stationIds[line.stationIds.length - 1]);
    const path = el("path", {
      d: linePath(line, displayStations) + (exam && last ? ` L ${examX} ${last.y}` : ""),
      class: "metro-line",
      stroke: line.color
    });
    path.style.setProperty("--line-color", displayLineColor(line.color));
    svg.append(path);

    const first = displayStations.find((s) => s.id === line.stationIds[0]);
    if (first) {
      const signage = el("g", { "aria-hidden": "true" });
      signage.style.setProperty("--line-color", displayLineColor(line.color));
      const codeBox = el("rect", { x: "81", y: String(first.y - 57), width: "28", height: "22", class: "line-code-box" });
      const number = el("text", { x: "95", y: String(first.y - 42), class: "line-number" });
      number.textContent = String(index + 1).padStart(2, "0");
      const rule = el("line", { x1: "95", x2: "95", y1: String(first.y - 29), y2: String(first.y - 18), class: "line-sign-rule" });
      const label = el("text", { x: "122", y: String(first.y - 42), class: "line-label" });
      label.textContent = line.name.length > 28 ? `${line.name.slice(0, 27).toUpperCase()}…` : line.name.toUpperCase();
      signage.append(codeBox, number, rule, label);
      svg.append(signage);
      if (!exam) {
        const add = el("g", { class: "map-add-exam", role: "button", tabindex: "0", "aria-label": `Add exam to ${line.name}` });
        add.append(el("rect", { x: "435", y: String(first.y - 74), width: "105", height: "52", fill: "transparent" }));
        const text = el("text", { x: "445", y: String(first.y - 42) });
        text.textContent = "+ Add exam";
        add.append(text);
        add.addEventListener("click", () => onAddExam(line.id));
        add.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onAddExam(line.id); } });
        svg.append(add);
      }
    }
  });

  displayStations.forEach((station) => {
    const line = state.lines.find((l) => l.id === station.lineId);
    if (!line) return;
    const terminal = station.id === line.stationIds[0] || (station.id === line.stationIds[line.stationIds.length - 1] && !state.exams.some((exam) => exam.lineId === line.id));
    const interchange = state.lines.filter((item) => item.stationIds.includes(station.id)).length > 1;
    const group = el("g", {
      class: `${stationClass(station)}${isMaintenanceDue(station) ? " is-maintenance-due" : ""}${!state.selectedExamId && state.selectedStationId === station.id ? " is-selected" : ""}`,
      tabindex: "0",
      role: "button",
      "data-station-id": station.id,
      "data-terminal": String(terminal),
      "aria-pressed": String(!state.selectedExamId && state.selectedStationId === station.id),
      "aria-label": `${station.name}, ${line.name}, ${isMaintenanceDue(station) ? "Maintenance due" : station.status.replaceAll("_", " ")}${terminal ? ", terminal" : ""}`
    });
    group.style.setProperty("--line-color", displayLineColor(line.color));
    const hit = el("rect", { x: String(station.x - 26), y: String(station.y - 25), width: "52", height: "52", class: "station-hit" });
    const circle = terminal && !interchange
      ? el("rect", { x: String(station.x - 6), y: String(station.y - 9), width: "12", height: "18", rx: "1", class: "station-dot station-terminal" })
      : el("circle", { cx: String(station.x), cy: String(station.y), r: "6", class: "station-dot" });
    const selection = el("path", {
      d: `M ${station.x - 9} ${station.y - 17} h -8 v 8 M ${station.x + 9} ${station.y - 17} h 8 v 8 M ${station.x - 9} ${station.y + 17} h -8 v -8 M ${station.x + 9} ${station.y + 17} h 8 v -8`,
      class: "station-selection", "aria-hidden": "true"
    });
    const leader = el("line", { x1: String(station.x), x2: String(station.x), y1: String(station.y + 20), y2: String(station.y + 26), class: "station-label-leader", "aria-hidden": "true" });
    const label = el("text", { x: String(station.x), y: String(station.y + 42), class: "station-label", "text-anchor": "middle" });
    // Two consistent signage rows. Full names remain in the title and board.
    const chunks = station.name.match(/.{1,18}(?:\s|$)|\S{1,18}/g) ?? [station.name];
    const words = chunks.slice(0, 2);
    if (chunks.length > 2) words[1] = `${words[1].trim().slice(0, 16)}…`;
    words.forEach((word, index) => {
      const row = el("tspan", { x: String(station.x), dy: index === 0 ? "0" : "16" });
      row.textContent = word.trim();
      label.append(row);
    });
    const title = el("title");
    title.textContent = station.name;
    group.append(title, hit, selection, circle, leader, label);
    group.append(el("circle", { cx: String(station.x), cy: String(station.y), r: interchange ? "16" : "14", class: "station-maintenance-ring", "aria-hidden": "true" }));
    // Shared stations, if present in existing data, use the interchange symbol.
    if (interchange) {
      group.insertBefore(el("circle", { cx: String(station.x), cy: String(station.y), r: "12", class: "station-interchange", "aria-hidden": "true" }), circle);
    }
    if (isCompletedStation(station)) {
      group.append(el("path", { d: `M ${station.x - 3} ${station.y} l 2 2 l 4 -4`, class: "station-check", "aria-hidden": "true" }));
    }
    if (station.status === "studying") {
      group.append(el("circle", { cx: String(station.x), cy: String(station.y), r: "2.5", class: "station-current", "aria-hidden": "true" }));
    }
    group.addEventListener("click", () => onSelect(station.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(station.id);
      }
    });
    svg.append(group);
  });

  state.exams.forEach((exam) => {
    const line = state.lines.find((item) => item.id === exam.lineId);
    const last = displayStations.find((station) => station.id === line?.stationIds[line.stationIds.length - 1]);
    if (!line || !last) return;
    const x = examX, y = last.y;
    const stats = examProgress(state, exam);
    const group = el("g", {
      class: `metro-station exam-terminal${state.selectedExamId === exam.id ? " is-selected" : ""}`,
      tabindex: "0", role: "button", "data-exam-id": exam.id,
      "aria-pressed": String(state.selectedExamId === exam.id),
      "aria-label": `${exam.name}, ${line.name}, exam terminal, ${examCountdown(stats.daysRemaining)}, ${stats.status}`
    });
    group.style.setProperty("--line-color", displayLineColor(line.color));
    const title = el("title");
    title.textContent = `${exam.name} — ${exam.examDate}`;
    group.append(title,
      el("rect", { x: String(x - 27), y: String(y - 27), width: "54", height: "54", class: "station-hit" }),
      el("path", { d: `M ${x - 12} ${y - 22} h -9 v 9 M ${x + 12} ${y - 22} h 9 v 9 M ${x - 12} ${y + 22} h -9 v -9 M ${x + 12} ${y + 22} h 9 v -9`, class: "station-selection", "aria-hidden": "true" }),
      el("rect", { x: String(x - 10), y: String(y - 14), width: "20", height: "28", class: "exam-terminal-outer" }),
      el("rect", { x: String(x - 5), y: String(y - 9), width: "10", height: "18", class: "exam-terminal-inner" })
    );
    const label = el("text", { x: String(x), y: String(y + 42), class: "station-label exam-terminal-label", "text-anchor": "middle" });
    const chunks = exam.name.toUpperCase().match(/.{1,18}(?:\s|$)|\S{1,18}/g) ?? [exam.name];
    const rows = chunks.slice(0, 2);
    if (chunks.length > 2) rows[1] = `${rows[1].trim().slice(0, 16)}…`;
    rows.forEach((text, index) => {
      const row = el("tspan", { x: String(x), dy: index === 0 ? "0" : "15" });
      row.textContent = text.trim(); label.append(row);
    });
    const countdown = el("text", { x: String(x), y: String(y + 42 + rows.length * 15), class: "exam-countdown", "text-anchor": "middle" });
    countdown.textContent = examCountdown(stats.daysRemaining);
    group.append(label, countdown);
    group.addEventListener("click", () => onSelectExam(exam.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectExam(exam.id); }
    });
    svg.append(group);
  });
  container.append(svg);
}
