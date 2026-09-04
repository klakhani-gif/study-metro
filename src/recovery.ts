import { AppState, Station, StationStatus, createEmptyState } from "./model.js";
import { relayoutStations } from "./layout.js";
import { normalizeExams } from "./exams.js";
import { validDuration } from "./validation.js";
import { emptyRevisionInfo, normalizeRevisionInfo } from "./revision.js";
import { completeDeparture, normalizeDepartures } from "./departures.js";

export const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.filter(isRecord) : [];
const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
const name = (value: unknown, fallback: string, max = 64): string => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const statuses = new Set<StationStatus>(["not_started", "studying", "completed", "revision_due", "mastered"]);

/** Salvage valid records independently; storage preserves the original before writing repairs. */
export function normalizeState(value: unknown): AppState {
  const parsed = isRecord(value) ? value : {};
  const state = createEmptyState();
  const lineIds = new Set<string>();
  state.lines = list(parsed.lines).filter((line) => {
    if (!id(line.id) || lineIds.has(line.id)) return false;
    lineIds.add(line.id); return true;
  }).map((line) => ({ id: line.id, name: name(line.name, "Untitled line", 40), color: typeof line.color === "string" && /^#[0-9a-f]{6}$/i.test(line.color) ? line.color : "#E4572E", stationIds: Array.isArray(line.stationIds) ? [...new Set<string>(line.stationIds.filter(id))] : [] }));
  const seenStations = new Set<string>();
  state.stations = list(parsed.stations).filter((station) => {
    if (!id(station.id) || !lineIds.has(station.lineId) || seenStations.has(station.id)) return false;
    seenStations.add(station.id); return true;
  }).map((station): Station => ({ ...emptyRevisionInfo(), id: station.id, lineId: station.lineId, name: name(station.name, "Untitled station"), x: 0, y: 0, status: statuses.has(station.status) ? station.status : "not_started", estimatedMinutes: validDuration(station.estimatedMinutes) ? station.estimatedMinutes : 50 }));
  state.lines.forEach((line) => {
    const belonging = state.stations.filter((station) => station.lineId === line.id).map((station) => station.id);
    line.stationIds = [...line.stationIds.filter((stationId) => belonging.includes(stationId)), ...belonging.filter((stationId) => !line.stationIds.includes(stationId))];
  });
  state.profile = isRecord(parsed.profile) ? { studyArea: name(parsed.profile.studyArea, "Study Network"), periodName: name(parsed.profile.periodName, "Current term"), createdAt: finite(parsed.profile.createdAt) ? parsed.profile.createdAt : Date.now() } : state.lines.length ? { studyArea: "Study Network", periodName: "Semester 1", createdAt: Date.now() } : null;
  const historyIds = new Set<string>();
  state.history = list(parsed.history).filter((entry) => {
    if (!id(entry.id) || historyIds.has(entry.id) || !id(entry.stationId) || !id(entry.lineId) || !finite(entry.startedAt) || !finite(entry.completedAt) || !finite(entry.focusedSeconds)) return false;
    historyIds.add(entry.id); return true;
  }).map((entry) => ({ id: entry.id, kind: entry.kind === "revision" ? "revision" : "study", stationId: entry.stationId, lineId: entry.lineId, startedAt: entry.startedAt, completedAt: entry.completedAt, focusedSeconds: entry.focusedSeconds }));
  state.stations = state.stations.map((station) => ({ ...station, ...normalizeRevisionInfo(list(parsed.stations).find((raw) => raw.id === station.id) ?? {}, state.history.filter((journey) => journey.stationId === station.id && journey.lineId === station.lineId)) }));
  state.exams = normalizeExams(parsed.exams, lineIds);
  state.selectedExamId = state.exams.some((exam) => exam.id === parsed.selectedExamId) ? parsed.selectedExamId : null;
  state.selectedStationId = state.stations.some((station) => station.id === parsed.selectedStationId) ? parsed.selectedStationId : state.lines.flatMap((line) => line.stationIds)[0] ?? null;
  state.preferredDuration = validDuration(parsed.preferredDuration) ? parsed.preferredDuration : 50;
  state.premiumUntil = finite(parsed.premiumUntil) ? parsed.premiumUntil : null;
  state.isPaidPremium = parsed.isPaidPremium === true;
  const journey = parsed.activeJourney;
  if (isRecord(journey) && isRecord(journey.timer)) {
    const t = journey.timer;
    if (state.stations.some((station) => station.id === journey.stationId && station.lineId === journey.lineId) && validDuration(journey.durationMinutes) && statuses.has(journey.previousStationStatus) && ["focusing", "paused", "complete"].includes(t.phase) && finite(t.startedAt) && finite(t.targetEndAt) && t.targetEndAt >= t.startedAt && finite(t.totalPausedMs) && t.durationMs === journey.durationMinutes * 60_000 && (t.phase !== "paused" || finite(t.pausedAt) && t.pausedAt >= t.startedAt)) {
      state.activeJourney = { kind: journey.kind === "revision" ? "revision" : "study", stationId: journey.stationId, lineId: journey.lineId, durationMinutes: journey.durationMinutes, previousStationStatus: journey.previousStationStatus, timer: { phase: t.phase, startedAt: t.startedAt, targetEndAt: t.targetEndAt, totalPausedMs: t.totalPausedMs, durationMs: t.durationMs, pausedAt: t.pausedAt ?? null } };
    }
  }
  state.departures = normalizeDepartures(parsed.departures, state.stations);
  if (state.activeJourney && isRecord(journey) && id(journey.departureId) && id(journey.journeyId)) {
    const departure = state.departures.find(d => d.id === journey.departureId && d.status === "scheduled" && d.linkedJourneyId === journey.journeyId && d.stationId === journey.stationId && d.lineId === journey.lineId && d.durationMinutes === journey.durationMinutes);
    if (departure && !historyIds.has(journey.journeyId)) {
      state.activeJourney.departureId = journey.departureId;
      state.activeJourney.journeyId = journey.journeyId;
    }
  }
  state.departures = state.departures.map(departure => {
    const record = state.history.find(item => item.id === departure.linkedJourneyId);
    const repaired = record ? completeDeparture(departure, record) : departure;
    if (repaired.status === "scheduled" && repaired.id !== state.activeJourney?.departureId) return { ...repaired, linkedJourneyId: null };
    return repaired;
  });
  return relayoutStations(state);
}
