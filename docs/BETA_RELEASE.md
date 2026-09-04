# First public beta verification

## Scope and fixes

- Direct exam creation from line signage and the Network heading; direct edit/removal from terminal details. Existing editor remains supported.
- Empty, whitespace-only, duplicate and overlong names/topics receive validation. Topic batches require 1–40 unique topics; duplicate station names are rejected within the same subject, not across unrelated subjects.
- Line edits update the map immediately. New stations clear stale exam selection. Last-line/station guards and cancellable destructive dialogs protect the network.
- Custom duration is validated and read directly at departure. Double-start is guarded. Expiration is checked before pause/end; waking a tab updates the timestamp-based timer immediately.
- A native Web Lock allows one writable tab per origin, preventing stale tabs from overwriting active journeys and edits.
- Save failures stop success rendering, restore the last saved in-memory state, and provide reload guidance. Damaged saves are salvaged record by record and copied to a recovery key before replacement. Unsupported future schemas are read-only. Empty recovered lines can be repaired in Edit Network.
- Modal keyboard trapping includes selects, restores focus, and makes background controls inert. Mobile editor targets are larger; long labels wrap/truncate. The desktop shell no longer reserves space for removed ads.
- Demo data moved to test-only fixtures. Removed simulated Premium/rewarded/payment UI and module, ad placeholders and development copy. Added Study Metro title, favicon and a real 404 response/page. Browser code has no debug logging or local-server dependencies.

## Validation

Automated: 22 tests covering timer timestamps, running/paused recovery, calendar/DST exam calculations, validation, migration, record salvage, corrupt-JSON backup, quota failure, future-schema protection and exam removal. TypeScript check and production build pass.

Browser checks in the local Chromium preview:

- Onboarding validation, reopening, duplicate subject/topic rejection.
- Line create/rename/reorder/delete, station create/rename/reorder/delete, minimum-network guards and destructive cancellation.
- Direct/global exam create, all-lines-assigned empty state, terminal details and removal.
- Custom duration rejection and five-minute departure; running and paused refresh; resume; end/cancel; second-tab lock.
- A real five-minute journey reached ARRIVED; returning and refreshing retained exactly one completed station, one journey and five focused minutes in the log. Isolated browser test data was reset after verification.
- Network at 1920×1080, 1366×768, tablet 768×1024 and mobile 390×844. Map scroll stays inside its canvas. Mobile and desktop Focus Mode stay within the viewport.
- Favicon HTTP 200 and missing-page HTTP 404. Reduced-motion rules cover all animations and transitions.

## Publishing assessment and limits

Suitable for a first limited public beta on HTTPS, for current browsers with Web Locks. Publish only `dist/`.

Data is local to one browser profile and origin. There is no cloud backup/export; clearing site data removes progress. The log displays the most recent 30 journeys while older history remains stored and included in totals. OS sleep is covered by timestamp-jump tests; actual device suspension and Safari/Firefox/screen-reader testing remain pre-expansion checks. No claim of full WCAG certification is made.

## Changed files

- `src/app.ts`
- `src/metro.ts`
- `src/model.ts`
- `src/storage.ts`
- `src/recovery.ts` (new)
- `src/validation.ts` (new)
- `src/monetization.ts` (removed)
- `public/styles.css`
- `public/index.html`
- `public/favicon.svg` (new)
- `public/404.html` (new)
- `scripts/build-assets.mjs`
- `scripts/serve.mjs`
- `tests/exams.test.mjs`
- `tests/storage-migration.test.mjs`
- `tests/fixtures.mjs` (new; not published)
- `tests/beta.test.mjs` (new)
- `README.md`
- `docs/EXAM_TERMINALS.md`
- `docs/BETA_RELEASE.md` (new)

Generated `dist/` assets were rebuilt; the obsolete monetization output was removed. No dependency or timer-engine change was made.
