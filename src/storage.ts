import { AppState, createEmptyState } from "./model.js";
import { isRecord, normalizeState } from "./recovery.js";

const KEY = "study-metro:v2";
const LEGACY_KEY = "study-metro:v1";

let recoveryRaw: string | null = null;
let futureVersion = false;
export let storageNotice = "";
export function isStorageReadOnly(): boolean { return futureVersion; }

export function loadState(): AppState {
  recoveryRaw = null; futureVersion = false; storageNotice = "";
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return createEmptyState();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      recoveryRaw = raw;
      storageNotice = "Saved data could not be read. The original will be kept in a recovery copy before a new network is saved.";
      return createEmptyState();
    }
    if (isRecord(parsed) && parsed.schemaVersion > 3) {
      futureVersion = true;
      storageNotice = "This network was saved by a newer version. Reload the latest Study Metro before editing; saving is disabled to protect your data.";
    }
    const state = normalizeState(parsed);
    if (JSON.stringify(state) !== JSON.stringify(parsed)) recoveryRaw = raw;
    if (!futureVersion && (!isRecord(parsed) || (Array.isArray(parsed.stations) && state.stations.length !== parsed.stations.length) || (parsed.activeJourney && !state.activeJourney))) storageNotice = "Some saved data needed repair. Valid stations and history were recovered; the original is kept before the next save.";
    if (!localStorage.getItem(KEY) && !futureVersion) {
      try { saveState(state); } catch { storageNotice = "Your older network was recovered, but could not be saved. Browser storage may be full or unavailable."; }
    }
    return state;
  } catch {
    storageNotice = "Browser storage is unavailable. Enable storage for this site before creating or changing a network.";
    return createEmptyState();
  }
}

export function saveState(state: AppState): void {
  if (futureVersion) throw new Error("A newer save must not be overwritten.");
  if (recoveryRaw !== null) {
    localStorage.setItem("study-metro:recovery", recoveryRaw);
    recoveryRaw = null;
  }
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function resetState(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem("study-metro:recovery");
}
