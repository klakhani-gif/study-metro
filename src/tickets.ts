import type { AppState, JourneyKind } from "./model.js";

export interface JourneyTicket {
  journeyId: string;
  journeyNumber: string;
  routeCode: string;
  lineName: string;
  lineColor: string;
  origin: string;
  destination: string;
  kind: JourneyKind;
  durationMinutes: number;
  completedAt: number | null;
  examDestination: string | null;
  scheduledAt: number | null;
}

const validDate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
const label = (value: string | undefined, fallback: string): string => value?.trim() || fallback;

/** Deliberate allowlist: no profile, private note, IDs of departures, or other state is exported. */
export function createJourneyTicket(state: AppState, journeyId: string): JourneyTicket | null {
  const index = state.history.findIndex(journey => journey.id === journeyId);
  if (index < 0) return null;
  const journey = state.history[index];
  const lineIndex = state.lines.findIndex(line => line.id === journey.lineId);
  const line = state.lines[lineIndex];
  const station = state.stations.find(item => item.id === journey.stationId && item.lineId === journey.lineId);
  const stationIndex = line?.stationIds.indexOf(journey.stationId) ?? -1;
  const origin = stationIndex > 0 ? state.stations.find(item => item.id === line.stationIds[stationIndex - 1])?.name : undefined;
  const departure = state.departures.find(item => item.linkedJourneyId === journey.id && item.stationId === journey.stationId && item.lineId === journey.lineId);
  return {
    journeyId: journey.id,
    journeyNumber: String(state.history.length - index).padStart(4, "0"),
    routeCode: lineIndex >= 0 ? String(lineIndex + 1).padStart(2, "0") : "—",
    lineName: label(line?.name, "Study line"),
    lineColor: line?.color && /^#[0-9a-f]{6}$/i.test(line.color) ? line.color : "#9b9e9f",
    origin: journey.kind === "revision" ? "Maintenance service" : label(origin, "Line entrance"),
    destination: label(station?.name, "Completed station"),
    kind: journey.kind === "revision" ? "revision" : "study",
    durationMinutes: Number.isFinite(journey.focusedSeconds) ? Math.max(0, Math.round(journey.focusedSeconds / 60)) : 0,
    completedAt: validDate(journey.completedAt) ? journey.completedAt : null,
    examDestination: state.exams.find(exam => exam.lineId === journey.lineId)?.name?.trim() || null,
    scheduledAt: validDate(departure?.scheduledAt) ? departure.scheduledAt : null
  };
}

