import { AppState, createEmptyState } from "./model.js";
import { isRecord, normalizeState } from "./recovery.js";
import { CloudRow, CloudStore, SyncConflict } from "./cloud-store.js";

export type SyncStatus = "Synced" | "Syncing" | "Offline" | "Sync error";
interface Cache { format: 1; state: AppState; version: string | null; known: boolean; allowed: boolean; dirty: boolean }
interface SyncOptions {
  storage: Pick<Storage, "getItem" | "setItem">;
  apply: (state: AppState) => void;
  canReplace?: () => boolean;
  online?: () => boolean;
  debounceMs?: number;
}
export const accountCacheKey = (id: string): string => `study-metro:account:${id}`;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const hasData = (state: AppState): boolean => !!state.profile || !!state.lines.length || !!state.history.length || state.preferredDuration !== 50;

/** Accept supported saves only; never turn an unreadable remote document into an empty upload. */
export function readCloudState(value: unknown): AppState {
  if (!isRecord(value) || !Number.isInteger(value.schemaVersion) || value.schemaVersion < 1 || value.schemaVersion > 5 || !Array.isArray(value.lines) || !Array.isArray(value.stations) || !Array.isArray(value.history)) throw new Error("Unsupported cloud save");
  const state = normalizeState(value);
  for (const key of ["lines", "stations", "history", "exams", "departures"] as const) {
    if (value[key] != null && (!Array.isArray(value[key]) || value[key].length !== state[key].length)) throw new Error("Cloud save needs repair");
  }
  if (value.activeJourney && !state.activeJourney) throw new Error("Cloud journey needs repair");
  return state;
}

