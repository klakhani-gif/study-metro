# Authentication

Study Metro offers Supabase email/password authentication and Google OAuth from the full-screen access gate. Continue as guest enters the local network without creating an anonymous account. Account access is absent in Focus Mode.

## Local setup

Use Node.js 22 or later. Set these two values in the project-root `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

`.env.local` is already ignored by git. Use a publishable key (or legacy anon key), never a secret or service-role key. These two public values are intentionally included in the browser build. The build validates their format and rejects secret/service-role keys; no other environment variables are injected. Build-server environment variables take precedence over `.env.local`. Leaving both values empty produces a working guest-only build; partial or invalid configuration fails the build.

In Supabase Dashboard, enable the Email and Google providers under Authentication. Store the Google client ID and client secret only in Supabase's Google provider settings. In Google Auth Platform, use Supabase's displayed callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`) as an authorized redirect URI and add the application origins as authorized JavaScript origins.

Under Supabase Authentication → URL Configuration, allow `http://localhost:4173/login`, `http://127.0.0.1:4173/login` if that local hostname is used, and the production `https://your-domain.example/login` URL. The application always builds the OAuth return URL from `location.origin`; it never hardcodes localhost or a production hostname. Configure the production Site URL before publishing. Keep email confirmation enabled if desired; the app handles both confirmation-required and immediate-session signups.

```sh
npm install
npm run build
npm run serve
```

Open http://localhost:4173/. Rebuild after changing `.env.local`; this project remains a TypeScript/static app, not a Vite app. esbuild is used only to bundle the npm Supabase SDK and substitute the two public configuration values.

## Test signup and login

1. Use one writable Study Metro tab. Click **Guest**, then **Sign up**. Enter an email you control and a password of at least eight characters.
2. If confirmation is required, follow the email link. Close any duplicate Study Metro tab and reload if the existing one-tab protection appears. Then use **Guest → Log in** if a session has not already been established by the confirmation link.
3. Check that the header displays your email. Refresh: the session should remain signed in.
4. Click your email, then **Log out**. The header returns to Guest and your local network, progress and history remain available.
5. Open the panel and choose **Continue as guest**. Study works exactly as before.
6. Try an invalid email, an empty/short signup password and an incorrect login password. Check the inline feedback. Duplicate signups show the provider's explicit account-exists error when available. With confirmation enabled, Supabase may intentionally return a privacy-preserving success response for an existing email; the app says to check email or choose Log in, rather than claiming a new account was created.

## Test Google sign-in

1. Open `/login` and select **Continue with Google**. Confirm the browser leaves through the Supabase authorization endpoint and returns to the same origin at `/login`.
2. On success, the existing session listener sends the user to `/network`, loads cloud state and opens the existing profile setup when no profile exists.
3. Log out, use Google again and confirm the existing profile and cloud network return.
4. Cancel at Google's consent screen. The `/login` access gate should show a sanitized cancellation message and keep email and guest access available.

See [Supabase signup behavior](https://supabase.com/docs/reference/javascript/auth-signup) and [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Data boundary

- The reusable client is in `src/supabase.ts`. It uses the SDK's session persistence, refresh and confirmation-link handling.
- Auth sessions use the separate `study-metro:auth` key. Passwords are passed to the SDK request and cleared from the form after submission; they are not saved in study records.
- Guest study storage, migrations, models, timers and completion behavior are unchanged. Signed-in accounts now use separate local caches and Supabase cloud sync; see [cloud sync setup and testing](CLOUD_SYNC.md). Logging out restores the original guest network.
- Logout uses SDK scope `local`, ending this client's session rather than signing out every device. Errors retain a truthful signed-in state where the SDK has not removed the session.
- Account requests have a 15-second fetch timeout. Pending requests disable duplicate submissions; failures appear within the account panel. Guest access remains available by closing the panel.

## Verification

`npm test` includes validation/error mapping, confirmation-required signup, explicit duplicate responses, loading guards, session-event races, failed logout and session recovery. A real Supabase SDK test uses a mocked auth HTTP transport and verifies login/refresh/logout preserve study and recovery records byte-for-byte. No test creates remote accounts or sends email.

Browser checks use an isolated origin and mock account responses. The configured project's auth settings were checked read-only: email/password and signup were enabled, with email confirmation required. Actual confirmation-email delivery and a real user signup/login must be checked with an email you control.
