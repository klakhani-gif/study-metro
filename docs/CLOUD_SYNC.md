# Account cloud sync

Guest mode still uses the original `study-metro:v2` / legacy `v1` storage paths. Each signed-in account has a separate durable cache/outbox at `study-metro:account:<user ID>`. Logging out restores the guest network; it does not delete the account cache or its cloud row. Guest and account networks are not continuously merged.

## Supabase requirements

Use the existing public URL and publishable key in `.env.local`, which remains ignored by git. No secret/service-role key is needed. The browser uses the logged-in session's user ID and the normal Supabase client.

`public.user_state` needs `user_id` (unique, non-null UUID), `state` (non-null JSONB) and `updated_at` (non-null timestamptz). RLS must allow authenticated users to SELECT, INSERT and UPDATE only their own row, with both ownership USING and WITH CHECK conditions. Anonymous visitors must have no table access. SELECT permission is required for conditional updates to return their result.

If equivalent protection is not already configured, run [user_state.sql](../supabase/user_state.sql) in the Supabase SQL editor. This keeps existing rows and adds owner policies, constraints and a trigger that advances `updated_at` for every update. The script rolls back for incompatible/duplicate/null existing data rather than deleting it. Inspect any existing policies/triggers as part of setup. The restrictive owner boundary also limits existing permissive policies.

The frontend cannot verify the project's deployed RLS policies with a publishable key. The SQL has been supplied for the project owner to apply/verify; it was not executed against the hosted database during implementation. Follow [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and test with two different accounts that neither can access the other's row. Do not disable RLS to fix an access error.

## What syncs

The complete existing `AppState` document: profile, lines, stations, exams, revision metadata, departures, history, station completion, selections, duration/settings and active journey snapshot. Timer calculations, completion behavior and model schema are unchanged. Ticket and recap exports remain derived locally. Authentication tokens/passwords are not included in the document.

On login or restored login:

1. Restore that account's local cache if available; otherwise stage a copy of the guest network locally.
2. Read the user's cloud row before allowing an upload.
3. If cloud data exists, load it. Pending local edits or an active local journey/editor prevent silent replacement and require a choice.
4. If the cloud is empty and local study data exists, ask **Import local network** or **Start fresh**. Neither choice removes the guest save. Starting fresh retains the staged copy in account recovery.
5. If neither has study data, start an empty account network.

Offline first login can work against the staged local copy, but cannot upload it until the cloud check succeeds and any import/conflict choice is made. If a remote/cache document is malformed or from a newer unsupported version, its original is retained and it is never automatically replaced with an empty document.

## Saves and conflicts

Local writes complete synchronously before success UI. Changed snapshots are uploaded after 1.2 seconds without another edit; unchanged snapshots are ignored. One database request runs at a time. Edits arriving during an upload remain dirty for the next upload. Hidden-page events attempt to flush, but closing the browser cannot guarantee a network request finishes: the durable outbox resumes on next login.

Initial cloud creation uses INSERT, not upsert. Updates filter on both the session's `user_id` and the last server-returned `updated_at`, preserving its full precision. Another writer changing the version prevents that update atomically. `updated_at` must always advance, including for external SQL edits; the supplied trigger enforces this.

Conflicts show **Sync error** in the account control. Open it to choose:

- **Use cloud copy:** replace the displayed network/active journey with the last inspected cloud copy. The displaced local cache is retained under a uniquely named `study-metro:account:<ID>:recovery:…` key.
- **Replace cloud with local:** explicitly authorize the local copy to replace the inspected cloud version. A subsequent remote change causes another conflict rather than being overwritten.

There is no automatic field merge or background polling. Other-device changes are fetched on login, refresh, reconnection, or **Account → Check sync**. A running local focus session is never silently replaced by a remote snapshot. Studying simultaneously on multiple devices may require choosing a whole network copy afterward.

## Status and outages

- **Synced:** the local document matches the last acknowledged cloud version.
- **Syncing:** a check, debounced save, or upload is pending.
- **Offline:** the browser is offline or a network request failed; local data remains usable.
- **Sync error:** provider/permission/storage failures, an unsupported remote document, or an import/conflict choice needs attention.

The account panel explains the status and offers Retry/Check sync. Reconnection checks the cloud version before uploading offline edits. Failed requests do not run an automatic retry loop. Logging out aborts pending work and fences late responses to their original account; pending edits stay in that account's local outbox until it is used again.

## Test with two browser sessions

1. Confirm the table/RLS/trigger setup above. Run `npm run build`, then `npm run serve`. Open `http://localhost:4173/` in a normal Chrome window (**A**) and an Edge window, separate browser profile, or private window (**B**). Use the same origin in both. Two ordinary tabs in one profile share storage and the existing single-writer lock, so they are not independent sessions.
2. In A, create a small guest network. Log into a test account with no cloud row. Choose **Import local network** and wait for **Synced**. Check that the table has one row with that account's user ID.
3. In B, log into the same account. Its network should load without importing B's guest data. Edit a station or duration in A, wait for Synced, then refresh B or choose **Account → Check sync**. B should show A's change.
4. Test conflicts: start with both synced to the same version. Change A and wait for Synced. Without refreshing B, make a different change in B. B should show Sync error, not overwrite A. Open the account panel and choose Use cloud copy. Repeat and test Replace cloud with local as an explicit overwrite.
5. Test offline: in A's browser DevTools Network panel, select Offline. Edit a station/duration. The status should become Offline and the local account cache should retain the edit. Return Online, then Retry sync if needed. Uncontested edits should sync; intervening B edits should produce a conflict. Refresh offline after the app has loaded/cached its assets, or inspect the outbox after reconnecting. This change does not add a service worker/offline installation feature.
6. Test logout: log out of A. The original guest network should reappear, with the account row still present. Log in again to recover the account network and any pending account edits.
7. Test isolation: use a different test account in B. It must not load A's network. Also verify RLS denies cross-user SELECT/INSERT/UPDATE through authenticated API requests; a user-ID filter in the app alone is not a security policy.

Automated coverage includes two independent caches sharing a simulated cloud, compare-and-swap conflicts, import consent, refresh/offline recovery, lost acknowledgements, rapid saves, in-flight edits, account switches, cache failures, unsupported data, and request filters through the real Supabase SDK with mocked transport. Browser integration tests use a local mock auth/database service; no real study records or remote test accounts are created.
