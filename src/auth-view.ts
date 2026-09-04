import { AuthController } from "./auth.js";
import type { CloudSync } from "./cloud-sync.js";
import { bindSyncActions, syncPanelMarkup } from "./sync-view.js";

const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
export const accountControl = (): string => `<button class="account-control" data-account-control aria-label="Account: Guest">Guest</button>`;

export function refreshAccountControls(auth: AuthController, sync?: CloudSync | null, profileName?: string | null): void {
  const label = auth.state.loading ? "Checking account…" : profileName ? `@${profileName}` : auth.state.session?.user.email ?? "Guest";
  document.querySelectorAll<HTMLButtonElement>("[data-account-control]").forEach(button => {
    const name = document.createElement("span"); name.className = "account-name"; name.textContent = label;
    button.replaceChildren(name);
    const status = sync?.userId ? sync.status : "";
    if (status) { const detail = document.createElement("small"); detail.className = "account-sync-status"; detail.textContent = status; button.append(detail); }
    button.title = `${label}${status ? ` · ${status}` : ""}`; button.setAttribute("aria-label", `Account: ${button.title}`);
  });
}

export function showAccount(auth: AuthController, bindClose: (modal: HTMLElement) => () => void, sync?: CloudSync | null, openProfile?: () => void): boolean {
  if (document.querySelector("#account-modal-root") || document.body.classList.contains("focus-mode")) return false;
  const modal = document.createElement("div"); modal.id = "account-modal-root";
  modal.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card account-dialog" role="dialog" aria-modal="true" aria-label="Study Metro account">
    <button class="modal-close" data-action="close-modal" aria-label="Close account">×</button>
    <p class="eyebrow">STUDY METRO / ACCOUNT ACCESS</p><div class="auth-content"></div>
  </section></div>`;
  document.body.append(modal);
  let signup = false;
  let renderedIdentity: string | null | undefined;
  let unsubscribe = (): void => {};
  let unsubscribeSync = (): void => {};
  const baseClose = bindClose(modal);
  // bindClose owns Escape/backdrop handlers. Cleanup the subscription when this root is removed.
  const observer = new MutationObserver(() => { if (!modal.isConnected) { unsubscribe(); unsubscribeSync(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true });
  const close = (): void => { unsubscribe(); unsubscribeSync(); observer.disconnect(); baseClose(); };
  const render = (): void => {
    const user = auth.state.session?.user;
    renderedIdentity = user?.id ?? null;
    const content = modal.querySelector<HTMLElement>(".auth-content")!;
    content.innerHTML = user ? `<h2>Account connected</h2><p class="account-email">${escape(user.email ?? "Account")}</p><button type="button" class="text-button" data-profile-open>View profile</button><p class="auth-local-note">Your account network syncs to the cloud with a local backup. Logging out restores your separate guest network.</p><div data-sync-panel></div><p class="auth-local-note">Offline changes stay in this browser until they can sync.</p><p class="auth-feedback" role="status" aria-live="polite"></p><button class="secondary-button auth-submit" data-auth-logout>Log out</button>` : `
      <h2>${signup ? "Create your account" : "Account access"}</h2>
      <p class="auth-local-note">Log in to load your account network. Continue as guest to use your existing local study data.</p>
      <button type="button" class="google-auth-button" data-auth-google><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z"/><path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5L18.7 4.56A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"/></svg><span>Continue with Google</span></button>
      <div class="auth-divider"><span>OR</span></div>
      <div class="auth-modes" role="group" aria-label="Account action"><button type="button" class="text-button" data-auth-mode="login" aria-pressed="${!signup}">Log in</button><button type="button" class="text-button" data-auth-mode="signup" aria-pressed="${signup}">Sign up</button></div>
      ${!auth.state.configured ? `<p class="auth-local-note">Account access is not configured on this build. You can continue as guest.</p>` : ""}
      <form class="setup-form compact-form" id="auth-form" novalidate>
        <label><span>Email</span><input name="email" type="email" autocomplete="email" maxlength="254" inputmode="email" autocapitalize="none" spellcheck="false" required /></label>
        <label><span>Password${signup ? " · at least 8 characters" : ""}</span><input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" maxlength="1024" required /></label>
        <p class="auth-feedback" role="status" aria-live="polite"></p><button class="secondary-button auth-submit" type="submit">${signup ? "Sign up" : "Log in"}</button>
      </form><button class="text-button auth-guest" data-auth-guest>Continue as guest</button>`;
    content.querySelectorAll<HTMLButtonElement>("[data-auth-mode]").forEach(button => button.addEventListener("click", () => {
      const email = content.querySelector<HTMLInputElement>("[name='email']")?.value ?? "";
      signup = button.dataset.authMode === "signup"; auth.clearMessage(); render();
      content.querySelector<HTMLInputElement>("[name='email']")!.value = email;
      content.querySelector<HTMLInputElement>("[name='password']")?.focus();
    }));
    content.querySelector<HTMLButtonElement>("[data-auth-google]")?.addEventListener("click", () => void auth.signInWithGoogle(new URL("/login", location.origin).href));
    content.querySelector<HTMLFormElement>("#auth-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const redirect = new URL(location.pathname, location.origin).href;
      await auth.submit(String(data.get("email") ?? ""), String(data.get("password") ?? ""), signup, redirect);
      const password = form.querySelector<HTMLInputElement>("[name='password']");
      if (password) password.value = "";
    });
    content.querySelector("[data-auth-guest]")?.addEventListener("click", close);
    content.querySelector("[data-auth-logout]")?.addEventListener("click", async () => { if (await auth.logOut()) close(); });
    content.querySelector("[data-profile-open]")?.addEventListener("click", () => { close(); queueMicrotask(() => openProfile?.()); });
    update();
  };
  const update = (): void => {
    if (!modal.isConnected) return;
    if (renderedIdentity !== (auth.state.session?.user.id ?? null)) {
      render();
      const heading = modal.querySelector<HTMLElement>("h2"); heading?.setAttribute("tabindex", "-1"); heading?.focus();
      return;
    }
    const { loading, busy, error, message, configured } = auth.state;
    modal.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".auth-content input, .auth-content button").forEach(control => {
      control.disabled = loading || busy || (!configured && !control.hasAttribute("data-auth-guest"));
    });
    const feedback = modal.querySelector<HTMLElement>(".auth-feedback");
    if (feedback) { feedback.textContent = loading ? "Checking your saved session…" : busy ? "Connecting…" : error || message; feedback.classList.toggle("is-error", !!error); }
    modal.querySelector(".auth-content")?.setAttribute("aria-busy", String(loading || busy));
    const syncPanel = modal.querySelector<HTMLElement>("[data-sync-panel]");
    if (syncPanel && sync?.userId) syncPanel.innerHTML = syncPanelMarkup(sync);
  };
  unsubscribe = auth.subscribe(update);
  if (sync) { unsubscribeSync = sync.subscribe(update); bindSyncActions(modal, sync); }
  render();
  return true;
}
