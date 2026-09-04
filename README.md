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

Publish the contents of `dist/` on an HTTPS static host. No server-side application, credentials, accounts or external services are required. The bundled Node server is a local preview server, not a production hosting service. Configure the host to serve `404.html` for missing pages.

## Beta scope

- Create and edit subject lines and study stations; reorder both.
- Start, pause, resume, cancel and recover timestamp-based focus journeys.
- Preserve completed stations and journey history in localStorage.
- Add one exam terminal per subject from the map, the global Add exam action, or Edit Network.
- Countdown and deterministic subject progress; see [exam rules](docs/EXAM_TERMINALS.md).

Prototype demo networks, ad placeholders, simulated rewarded access and payment controls are excluded from the app. Test fixtures live only in `tests/`.

## Limits

Data belongs to this browser profile and site origin. Clearing site data, switching devices or changing the site's domain does not transfer progress. There is no cloud backup or export in this beta. Keep one writable tab open; additional tabs ask you to close the first tab and reload. Use a current browser supporting Web Locks over HTTPS (localhost is supported for development).

Corrupt records are recovered independently where possible. Before repaired or replacement data is saved, the original is retained at `study-metro:recovery`. Newer unsupported saves cannot be overwritten. A storage failure stops the operation and asks you to reload the last saved state.

See [beta verification and changed files](docs/BETA_RELEASE.md), [architecture](docs/ARCHITECTURE.md), and AGENTS.md.
