import type { JourneyRecord, ScheduledDeparture, Station } from "./model.js";
import { validDuration } from "./validation.js";

export type DepartureStatus = "Scheduled" | "Boarding soon" | "Ready" | "Missed" | "Completed" | "Cancelled";
const MINUTE = 60_000;
export function departureStatus(departure: ScheduledDeparture, now = Date.now()): DepartureStatus {
  if (departure.status === "completed") return "Completed";
  if (departure.status === "cancelled") return "Cancelled";
  // Boarding reserves this departure until its existing focus journey ends.
  if (departure.linkedJourneyId) return "Ready";
  const until = departure.scheduledAt - now;
  if (until > 15 * MINUTE) return "Scheduled";
  if (until > 0) return "Boarding soon";
  if (until >= -30 * MINUTE) return "Ready";
  return "Missed";
}

export function nextDeparture(departures: ScheduledDeparture[], now = Date.now()): ScheduledDeparture | null {
  return departures.filter(d => d.status === "scheduled" && !d.linkedJourneyId && departureStatus(d, now) !== "Missed")
    .sort((a, b) => a.scheduledAt - b.scheduledAt)[0] ?? null;
}

export function departureGroup(scheduledAt: number, now = Date.now()): "EARLIER" | "TODAY" | "TOMORROW" | "UPCOMING" {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const later = new Date(tomorrow); later.setDate(tomorrow.getDate() + 1);
  return scheduledAt < +today ? "EARLIER" : scheduledAt < +tomorrow ? "TODAY" : scheduledAt < +later ? "TOMORROW" : "UPCOMING";
}

export function localDepartureFields(timestamp: number): { date: string; time: string } {
  const date = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

/** Reject impossible dates and DST clock gaps instead of silently changing the user's time. */
export function parseDepartureTime(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || date < "1000-01-01") return null;
  const timestamp = new Date(`${date}T${time}:00`).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const fields = localDepartureFields(timestamp);
  return fields.date === date && fields.time === time ? timestamp : null;
}

export type DepartureDetails = Pick<ScheduledDeparture, "lineId" | "stationId" | "scheduledAt" | "durationMinutes" | "note">;
export function departureError(details: DepartureDetails, stations: Station[], now = Date.now()): string | null {
  if (!stations.some(s => s.id === details.stationId && s.lineId === details.lineId)) return "Choose a station on this subject line.";
  if (!Number.isFinite(details.scheduledAt) || details.scheduledAt <= now || details.scheduledAt > 253402300799999) return "Choose a valid date and time in the future.";
  if (!validDuration(details.durationMinutes)) return "Choose a whole duration from 5 to 240 minutes.";
  if (details.note.length > 280) return "Keep the note to 280 characters or fewer.";
  return null;
}

export function rescheduleDeparture(departure: ScheduledDeparture, details: DepartureDetails, stations: Station[], now = Date.now()): ScheduledDeparture {
  if (departure.status !== "scheduled" || departure.linkedJourneyId) throw new Error("This departure has already ended or boarded.");
  const error = departureError(details, stations, now);
  if (error) throw new Error(error);
  return { ...departure, ...details, note: details.note.trim(), status: "scheduled", linkedJourneyId: null };
}

export function boardDeparture(departure: ScheduledDeparture, journeyId: string): ScheduledDeparture {
  if (departure.status !== "scheduled" || departure.linkedJourneyId) throw new Error("This departure has already ended or boarded.");
  return { ...departure, linkedJourneyId: journeyId };
}

export function completeDeparture(departure: ScheduledDeparture, journey: JourneyRecord): ScheduledDeparture {
  return departure.status === "scheduled" && departure.linkedJourneyId === journey.id && departure.stationId === journey.stationId && departure.lineId === journey.lineId
    ? { ...departure, status: "completed" } : departure;
}

/** Salvage independent departures. Removed stations cannot remain bookable. */
export function normalizeDepartures(value: unknown, stations: Station[]): ScheduledDeparture[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
  const timestamp = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 253402300799999;
  return value.flatMap((raw): ScheduledDeparture[] => {
    if (!raw || typeof raw !== "object" || !validId(raw.id) || seen.has(raw.id) || !stations.some(s => s.id === raw.stationId && s.lineId === raw.lineId) || !timestamp(raw.scheduledAt) || !timestamp(raw.createdAt) || !validDuration(raw.durationMinutes)) return [];
    seen.add(raw.id);
    return [{ id: raw.id, lineId: raw.lineId, stationId: raw.stationId, scheduledAt: raw.scheduledAt, durationMinutes: raw.durationMinutes, note: typeof raw.note === "string" ? raw.note.trim().slice(0, 280) : "", status: raw.status === "completed" || raw.status === "cancelled" ? raw.status : "scheduled", linkedJourneyId: validId(raw.linkedJourneyId) ? raw.linkedJourneyId : null, createdAt: raw.createdAt }];
  });
}