/** One account, one request in flight, durable local outbox, timestamp compare-and-swap writes. */
export class CloudSync {
  userId: string | null = null;
  status: SyncStatus = "Syncing";
  message = "";
  choice: "import" | "conflict" | null = null;
  private cache: Cache | null = null;
  private remote: CloudRow | null = null;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private revision = 0;
  private busy = false;
  private abort = new AbortController();
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private failed = false;
  constructor(private store: CloudStore, private options: SyncOptions) {}
  get working(): boolean { return this.busy; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach(fn => fn()); }
  private online(): boolean { return this.options.online?.() ?? true; }
  private commit(cache: Cache): void {
    this.options.storage.setItem(accountCacheKey(this.userId!), JSON.stringify(cache));
    this.cache = cache;
  }
  private backup(): void {
    if (this.cache) this.options.storage.setItem(`${accountCacheKey(this.userId!)}:recovery:${Date.now()}:${crypto.randomUUID()}`, JSON.stringify(this.cache));
  }
  private stop(): void { clearTimeout(this.scheduled); this.scheduled = undefined; }
  private setStatus(status: SyncStatus, message = ""): void { this.status = status; this.message = message; this.notify(); }
  private fail(error: unknown): void {
    this.failed = true;
    const e = error as { status?: number; message?: string };
    const offline = !this.online() || error instanceof TypeError || e?.status === 0 || /fetch|network|abort|timeout/i.test(e?.message ?? "");
    this.setStatus(offline ? "Offline" : "Sync error", "Your local copy is kept. Check your connection or account access, then retry sync.");
  }
  async enter(userId: string, guest: AppState): Promise<void> {
    this.leave(); this.userId = userId;
    this.setStatus("Syncing");
    const token = this.epoch;
    let applied = false;
    try {
      const raw = this.options.storage.getItem(accountCacheKey(userId));
      let cached: Cache | null = null;
      if (raw) {
        try {
          const value = JSON.parse(raw);
          if (value.format !== 1 || typeof value.known !== "boolean" || typeof value.allowed !== "boolean" || typeof value.dirty !== "boolean" || !(value.version === null || typeof value.version === "string" && Number.isFinite(Date.parse(value.version)))) throw new Error("Invalid cache");
          cached = { ...value, state: readCloudState(value.state) };
        } catch {
          // A broken/future account cache is preserved before a replacement is written.
          this.options.storage.setItem(`${accountCacheKey(userId)}:recovery:${Date.now()}:${crypto.randomUUID()}`, raw);
        }
      }
      this.commit(cached ?? { format: 1, state: structuredClone(guest), version: null, known: false, allowed: false, dirty: false });
      this.options.apply(structuredClone(this.cache!.state));
      applied = true;
      await this.check();
    } catch (error) {
      if (token === this.epoch) {
        if (!applied) this.options.apply(structuredClone(this.cache?.state ?? guest));
        this.fail(error);
      }
    }
  }
  leave(): void {
    this.epoch++; this.abort.abort(); this.abort = new AbortController(); this.stop();
    this.userId = null; this.cache = null; this.remote = null; this.choice = null; this.busy = false; this.failed = false; this.revision = 0;
  }
  /** Local persistence is synchronous and happens before the app renders a success state. */
  save(state: AppState): void {
    if (!this.userId || !this.cache) throw new Error("Account cache unavailable");
    if (same(state, this.cache.state)) return;
    this.commit({ ...this.cache, state: structuredClone(state), dirty: true });
    this.revision++;
    if (!this.online()) { this.setStatus("Offline", "Changes are saved locally and will sync after reconnection."); return; }
    if (!this.choice && !this.failed) this.schedule();
  }
  private schedule(): void {
    this.stop();
    if (!this.cache?.allowed || !this.cache.known || this.choice || this.busy || this.failed) return;
    this.setStatus("Syncing");
    this.scheduled = setTimeout(() => { this.scheduled = undefined; void this.flush(); }, this.options.debounceMs ?? 1200);
  }
  async check(): Promise<void> {
    if (!this.userId || !this.cache || this.busy) return;
    this.stop();
    if (!this.online()) { this.setStatus("Offline", "Using the local copy. Reconnect to check the cloud before uploading."); return; }
    const user = this.userId, token = this.epoch;
    const conflictPending = this.choice === "conflict";
    this.busy = true; this.failed = false; this.setStatus("Syncing");
    try {
      const row = await this.store.read(user, this.abort.signal);
      if (token !== this.epoch) return;
      if (row && (row.user_id !== user || !Number.isFinite(Date.parse(row.updated_at)))) throw new Error("Invalid cloud row");
      const remoteState = row ? readCloudState(row.state) : null;
      this.remote = row;
      const cache = this.cache!;
      if (row && remoteState) {
        if (same(cache.state, remoteState)) {
          this.commit({ ...cache, state: remoteState, version: row.updated_at, known: true, allowed: true, dirty: false });
          this.choice = null; this.setStatus("Synced");
        } else if (!conflictPending && cache.known && cache.version === row.updated_at && cache.allowed && cache.dirty) {
          this.choice = null; // Offline edits based on this exact cloud version are safe to upload.
        } else if (conflictPending || cache.dirty || this.options.canReplace?.() === false) {
          this.choice = "conflict";
          this.setStatus("Sync error", "The cloud and local copies differ. Choose which to keep; no cloud data has been overwritten.");
        } else {
          this.adopt(row, remoteState);
        }
      } else if (conflictPending || cache.known && cache.version !== null) {
        this.choice = "conflict"; this.setStatus("Sync error", "The cloud row was removed elsewhere. Keep the local copy or start from the empty cloud copy.");
      } else if (!cache.allowed && hasData(cache.state)) {
        this.choice = "import"; this.setStatus("Sync error", "No cloud network exists. Import this local network into your account, or start fresh?");
      } else {
        this.commit({ ...cache, known: true, allowed: true, version: null, dirty: true });
        this.choice = null;
      }
    } catch (error) { if (token === this.epoch) this.fail(error); }
    finally {
      if (token === this.epoch) { this.busy = false; if (this.cache?.dirty && !this.choice && !this.failed) this.schedule(); this.notify(); }
    }
  }
  private adopt(row: CloudRow | null, state: AppState): void {
    this.backup();
    this.commit({ format: 1, state, version: row?.updated_at ?? null, known: true, allowed: true, dirty: !row });
    this.choice = null; this.failed = false; this.revision++;
    this.options.apply(structuredClone(state));
    this.setStatus(row ? "Synced" : "Syncing");
  }
  /** Explicit consent, with the next write still conditional on the displayed cloud version. */
  async keepLocal(): Promise<void> {
    if (!this.cache || !this.choice || this.busy) return;
    try {
      this.commit({ ...this.cache, known: true, allowed: true, version: this.remote?.updated_at ?? null, dirty: true });
      this.choice = null; this.failed = false;
      await this.flush();
    } catch (error) { this.fail(error); }
  }
  async useCloud(): Promise<void> {
    if (!this.cache || !this.choice || this.busy) return;
    try {
      this.adopt(this.remote, this.remote ? readCloudState(this.remote.state) : createEmptyState());
      if (this.cache.dirty) await this.flush();
    } catch (error) { this.fail(error); }
  }
  async flush(): Promise<void> {
    if (!this.userId || !this.cache?.dirty || !this.cache.allowed || !this.cache.known || this.busy || this.choice || this.failed) return;
    this.stop();
    if (!this.online()) { this.setStatus("Offline", "Changes are saved locally and will sync after reconnection."); return; }
    const user = this.userId, token = this.epoch, revision = this.revision;
    const snapshot = structuredClone(this.cache);
    this.busy = true; this.setStatus("Syncing");
    let conflict = false;
    try {
      const row = await this.store.write(user, snapshot.state, snapshot.version, this.abort.signal);
      if (token !== this.epoch) return;
      if (row.user_id !== user || !Number.isFinite(Date.parse(row.updated_at)) || row.updated_at === snapshot.version) throw new Error("Cloud version did not advance");
      const current = this.cache!;
      this.commit({ ...current, version: row.updated_at, dirty: revision !== this.revision });
      this.remote = row;
      this.setStatus(this.cache!.dirty ? "Syncing" : "Synced");
    } catch (error) {
      if (token !== this.epoch) return;
      if (error instanceof SyncConflict) conflict = true;
      else this.fail(error);
    } finally {
      if (token === this.epoch) {
        this.busy = false;
        if (conflict) { this.choice = "conflict"; await this.check(); }
        else if (this.cache?.dirty && !this.failed) this.schedule();
        this.notify();
      }
    }
  }
}
