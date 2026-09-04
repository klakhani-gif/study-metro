# Free-first Architecture

## V1.1 (current)
- Front end: strict TypeScript + native DOM + SVG + CSS
- State: localStorage, schema version 2
- Metro layout: pure deterministic layout function
- Timer: timestamp snapshot persisted as an active journey
- Hosting target: static Cloudflare Pages
- Cost: $0

The running journey is stored as `startedAt`, `targetEndAt`, pause state and duration. UI ticks are presentation only; refreshing or sleeping the browser cannot change the source-of-truth elapsed time.

## V1.5
- Supabase Free: auth + Postgres + Row Level Security
- Keep local state as an offline/cache layer
- Sync networks, lines, stations, journeys and profiles after authentication

## Monetized production
- Cloudflare Pages: static application
- Cloudflare Worker: trusted payment callbacks / server-only operations
- Supabase: application data and auth
- AdSense: restrained banner inventory + verified rewarded access
- TBC Checkout (or another approved merchant gateway): GEL payments

## Security boundaries
- No payment secrets in browser code
- No Supabase service-role key in browser code
- Rewarded Premium is never granted from an unverified client callback in production
- User-provided labels are escaped before HTML interpolation
- Ads never render in Focus Mode
