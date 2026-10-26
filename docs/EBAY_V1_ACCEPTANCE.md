# Pinged V1 — eBay production acceptance

Status: **NOT production-verified** (2026-10-26). The live V30 source is not in this repository; do not deploy this placeholder repository over the live app.

## Required secrets (server-side only)
- `PINGED_EBAY_CLIENT_ID`
- `PINGED_EBAY_CLIENT_SECRET`
- Existing chatbot Worker: `pinged-chat`; do not expose `OPENAI_API_KEY` or `CHAT_PASSWORD`.

## Minimal end-to-end acceptance
1. Confirm live source and deployment ownership; preserve existing V30 state and backups.
2. Request eBay OAuth app token server-side via `POST https://api.ebay.com/identity/v1/oauth2/token` with client credentials and `https://api.ebay.com/oauth/api_scope`; cache until shortly before expiry. Never return token to browser.
3. Query `GET https://api.ebay.com/buy/browse/v1/item_summary/search` with `q`, `limit`, marketplace header and pagination, using OAuth bearer token; respect approved access and rate limits. Treat 401, 403, 429 distinctly.
4. Normalize results to stable eBay item ID, title, price/currency, URL, image, listing time, marketplace. Do not invent data if absent.
5. Chat turns user intent into a **proposed** Ping (keywords, exclusions, marketplace); ask user to confirm before saving. Support edits in conversation, not a static wizard.
6. Persist per-user Ping config, created timestamp, check cursor and seen IDs; enforce free tier 3 active Pings and max 3 sources per Ping.
7. Establish initial baseline without alerting on historical results. On later checks, dedupe by stable item ID and notify only genuinely newly discovered matching listings.
8. Inbox is canonical; optional notifications must honor user preferences, quiet mode, and unsupported-browser messaging.
9. Verify two independent users cannot access each other's Pings or alerts. Pause stops polling; secrets never appear in logs.
10. Smoke test on production with a real eBay query; record timestamp, marketplace, HTTP status, count, and a redacted sample ID. Verify new listing detection on a later poll and inbox persistence.

## Troubleshooting
- 401: invalid/expired token or wrong environment.
- 403: insufficient approved Browse API access/scope.
- 429: rate limit; backoff and retry, no tight loops.
- 200 with zero results: valid empty result, not a credential failure.
- Browser CORS failure: route calls through server-side Worker.

## Release gate
No claim of working eBay alerts until the production OAuth → Browse search → persistence → subsequent poll → inbox alert path has been observed successfully. No live deployment from this repo until actual V30 source has been reconciled.