const xml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Conservative glyph widths in em; split even unbroken names, then ellipsize within the final line. */
export function wrapTicketText(value: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const width = (text: string): number => Array.from(text).reduce((sum, char) => sum + (/\s/.test(char) ? .35 : /[ilI.,'!:;]/.test(char) ? .38 : /[mwMW@%]/.test(char) ? 1 : /[^\u0000-\u007f]/.test(char) ? 1.1 : .7), 0) * fontSize;
  let rest = value.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  while (rest && lines.length < maxLines) {
    if (width(rest) <= maxWidth) { lines.push(rest); break; }
    const chars = Array.from(rest);
    let count = 1;
    while (count < chars.length && width(chars.slice(0, count + 1).join("")) <= maxWidth) count++;
    let chunk = chars.slice(0, count).join("");
    if (lines.length === maxLines - 1) {
      while (chunk && width(chunk + "…") > maxWidth) chunk = Array.from(chunk).slice(0, -1).join("");
      lines.push(chunk.trimEnd() + "…"); break;
    }
    const space = chunk.lastIndexOf(" ");
    if (space > chunk.length / 2) chunk = chunk.slice(0, space);
    lines.push(chunk.trim());
    rest = rest.slice(chunk.length).trim();
  }
  return lines;
}

export function ticketDateTime(timestamp: number | null): { date: string; time: string } {
  if (timestamp === null || !validDate(timestamp)) return { date: "DATE NOT RECORDED", time: "" };
  const date = new Date(timestamp);
  return {
    date: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date).toUpperCase(),
    time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(date)
  };
}

/** Self-contained vector artwork: no fonts, images, scripts or network resources to fetch. */
export function renderTicketSvg(ticket: JourneyTicket): string {
  const date = ticketDateTime(ticket.completedAt);
  const scheduled = ticket.scheduledAt === null ? null : ticketDateTime(ticket.scheduledAt);
  const color = /^#[0-9a-f]{6}$/i.test(ticket.lineColor) ? ticket.lineColor : "#9b9e9f";
  const text = (value: string, x: number, y: number, size: number, fill = "#eeeae2", extra = ""): string => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${xml(value)}</text>`;
  const block = (value: string, x: number, y: number, size: number, width: number, lines: number, leading: number): string => wrapTicketText(value, width, size, lines).map((line, index) => text(line, x, y + index * leading, size, "#eeeae2", 'font-weight="600"')).join("");
  const caption = (value: string, x: number, y: number): string => text(value, x, y, 18, "#a5aaad", 'font-family="Consolas, monospace" letter-spacing="2"');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-labelledby="ticket-title ticket-description" font-family="Arial, Helvetica, sans-serif">
    <title id="ticket-title">Study Metro · ${xml(ticket.destination)}</title>
    <desc id="ticket-description">${xml(`${ticket.kind === "revision" ? "Revision" : "Study"} journey ${ticket.journeyNumber}. ${ticket.lineName}. From ${ticket.origin} to ${ticket.destination}. ${ticket.durationMinutes} minutes completed. ${date.date} ${date.time}.${ticket.examDestination ? ` Exam destination: ${ticket.examDestination}.` : ""}${scheduled ? ` Scheduled: ${scheduled.date} ${scheduled.time}.` : ""}`)}</desc>
    <rect width="1080" height="1350" fill="#0c0e10"/>
    <rect x="24" y="24" width="1032" height="1302" fill="none" stroke="#363c40"/>
    <path d="M24 180V24h180M876 1326h180v-156" fill="none" stroke="${color}" stroke-width="6"/>
    <circle cx="96" cy="105" r="25" fill="none" stroke="#eeeae2" stroke-width="2"/>
    <path d="M82 95h28M82 105h28M82 115h28" stroke="#eeeae2" stroke-width="2"/>
    ${text("STUDY METRO", 145, 116, 30, "#eeeae2", 'font-weight="700" letter-spacing="3"')}
    ${caption("ROUTE", 882, 84)}
    ${text(ticket.routeCode, 882, 140, 48, "#eeeae2", 'font-family="Consolas, monospace"')}
    <path d="M72 180h936" stroke="${color}" stroke-width="6"/>
    ${block(ticket.lineName.toUpperCase(), 72, 237, 32, 936, 2, 40)}
    ${caption(ticket.kind === "revision" ? "REVISION / MAINTENANCE SERVICE" : "STUDY / FOCUS SERVICE", 72, 334)}
    ${caption(ticket.kind === "revision" ? "CONTEXT" : "FROM", 72, 389)}
    ${block(ticket.origin, 72, 427, 28, 936, 2, 34)}
    <path d="M88 514h904" stroke="${color}" stroke-width="4"/>
    <circle cx="88" cy="514" r="12" fill="#0c0e10" stroke="#eeeae2" stroke-width="3"/>
    <circle cx="992" cy="514" r="17" fill="#0c0e10" stroke="#eeeae2" stroke-width="2"/>
    <circle cx="992" cy="514" r="9" fill="${color}"/>
    ${caption("DESTINATION", 72, 581)}
    ${block(ticket.destination.toUpperCase(), 72, 665, 72, 936, 3, 82)}
    <path d="M72 878h936" stroke="#363c40"/>
    ${text(String(ticket.durationMinutes), 72, 989, 96, "#eeeae2", 'font-weight="600" letter-spacing="-3"')}
    ${caption("MINUTES COMPLETED", 72, 1033)}
    ${text(date.date, 568, 940, 27)}
    ${text(date.time, 568, 983, 24, "#a5aaad")}
    ${caption("COMPLETED", 568, 1033)}
    <path d="M24 1082h1032" stroke="#62696d" stroke-dasharray="5 9"/>
    <path d="M24 1068l14 14-14 14M1056 1068l-14 14 14 14" fill="#0c0e10" stroke="#62696d"/>
    ${caption(`JOURNEY #${ticket.journeyNumber}`, 72, 1140)}
    ${ticket.examDestination ? caption("EXAM DESTINATION", 72, 1186) + block(ticket.examDestination, 72, 1225, 24, 440, 2, 30) : caption("ARRIVAL CONFIRMED", 72, 1208)}
    ${scheduled ? caption("SCHEDULED DEPARTURE", 568, 1186) + text(scheduled.date, 568, 1225, 24) + text(scheduled.time, 568, 1258, 22, "#a5aaad") : ""}
  </svg>`;
}

export function ticketFilename(ticket: JourneyTicket): string {
  return `study-metro-${ticket.kind}-${ticket.journeyNumber.replace(/[^0-9]/g, "") || "ticket"}.png`;
}

export async function ticketPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The ticket image could not be rendered.")); image.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1350;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export is unavailable in this browser.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The PNG could not be created.")), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

export function canShareTicket(file: File): boolean {
  try { return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }); }
  catch { return false; }
}
