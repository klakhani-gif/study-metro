# Study Metro — Agent Rules

## Product principle
Study Metro is a productivity system expressed through transit language. The metro map is the primary interface, not decorative background art.

## Engineering rules
- Do not introduce a framework or dependency without explaining why native TypeScript/CSS/SVG is insufficient.
- Keep time calculations timestamp-based. Never decrement a timer once per second as the source of truth.
- Keep the focus journey state explicit: idle -> focusing <-> paused -> complete/cancelled.
- Persist user-visible progress before rendering success states.
- Ads must never render in Focus Mode.
- Rewarded Premium can only be granted after verified ad completion in production.
- Paid Premium must be verified server-side in production.
- Do not store payment secrets, merchant secrets or service-role keys in browser code.

## Design rules
- Transit signage and cartography, not generic SaaS cards.
- Avoid glassmorphism, purple gradients, emoji navigation, oversized rounded cards, and decorative charts.
- SVG paths/stations are first-class UI elements.
- Use strong typography, rules, grids and line colors.

## Definition of done
A feature is not done until loading, empty, error, mobile, refresh and keyboard states have been considered.
