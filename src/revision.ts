import type { JourneyKind, JourneyRecord, RevisionInfo, Station } from "./model.js";

const DAY_MS = 86_400_000;
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000 - 45 * DAY_MS;

export function emptyRevisionInfo(): RevisionInfo {
  return { firstCompletedAt: null, lastReviewedAt: null, reviewCount: 0, nextReviewAt: null };
}

export function reviewIntervalDays(reviewCount: number): number {
  return reviewCount <= 0 ? 7 : reviewCount === 1 ? 14 : reviewCount === 2 ? 30 : 45;
}

export function nextReviewDate(completedAt: number, reviewCount: number): number {
  return completedAt + reviewIntervalDays(reviewCount) * DAY_MS;
}

export function isCompletedStation(station: Pick<Station, "status">): boolean {
  return station.status === "completed" || station.status === "mastered" || station.status === "revision_due";
}

/** Due is a presentation state: it never revokes completion or changes exam progress. */
export function isMaintenanceDue(station: Station, now = Date.now()): boolean {
  return isCompletedStation(station) && (station.status === "revision_due" || station.nextReviewAt === null || station.nextReviewAt <= now);
}

export function completeStation(station: Station, kind: JourneyKind, completedAt: number): Station {
  const reviewCount = kind === "revision" ? station.reviewCount + 1 : station.reviewCount;
  return {
    ...station, status: "completed",
    firstCompletedAt: station.firstCompletedAt ?? (kind === "study" ? completedAt : null),
    lastReviewedAt: completedAt, reviewCount,
    nextReviewAt: nextReviewDate(completedAt, reviewCount)
  };
}

/** Existing timestamps win; dated history fills gaps without relabelling old study sessions. */
export function normalizeRevisionInfo(raw: Partial<Record<keyof RevisionInfo, unknown>>, history: JourneyRecord[]): RevisionInfo {
  const dates = history.map((journey) => journey.completedAt).filter(timestamp).sort((a, b) => a - b);
  const studyDates = history.filter((journey) => journey.kind === "study").map((journey) => journey.completedAt).filter(timestamp).sort((a, b) => a - b);
  const firstCompletedAt = raw.firstCompletedAt === null ? null : timestamp(raw.firstCompletedAt) ? raw.firstCompletedAt : studyDates[0] ?? null;
  const lastReviewedAt = timestamp(raw.lastReviewedAt) ? raw.lastReviewedAt : dates.at(-1) ?? firstCompletedAt;
  const reviewCount = typeof raw.reviewCount === "number" && Number.isSafeInteger(raw.reviewCount) && raw.reviewCount >= 0 ? raw.reviewCount : history.filter((journey) => journey.kind === "revision").length;
  const nextReviewAt = timestamp(raw.nextReviewAt) ? raw.nextReviewAt : lastReviewedAt === null ? null : nextReviewDate(lastReviewedAt, reviewCount);
  return { firstCompletedAt, lastReviewedAt, reviewCount, nextReviewAt };
}
