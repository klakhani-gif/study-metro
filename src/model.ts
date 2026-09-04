import type { TimerSnapshot } from "./timer.js";

export type StationStatus = "not_started" | "studying" | "completed" | "revision_due" | "mastered";

export interface Station {
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
  stationId: string;
  lineId: string;
  durationMinutes: number;
  previousStationStatus: StationStatus;
  timer: TimerSnapshot;
}

export interface AppState {
  schemaVersion: 3;
  profile: NetworkProfile | null;
  lines: MetroLine[];
  stations: Station[];
  exams: Exam[];
  selectedExamId: string | null;
  history: JourneyRecord[];
  selectedStationId: string | null;
  preferredDuration: number;
  activeJourney: ActiveJourney | null;
  premiumUntil: number | null;
  isPaidPremium: boolean;
}

export const LINE_COLORS = ["#E4572E", "#2E6F95", "#6A4C93", "#2E8B57", "#D49A20", "#A23B72", "#3D5A80", "#7A6C5D"];

export function createEmptyState(): AppState {
  return {
    schemaVersion: 3,
    profile: null,
    lines: [],
    stations: [],
    exams: [],
    selectedExamId: null,
    history: [],
    selectedStationId: null,
    preferredDuration: 50,
    activeJourney: null,
    premiumUntil: null,
    isPaidPremium: false
  };
}
