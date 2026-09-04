export type JourneyPhase = "idle" | "boarding" | "focusing" | "paused" | "complete" | "cancelled";

export interface TimerSnapshot {
  phase: JourneyPhase;
  startedAt: number | null;
  targetEndAt: number | null;
  pausedAt: number | null;
  totalPausedMs: number;
  durationMs: number;
}

function emptySnapshot(): TimerSnapshot {
  return {
    phase: "idle",
    startedAt: null,
    targetEndAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    durationMs: 0
  };
}

export class JourneyTimer {
  private snapshot: TimerSnapshot = emptySnapshot();

  start(durationMinutes: number): void {
    const now = Date.now();
    const durationMs = durationMinutes * 60_000;
    this.snapshot = {
      phase: "focusing",
      startedAt: now,
      targetEndAt: now + durationMs,
      pausedAt: null,
      totalPausedMs: 0,
      durationMs
    };
  }

  restore(snapshot: TimerSnapshot): void {
    this.snapshot = { ...snapshot };
  }

  export(): TimerSnapshot {
    return { ...this.snapshot };
  }

  reset(): void {
    this.snapshot = emptySnapshot();
  }

  pause(): void {
    if (this.snapshot.phase !== "focusing") return;
    this.snapshot.phase = "paused";
    this.snapshot.pausedAt = Date.now();
  }

  resume(): void {
    if (this.snapshot.phase !== "paused" || this.snapshot.pausedAt === null || this.snapshot.targetEndAt === null) return;
    const pauseMs = Date.now() - this.snapshot.pausedAt;
    this.snapshot.totalPausedMs += pauseMs;
    this.snapshot.targetEndAt += pauseMs;
    this.snapshot.pausedAt = null;
    this.snapshot.phase = "focusing";
  }

  cancel(): void {
    this.snapshot.phase = "cancelled";
  }

  remainingMs(now = Date.now()): number {
    if (this.snapshot.targetEndAt === null) return 0;
    const reference = this.snapshot.phase === "paused" && this.snapshot.pausedAt !== null ? this.snapshot.pausedAt : now;
    return Math.max(0, this.snapshot.targetEndAt - reference);
  }

  progress(now = Date.now()): number {
    if (this.snapshot.durationMs <= 0) return 0;
    return Math.min(1, Math.max(0, 1 - this.remainingMs(now) / this.snapshot.durationMs));
  }

  focusedMs(now = Date.now()): number {
    if (this.snapshot.startedAt === null) return 0;
    const end = this.snapshot.phase === "paused" && this.snapshot.pausedAt !== null ? this.snapshot.pausedAt : now;
    return Math.max(0, Math.min(this.snapshot.durationMs, end - this.snapshot.startedAt - this.snapshot.totalPausedMs));
  }

  tick(now = Date.now()): void {
    if (this.snapshot.phase === "focusing" && this.remainingMs(now) <= 0) {
      this.snapshot.phase = "complete";
    }
  }

  get state(): Readonly<TimerSnapshot> {
    return this.snapshot;
  }
}

export function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
