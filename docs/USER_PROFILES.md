# User profiles

Apply [profiles.sql](../supabase/profiles.sql) in the Supabase SQL editor before testing. It preserves compatible rows, enforces one immutable lowercase username per user, limits field lengths, enables owner-only table RLS and installs the narrow public-profile function. The transaction fails instead of deleting or coercing incompatible existing data.

Owners read and update their own `public.profiles` row with the authenticated browser client. New profiles start private. Usernames are 3–20 lowercase ASCII letters, numbers or underscores and cannot be changed; uniqueness is enforced by PostgreSQL, so simultaneous claims are safe. Display names are limited to 40 characters and bios to 240.

`/u/username` calls only `get_study_metro_public_profile`. For a public profile, that security-definer function returns username/display name, joined date, total focus seconds, journey count, completed-station count and subject-line names. It does not return email, bio, exams, station names, notes, timetable details, journey rows or the underlying state document. For a private profile it returns only the requested username and `is_public=false`; all optional identity/stat fields are null. Direct table access remains owner-only under RLS.

The app allowlists and bounds the function result again before rendering. Invalid paths do not make a database request. Public-route text is escaped. Profile requests have loading, duplicate, validation, permission and service-error states; failures do not interrupt network/timer/cloud-sync use.

Local preview routing serves valid `/u/<username>` paths through `index.html`. Production static hosting must rewrite `/u/*` to `/index.html` while retaining the existing 404 behavior for other missing paths.

## Local test

1. Run the SQL, `npm run build`, and `npm run serve`.
2. Log in with an account that has no `profiles` row. The first-run identity panel should appear. Test an uppercase/spaced/short username, then create a valid one. In a second account, try the same username to verify the database duplicate response.
3. Open the account control, choose **View profile**, then **Edit profile**. Change display name and bio, toggle Public profile, and save. Confirm the username control is disabled.
4. Check the own profile statistics against the network and confirm the nearest exam appears only here.
5. Visit `http://localhost:4173/u/<username>`. A public profile should show only the approved aggregates. Switch the profile to private and reload the URL; it should show the simple private state.
6. Use another account and verify direct REST reads/updates cannot access the first account's `profiles` row. Also verify the public function never returns email, bio, exams, notes or detailed study records.

Automated tests cover validation, duplicate creation, profile creation/editing, immutable update payloads, public/private result allowlisting, routing and real-SDK request shapes with a mocked transport. They do not modify the hosted Supabase project.
