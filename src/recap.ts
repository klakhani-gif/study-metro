import type { AppState } from "./model.js";
import { departureStatus } from "./departures.js";
import { daysUntil, isCalendarDate } from "./exams.js";
import { isMaintenanceDue } from "./revision.js";
import { wrapTicketText } from "./tickets.js";

/** Monday inclusive to the next Monday exclusive, using local calendar arithmetic (including DST). */
export function weekBounds(anchor = Date.now()): { start: number; end: number } {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return { start: +start, end: +end };
}

export function recapDateKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function recapDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes} min`;
}

export function recapWeekLabel(start: number, end: number): string {
  const format = (date: number): string => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
  return `${format(start)} – ${format(end - 1)}`;
}

export function createWeeklyRecap(state: AppState, anchor = Date.now(), now = Date.now()) {
  const { start, end } = weekBounds(anchor);
  const inWeek = (date: number | null): boolean => date !== null && Number.isFinite(date) && date >= start && date < end && date <= now;
  const journeys = state.history.filter(journey => inWeek(journey.completedAt));
  const lines = new Map<string, number>();
  const days = new Map<string, { timestamp: number; seconds: number }>();
  for (const journey of journeys) {
    lines.set(journey.lineId, (lines.get(journey.lineId) ?? 0) + journey.focusedSeconds);
    const key = recapDateKey(journey.completedAt);
    const day = days.get(key) ?? { timestamp: journey.completedAt, seconds: 0 };
    day.seconds += journey.focusedSeconds; days.set(key, day);
  }
  const busiest = [...lines].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const busiestLine = busiest ? state.lines.find(line => line.id === busiest[0]) : null;
  const longest = [...journeys].sort((a, b) => b.focusedSeconds - a.focusedSeconds || a.completedAt - b.completedAt || a.id.localeCompare(b.id))[0];
  const productive = [...days].sort((a, b) => b[1].seconds - a[1].seconds || a[0].localeCompare(b[0]))[0];
  // Departure cohorts belong to their scheduled week, even if boarded early or completed later.
  const departures = state.departures.filter(d => d.scheduledAt >= start && d.scheduledAt < end);
  const completed = departures.filter(d => departureStatus(d, now) === "Completed").length;
  const missed = departures.filter(d => departureStatus(d, now) === "Missed").length;
  const cancelled = departures.filter(d => departureStatus(d, now) === "Cancelled").length;
  const exams = state.exams.filter(exam => state.lines.some(line => line.id === exam.lineId) && isCalendarDate(exam.examDate) && daysUntil(exam.examDate, now) >= 0)
    .sort((a, b) => a.examDate.localeCompare(b.examDate) || a.id.localeCompare(b.id));
  return {
    start, end, asOf: now, currentWeek: start === weekBounds(now).start,
    focusedSeconds: journeys.reduce((sum, journey) => sum + journey.focusedSeconds, 0),
    journeys: journeys.length,
    stationsStudied: new Set(journeys.map(journey => `${journey.lineId}/${journey.stationId}`)).size,
    stationsCompleted: state.stations.filter(station => inWeek(station.firstCompletedAt)).length,
    revisionSessions: journeys.filter(journey => journey.kind === "revision").length,
    busiestLine: busiest ? { name: busiestLine?.name ?? "Removed line", color: busiestLine?.color ?? "#9b9e9f", seconds: busiest[1] } : null,
    longestJourney: longest ? { station: state.stations.find(station => station.id === longest.stationId && station.lineId === longest.lineId)?.name ?? "Completed station", seconds: longest.focusedSeconds } : null,
    mostProductiveDay: productive ? { date: productive[0], name: new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(productive[1].timestamp), seconds: productive[1].seconds } : null,
    scheduled: { completed, missed, cancelled, pending: departures.length - completed - missed - cancelled, completionRate: completed + missed ? Math.round(completed / (completed + missed) * 100) : null },
    maintenanceDue: state.stations.filter(station => isMaintenanceDue(station, now)).length,
    nearestExam: exams[0] ? { name: exams[0].name, daysRemaining: daysUntil(exams[0].examDate, now) } : null
  };
}

export type WeeklyRecap = ReturnType<typeof createWeeklyRecap>;

/** A deliberately compact share report; private profile data and departure notes never enter it. */
export function renderRecapSvg(recap: WeeklyRecap): string {
  const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const color = recap.busiestLine && /^#[0-9a-f]{6}$/i.test(recap.busiestLine.color) ? recap.busiestLine.color : "#9b9e9f";
  const text = (value: string, x: number, y: number, size: number, fill = "#eeeae2", extra = ""): string => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${escape(value)}</text>`;
  const caption = (value: string, x: number, y: number): string => text(value, x, y, 20, "#a5aaad", 'font-family="Consolas, monospace" letter-spacing="2"');
  const block = (value: string, y: number, size: number, lines: number): string => wrapTicketText(value, 936, size, lines).map((line, index) => text(line, 72, y + index * (size + 10), size, "#eeeae2", 'font-weight="600"')).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-labelledby="recap-title recap-description" font-family="Arial, Helvetica, sans-serif">
    <title id="recap-title">Your week on Study Metro</title>
    <desc id="recap-description">${escape(`${recapWeekLabel(recap.start, recap.end)}. ${recapDuration(recap.focusedSeconds)} focused. ${recap.journeys} journeys. ${recap.stationsCompleted} stations completed. ${recap.revisionSessions} revision sessions.${recap.busiestLine ? ` Busiest line: ${recap.busiestLine.name}, ${recapDuration(recap.busiestLine.seconds)}.` : " No services recorded this week."}`)}</desc>
    <rect width="1080" height="1350" fill="#0c0e10"/>
    <rect x="24" y="24" width="1032" height="1302" fill="none" stroke="#363c40"/>
    <path d="M24 180V24h180M876 1326h180v-156" fill="none" stroke="${color}" stroke-width="6"/>
    <circle cx="96" cy="105" r="25" fill="none" stroke="#eeeae2" stroke-width="2"/>
    <path d="M82 95h28M82 105h28M82 115h28" stroke="#eeeae2" stroke-width="2"/>
    ${text("STUDY METRO", 145, 116, 30, "#eeeae2", 'font-weight="700" letter-spacing="3"')}
    <path d="M72 180h936" stroke="${color}" stroke-width="6"/>
    ${caption("WEEKLY OPERATIONS REPORT", 72, 247)}
    ${block("YOUR WEEK ON STUDY METRO", 330, 52, 2)}
    ${text(recapWeekLabel(recap.start, recap.end), 72, 455, 27)}
    ${caption(recap.currentWeek ? "WEEK IN PROGRESS" : "WEEK IN REVIEW", 72, 502)}
    <path d="M72 548h936" stroke="#363c40"/>
    ${text(recapDuration(recap.focusedSeconds), 72, 660, 90, "#eeeae2", 'font-weight="600" letter-spacing="-2"')}
    ${caption("TOTAL FOCUSED TIME", 72, 712)}
    ${caption("BUSIEST LINE", 72, 802)}
    ${block(recap.busiestLine?.name ?? "No services recorded", 859, 36, 2)}
    ${text(recap.busiestLine ? recapDuration(recap.busiestLine.seconds) : "Start a journey to begin your weekly report.", 72, 973, 28, "#a5aaad")}
    <path d="M72 1020h936" stroke="#363c40"/>
    ${text(String(recap.stationsCompleted), 72, 1120, 64)}
    ${text(String(recap.journeys), 450, 1120, 64)}
    ${text(String(recap.revisionSessions), 768, 1120, 64)}
    ${caption("STATIONS", 72, 1166)}${caption("COMPLETED", 72, 1198)}
    ${caption("JOURNEYS", 450, 1166)}
    ${caption("REVISION", 768, 1166)}${caption("SERVICES", 768, 1198)}
    ${caption("MONDAY – SUNDAY / LOCAL TIME", 72, 1278)}
  </svg>`;
}
