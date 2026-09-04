# Friends and friend leaderboard

Friends use `search_study_metro_profiles` and `list_study_metro_friendships` for narrow identity reads. All relationship mutations use the installed `send_friend_request`, `accept_friend_request`, `decline_friend_request`, `cancel_friend_request` and `remove_friend` RPCs. The browser never inserts, updates or deletes `friendships`, never queries another user's `profiles` row and never reads another user's `user_state`.

`user_state` remains the private source of Study Metro data. The browser derives one safe `user_stats` row for the logged-in user and upserts only `user_id`, local Monday `week_start`, weekly focus minutes/journeys, lifetime focus minutes/journeys, completed-station count and `updated_at`. Updates are debounced after relevant state changes, cloud hydration and login. A local midnight check rolls the week forward even without a study edit. RLS is responsible for limiting reads to the owner and accepted friends and writes to the owner.

Friend rankings include the current user and accepted friends only, sort by weekly focus minutes, then weekly journeys, then username, and use `user_stats` exclusively. A row whose `week_start` does not equal the viewer's current local Monday contributes zero weekly minutes and journeys. These values are client-derived and are explicitly presented as unverified.

Live activity uses Supabase Realtime Presence on private channels named `study-metro:user:<user_id>`. Each tab tracks its own Presence key so reconnects and concurrent sessions merge predictably: focusing takes precedence over paused, then online. The payload is limited to user ID, status and timestamp; only the focusing state adds a truncated subject-line name and rounded remaining minutes. Accepted-friend IDs from `list_study_metro_friendships` are the only channels the browser subscribes to. Turning off **Show activity to friends** immediately reduces the user's broadcast to the generic `ONLINE` state.

Realtime Authorization must remain enabled for private channels, and Realtime Settings must have public channel access disabled. The `realtime.messages` policies must continue to restrict `study-metro:user:<user_id>` Presence writes to the channel owner and reads to the owner or an accepted friend. Presence is ephemeral; no database row or private `user_state` data is used.

## Two-account test

1. Build and serve the app, then use two separate browser profiles or different browsers at the same origin. Ordinary tabs share the single-writer lock and are not independent sessions.
2. Log in as A and B, complete profile setup for both, and wait for cloud sync. Open Friends in each account.
3. In A, search B's exact username and send a request. Confirm a repeated click/request does not create a duplicate and the result becomes Pending.
4. In B, open Requests. Confirm A appears under Incoming, then accept. Repeat with a new request to test Decline; test Cancel from the sender before acceptance.
5. Confirm both accounts show the accepted friend with only display name, username, weekly focus, and weekly journey count. No email, bio, exam, note, station, timetable or raw history should appear in network responses.
6. Complete a focus journey in A, wait for cloud and aggregate sync, then reload Friends in B. Confirm A's safe totals update. Inspect `user_stats` and verify it contains only the documented aggregate columns.
7. Set a test friend's `week_start` to the prior Monday in a controlled test row. Their weekly values must display as zero even if stored values are nonzero.
8. Remove the friendship from either account. Confirm the other account no longer reads that user's stats under RLS.
