import type { TimerSnapshot } from "./timer.js";

export type StationStatus = "not_started" | "studying" | "completed" | "revision_due" | "mastered";

export interface RevisionInfo {
  firstCompletedAt: number | null;
  lastReviewedAt: number | null;
  reviewCount: number;
  nextReviewAt: number | null;
}

export type JourneyKind = "study" | "revision";

export interface Station extends RevisionInfo {
  id: string;
  lineId: string;
  name: string;
  x: number;
  y: number;
  status: StationStatus;
  estimatedMinutes: number;
}

export interface MetroLine {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
}

export interface Exam {
  id: string;
  lineId: string;
  name: string;
  /** Local calendar dates, YYYY-MM-DD; no time of day or timezone. */
  examDate: string;
  targetCompletionDate: string | null;
}

export interface JourneyRecord {
  kind: JourneyKind;
  id: string;
  stationId: string;
  lineId: string;
  startedAt: number;
  completedAt: number;
  focusedSeconds: number;
}

export interface NetworkProfile {
  studyArea: string;
  periodName: string;
  createdAt: number;
}

export interface ActiveJourney {
  /** Present only for a journey boarded from the timetable. */
  departureId?: string;
  journeyId?: string;
  kind: JourneyKind;
  stationId: string;
  lineId: string;
  durationMinutes: number;
  previousStationStatus: StationStatus;
  timer: TimerSnapshot;
}

export interface AppState {
  schemaVersion: 5;
  profile: NetworkProfile | null;
  lines: MetroLine[];
  stations: Station[];
  exams: Exam[];
  departures: ScheduledDeparture[];
  selectedExamId: string | null;
  history: JourneyRecord[];
  selectedStationId: string | null;
  preferredDuration: number;
  activeJourney: ActiveJourney | null;
  premiumUntil: number | null;
  isPaidPremium: boolean;
}

export interface ScheduledDeparture {
  id: string;
  lineId: string;
  stationId: string;
  /** Absolute timestamp, entered and displayed in the device's local timezone. */
  scheduledAt: number;
  durationMinutes: number;
  note: string;
  status: "scheduled" | "completed" | "cancelled";
  linkedJourneyId: string | null;
  createdAt: number;
}

export const LINE_COLORS = ["#E4572E", "#2E6F95", "#6A4C93", "#2E8B57", "#D49A20", "#A23B72", "#3D5A80", "#7A6C5D"];

export function createEmptyState(): AppState {
  return {
    schemaVersion: 5,
    profile: null,
    lines: [],
    stations: [],
    exams: [],
    departures: [],
    selectedExamId: null,
    history: [],
    selectedStationId: null,
    preferredDuration: 50,
    activeJourney: null,
    premiumUntil: null,
    isPaidPremium: false
  };
}
