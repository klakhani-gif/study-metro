# Monetization Architecture

## Rules
1. Focus Mode is ad-free for everyone.
2. No autoplay video or surprise interstitial between pomodoros.
3. Banner inventory only on low-cognitive-load surfaces: Network footer/rail, Journey Log, Control Centre.
4. Rewarded ads are user initiated.
5. The client never decides that an ad or payment is valid in production.

## Entitlement model
User has Premium when either:
- `paid_premium_until > now`, or
- `rewarded_premium_until > now`.

A permanent boolean is acceptable only for internal testing.

## AdSense path
Google AdSense Offerwall supports rewarded-ad choices with time-based entitlements. Configure the real entitlement in the ad platform and mirror server-side only if product features need a logged-in entitlement record.

## Payment path for Georgia
TBC Checkout is a viable local gateway for GEL payments, but merchant onboarding is required. Keep credentials server-side in a Cloudflare Worker. Do not call TBC access-token/payment APIs from the browser.

## Price
Start at 4.99 GEL/month, not lifetime. Revisit once retention and ad revenue are known.
