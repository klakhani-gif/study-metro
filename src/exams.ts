import type { AppState, Exam } from "./model.js";

const DAY_MS = 86_400_000;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function daysUntil(date: string, now = Date.now()): number {
  if (!isCalendarDate(date)) throw new Error("Invalid calendar date");
  const [year, month, day] = date.split("-").map(Number);
  const today = new Date(now);
  // Compare calendar ordinals, not elapsed 24-hour periods across DST boundaries.
  return (Date.UTC(year, month - 1, day) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS;
}

export function examCountdown(days: number): string {
  if (days === 0) return "EXAM TODAY";
  return days > 0 ? `${days} ${days === 1 ? "DAY" : "DAYS"}` : `${Math.abs(days)}D SINCE EXAM`;
}

export function examDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
}

export function examProgress(state: Pick<AppState, "lines" | "stations">, exam: Exam, now = Date.now()) {
  const line = state.lines.find((item) => item.id === exam.lineId);
  const ids = new Set(line?.stationIds ?? []);
  const stations = state.stations.filter((station) => ids.has(station.id) && station.lineId === exam.lineId);
  const unfinished = stations.filter((station) => station.status !== "completed" && station.status !== "mastered");
  const remaining = unfinished.length;
  const daysRemaining = daysUntil(exam.examDate, now);
  const planningDays = daysUntil(exam.targetCompletionDate ?? exam.examDate, now);
  const status = remaining === 0 ? "Completed" : planningDays >= remaining ? "On track" : "Attention needed";
  return {
    total: stations.length, completed: stations.length - remaining, remaining,
    estimatedMinutes: unfinished.reduce((sum, station) => sum + station.estimatedMinutes, 0),
    daysRemaining, planningDays, status
  };
}

export function validateExam(name: string, examDate: string, targetDate: string | null): string | null {
  if (!name.trim() || name.trim().length > 64) return "Enter an exam name of 1–64 characters.";
  if (!isCalendarDate(examDate)) return "Choose a valid exam date.";
  if (targetDate && !isCalendarDate(targetDate)) return "Choose a valid target completion date.";
  if (targetDate && targetDate > examDate) return "The target completion date must be on or before the exam date.";
  return null;
}

/** Migrate missing exams and discard invalid/orphaned entries without touching study data. */
export function normalizeExams(value: unknown, lineIds: Set<string>): Exam[] {
  if (!Array.isArray(value)) return [];
  const seenLines = new Set<string>();
  const seenIds = new Set<string>();
  return value.flatMap((item): Exam[] => {
    if (!item || typeof item !== "object") return [];
    const { id, lineId, name, examDate } = item;
    if (typeof id !== "string" || !id || typeof lineId !== "string" || !lineIds.has(lineId) || seenLines.has(lineId) || seenIds.has(id)) return [];
    if (typeof name !== "string" || !name.trim() || !isCalendarDate(examDate)) return [];
    const targetCompletionDate = isCalendarDate(item.targetCompletionDate) && item.targetCompletionDate <= examDate ? item.targetCompletionDate : null;
    seenLines.add(lineId);
    seenIds.add(id);
    return [{ id, lineId, name: name.trim().slice(0, 64), examDate, targetCompletionDate }];
  });
}
