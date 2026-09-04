import type { Session, SupabaseClient } from "@supabase/supabase-js";

export function authInputError(email: string, password: string, signup: boolean): string | null {
  if (email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
  if (!password) return "Enter your password.";
  if (signup && password.length < 8) return "Use a password with at least 8 characters.";
  if (password.length > 1024) return "Use a password of 1024 characters or fewer.";
  return null;
}

export function authErrorMessage(error: unknown): string {
  const value = error as { code?: string; status?: number; message?: string } | null;
  switch (value?.code) {
    case "invalid_credentials": return "Email or password is incorrect. Check your details and try again.";
    case "user_already_exists": case "email_exists": return "An account with this email already exists. Choose Log in.";
    case "email_not_confirmed": return "Confirm your email using the signup message, then log in.";
    case "weak_password": return "This password does not meet the account security requirements. Use a longer, stronger password.";
    case "email_address_invalid": case "validation_failed": return "Check your email address and password and try again.";
    case "signup_disabled": return "Signups are currently disabled. You can log in or continue as guest.";
    case "over_email_send_rate_limit": case "over_request_rate_limit": return "Too many attempts. Wait a little before trying again.";
    case "captcha_failed": return "Account verification is unavailable here. Continue as guest and contact the site owner.";
    case "provider_disabled": case "oauth_provider_not_supported": return "Google sign-in is not available yet. Use email or continue as guest.";
    case "flow_state_not_found": case "flow_state_expired": case "bad_oauth_callback": return "Google sign-in expired before it completed. Please try again.";
  }
  if (value?.status === 429) return "Too many attempts. Wait a little before trying again.";
  if (value?.status && value.status >= 500) return "The account service is temporarily unavailable. Try again shortly.";
  // Avoid displaying arbitrary server responses, tokens, or submitted credentials.
  return "Could not reach the account service or complete this request. Check your connection and try again.";
}

export function oauthCallbackMessage(search: string, hash: string): string | null {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const code = query.get("error_code") ?? query.get("error") ?? fragment.get("error_code") ?? fragment.get("error");
  if (!code) return null;
  return code === "access_denied" ? "Google sign-in was cancelled. You can try again or continue as guest." : "Google sign-in could not be completed. Please try again or use email.";
}

export interface AuthViewState { session: Session | null; loading: boolean; busy: boolean; error: string; message: string; configured: boolean }
type AuthApi = Pick<SupabaseClient["auth"], "getSession" | "onAuthStateChange" | "signInWithPassword" | "signUp" | "signInWithOAuth" | "signOut">;

/** Authentication only: no imports of the network model, timer, or study storage. */
export class AuthController {
  state: AuthViewState;
  private listeners = new Set<() => void>();
  private subscription?: { unsubscribe(): void };
  private eventVersion = 0;
  constructor(private api: AuthApi | null) {
    this.state = { session: null, loading: !!api, busy: false, error: "", message: "", configured: !!api };
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(): void { this.listeners.forEach(listener => listener()); }
  clearMessage(): void { this.state.error = ""; this.state.message = ""; }
  reportExternalError(message: string): void { this.state.error = message; this.state.message = ""; this.notify(); }
  async initialize(): Promise<void> {
    if (!this.api || this.subscription) return;
    const initialVersion = this.eventVersion;
    this.subscription = this.api.onAuthStateChange((_event, session) => {
      // Keep the callback synchronous; never await SDK calls while its auth lock is held.
      this.eventVersion++; this.state.session = session; this.state.loading = false; this.notify();
    }).data.subscription;
    try {
      const { data, error } = await this.api.getSession();
      if (error) this.state.error = authErrorMessage(error);
      else if (this.eventVersion === initialVersion) this.state.session = data.session;
    } catch (error) { this.state.error = authErrorMessage(error); }
    finally { this.state.loading = false; this.notify(); }
  }
  async submit(email: string, password: string, signup: boolean, redirectTo: string): Promise<void> {
    if (!this.api || this.state.loading || this.state.busy) return;
    this.clearMessage();
    const invalid = authInputError(email, password, signup);
    if (invalid) { this.state.error = invalid; this.notify(); return; }
    this.state.busy = true; this.notify();
    try {
      const result = signup ? await this.api.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo } }) : await this.api.signInWithPassword({ email: email.trim(), password });
      if (result.error) { this.state.error = authErrorMessage(result.error); return; }
      this.state.session = result.data.session;
      if (result.data.session) this.state.message = "Logged in.";
      else this.state.message = "Check your email for a confirmation link, then log in. If you already have an account, choose Log in.";
    } catch (error) { this.state.error = authErrorMessage(error); }
    finally { this.state.busy = false; this.notify(); }
  }
  async signInWithGoogle(redirectTo: string): Promise<void> {
    if (!this.api || this.state.loading || this.state.busy) return;
    this.clearMessage(); this.state.busy = true; this.notify();
    try {
      const result = await this.api.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (result.error) { this.state.error = authErrorMessage(result.error); return; }
      this.state.message = "Redirecting to Google…";
    } catch (error) { this.state.error = authErrorMessage(error); }
    finally { this.state.busy = false; this.notify(); }
  }
  async logOut(): Promise<boolean> {
    if (!this.api || this.state.busy || this.state.loading) return false;
    this.clearMessage(); this.state.busy = true; this.notify();
    try {
      const { error } = await this.api.signOut({ scope: "local" });
      if (error) { this.state.error = authErrorMessage(error); return false; }
      this.state.session = null; this.state.message = "Logged out. Your guest network is available locally."; return true;
    } catch (error) { this.state.error = authErrorMessage(error); return false; }
    finally { this.state.busy = false; this.notify(); }
  }
  dispose(): void { this.subscription?.unsubscribe(); this.listeners.clear(); }
}
