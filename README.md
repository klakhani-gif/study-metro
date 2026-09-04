# Study Metro — Public beta

A local-first study network: subjects are metro lines, topics are stations, and completed focus journeys advance your progress.

## Run locally

Requires Node.js 22 or later.

```sh
npm install
npm run build
npm run serve
```

Open http://localhost:4173. Rebuild after editing source files. `PORT` and `HOST` can override the local preview server address.

## Verify

```sh
npm test
npm run check
npm run build
```

## Publish

Publish the contents of `dist/` on an HTTPS static host. Guest study works without external services. Optional email/password authentication uses Supabase; see [authentication setup](docs/AUTHENTICATION.md) for public build variables and allowed redirect URLs. The bundled Node server is a local preview server, not a production hosting service. Configure the host to serve `404.html` for missing pages.

## Beta scope

- Create and edit subject lines and study stations; reorder both.
- Start, pause, resume, cancel and recover timestamp-based focus journeys.
- See accepted friends as online, focusing, paused or offline through private Realtime Presence channels.
- Preserve completed stations and journey history in localStorage.
- Optionally sign up, log in and log out with Supabase. Signed-in networks sync to Supabase with separate local account backups; guest data remains local. See [cloud sync setup and testing](docs/CLOUD_SYNC.md).
- Create a private-by-default Study Metro identity and optionally publish aggregate transit statistics at `/u/username`; see [profile setup and privacy](docs/USER_PROFILES.md).
- Find riders by username, manage friend requests through secured RPCs, and compare client-derived weekly focus totals with accepted friends; see [friends security and testing](docs/FRIENDS.md).
- Review local Monday–Sunday activity and export a weekly operations report; see [weekly recap rules](docs/WEEKLY_RECAP.md).
- View and download/share PNG tickets for completed journeys; see [ticket details](docs/JOURNEY_TICKETS.md).
- Maintain completed stations with scheduled revision journeys; see [maintenance rules](docs/STATION_MAINTENANCE.md).
- Schedule future study or revision journeys, edit departures and board through the existing timer; see [timetable rules](docs/TIMETABLE.md).
- Add one exam terminal per subject from the map, the global Add exam action, or Edit Network.
- Countdown and deterministic subject progress; see [exam rules](docs/EXAM_TERMINALS.md).

Prototype demo networks, ad placeholders, simulated rewarded access and payment controls are excluded from the app. Test fixtures live only in `tests/`.

## Limits

Guest data belongs to this browser profile and site origin. Signed-in accounts can recover their last synced cloud network on another device. Unsynced local edits still depend on this browser storage. Conflicts require choosing a copy; there is no automatic merge or network-data export. Keep one writable tab open; additional tabs ask you to close the first tab and reload. Use a current browser supporting Web Locks over HTTPS (localhost is supported for development).

Corrupt records are recovered independently where possible. Before repaired or replacement data is saved, the original is retained at `study-metro:recovery`. Newer unsupported saves cannot be overwritten. A storage failure stops the operation and asks you to reload the last saved state.

See [beta verification and changed files](docs/BETA_RELEASE.md), [architecture](docs/ARCHITECTURE.md), and AGENTS.md.
