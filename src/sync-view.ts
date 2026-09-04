import type { CloudSync } from "./cloud-sync.js";

export function syncPanelMarkup(sync: CloudSync): string {
  const disabled = sync.working ? "disabled" : "";
  const actions = sync.choice === "import"
    ? `<button type="button" class="secondary-button" data-sync-action="local" ${disabled}>Import local network</button><button type="button" class="text-button" data-sync-action="cloud" ${disabled}>Start fresh</button>`
    : sync.choice === "conflict"
    ? `<button type="button" class="secondary-button" data-sync-action="cloud" ${disabled}>Use cloud copy</button><button type="button" class="text-button" data-sync-action="local" ${disabled}>Replace cloud with local</button>`
    : `<button type="button" class="text-button" data-sync-action="check" ${disabled}>${sync.status === "Sync error" || sync.status === "Offline" ? "Retry sync" : "Check sync"}</button>`;
  // Message strings are application-owned, never arbitrary server responses.
  return `<p class="eyebrow" role="status">${sync.status}</p><p class="auth-local-note">${sync.message || "Your account network is backed up in this browser and saved to the cloud."}</p>${sync.choice === "conflict" ? `<p class="auth-local-note">Use cloud copy replaces this screen's network and active journey; the current local copy is retained in recovery. Replace cloud with local overwrites the displayed cloud version only after you choose it.</p>` : ""}<div class="sync-actions">${actions}</div>`;
}
export function bindSyncActions(root: HTMLElement, sync: CloudSync): void {
  // The existing modal card stops propagation to its backdrop/root. Delegate inside that boundary.
  (root.querySelector(".modal-card") ?? root).addEventListener("click", event => {
    const action = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-sync-action]")?.dataset.syncAction : undefined;
    if (action === "local") void sync.keepLocal();
    if (action === "cloud") void sync.useCloud();
    if (action === "check") void sync.check();
  });
}
