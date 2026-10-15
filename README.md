# Pinged

Pinged helps people describe something they care about, monitor supported sources and collect relevant discoveries. The owner-approved experience is a clean Apple-inspired dashboard with Ocean Teal `#007F86`, three free active Pings, up to three sources per Ping, unlimited saved ideas, optional push and no advertising or forced upgrade prompts.

## Current status

This branch is a **local, single-process preview**, not a launched multi-user MVP.

- Home, Inbox and Account screens include a rule-based natural-language planner, reviewable saved ideas, exact-keyword monitor setup, editing, pause/resume, folders, save and useful/not-useful feedback.
- The running loopback service connects supported RSS checks to persistent Pings and inbox entries. Deduplication, next-run times and failure backoff survive restart. Tests exercise HTTP → RSS parsing → persistence → push queue with injected feed/provider responses.
- Optional local accounts include registration, sign-in/out, password hashing, revocable sessions, separate monitoring stores and per-account limits. Saved ideas remain browser-local, separated by account; they do not sync between devices.
- Optional Web Push includes browser subscription, encrypted/VAPID-authenticated transport, a durable delivery queue and retries. It is disabled unless the operator configures keys and the user connects a supported browser. **No real push-provider acceptance or device display has been verified.**
- Only BBC News RSS is configured. Its live availability remains unverified. Suggested marketplaces and other sources are candidates, not working integrations. RSS does not enforce the planner's proposed price, grade or year criteria.
- Production database/identity, password recovery, verified email, email delivery, billing, other source integrations, live/browser QA and public deployment remain pending. Do not present this preview as a finished MVP.

The latest acceptance estimate and verification record are in `docs/mvp-progress.md`; the owner's product contract is in `docs/product-decisions.md`.

## Run locally

Requires Node.js 20+ and installed dependencies.

```sh
npm ci
npm test
npm run build
npm start
# Open http://127.0.0.1:8787
```

This opens the original single-owner workspace. For account mode:

```sh
PINGED_ACCOUNTS=1 npm start
```

Create a username (3–40 letters/numbers/underscores/hyphens) and a password (12–128 characters). Existing single-owner data and legacy browser saved ideas are not automatically assigned to a new account. For frontend development, run `npm run dev` alongside the server; Vite proxies `/api` to port 8787.

The server binds only to loopback, checks Host/Origin and requires a custom browser header. Do not expose it through a public reverse proxy or shared host. Only one server process may write these JSON stores.

## Accounts and privacy

Passwords use salted scrypt hashes. Random session tokens are stored only as hashes; the browser receives an HttpOnly, SameSite=Strict cookie with a seven-day lifetime. Signing out revokes the session and its push devices. Expired sessions lose their push devices during the scheduler's next pass. Registration/sign-in are rate limited, with bounded password-work concurrency. These controls are for the local preview, not a replacement for production identity infrastructure.

API ownership comes from the session, never a supplied user ID. Another account's Ping IDs return 404 for mutations. Dashboard requests carry the account they were rendered for, so a stale tab cannot modify a newly signed-in account; storage/focus events refresh the workspace across tabs. Browser-local saved-idea keys separate account views but are not encrypted storage.

State is written atomically with restrictive file permissions under gitignored `data/`: `pinged.json` for the original workspace, `accounts.json` for credentials/sessions and `users/<account-id>.json` for account workspaces. The Account export currently covers browser-local saved ideas, not inbox/monitor data.

## Supported-source monitoring

`server/monitor.mjs` accepts only source IDs in the operator-maintained `server/feedSources.mjs` allowlist. It validates keywords, bounds response bodies to 1 MB, validates MIME/feed envelopes, rejects DTD/entity declarations and deduplicates discoveries. The conservative envelope validator is not a full XML parser.

`server/safeFeedFetch.mjs` rejects non-HTTPS URLs, credentials, nonstandard ports, redirects and unsafe DNS answers. It pins a validated public IPv4 address to the HTTPS socket while retaining original-host TLS validation. IPv6-only sources fail closed. Production still needs egress controls, live feed/rights checks and worker isolation.

The connected service checks due Pings on a 30-second tick, with at least 15 minutes between source checks and bounded exponential failure backoff. Three active slots are enforced transactionally, including concurrent create/resume. Pause, deletion and criteria changes invalidate stale in-flight monitoring results. Inbox retention is currently 100 discoveries and 2,000 deduplication IDs per Ping; evicted old IDs can recur. These are disclosed local prototype bounds, not approved tier/pricing commitments.

## Optional Web Push

Account mode advertises push only when all three operator environment variables are set:

- `PINGED_VAPID_PUBLIC_KEY`
- `PINGED_VAPID_PRIVATE_KEY`
- `PINGED_VAPID_SUBJECT` — an operator-controlled `mailto:` contact or HTTPS URL

Use a persistent VAPID key pair generated with the installed `web-push` library. Keep the private key outside source control; changing it requires reconnecting browsers. No keys are generated, committed or activated by this change. Incomplete configuration leaves push disabled; invalid complete configuration fails startup.

In Home, choose **Enable on this browser** and grant permission, then select **Push** for the Pings that should notify you. Silent remains the default. Only HTTPS or supported loopback browser contexts support this flow. Browser/device support varies; iOS and installed-web-app flows are not verified here. Supported exact endpoint hosts are `fcm.googleapis.com`, `updates.push.services.mozilla.com` and `web.push.apple.com`; other providers fail closed.

The server validates subscriptions and uses `web-push` for RFC payload encryption/VAPID signing. Its own transport validates/pins public DNS, preserves TLS hostname verification, imposes a ten-second deadline and rejects redirects. Provider response bodies, device endpoints and keys are not returned in dashboard state or logged.

New discoveries and their delivery jobs are persisted in the same transaction. Retries survive restart, stop after five attempts and remove retired 404/410 endpoints. Pause, removal, revised criteria, silent preference, disconnect and expired sessions cancel pending work. A request already handed to a provider cannot be recalled. Delivery is at least once with stable notification tags; a crash after provider acceptance but before recording it can cause a retry.

Push jobs expire after 24 hours. The local queue retains up to 900 pending/in-flight events and 100 terminal records, sending at most 20 per pass. A full queue exposes an overflow warning rather than evicting pending events; inbox discoveries are retained. Up to five push devices can be connected per account. These are provisional local resource limits.

`accepted` means the provider returned a 2xx response, **not** that the device displayed it. Notifications show a generic message, keeping search terms and discovery content off the lock screen. The worker checks the current signed-in account before display and suppresses stale-account, signed-out and offline events. It caches no private dashboard pages and notification clicks open only this app's inbox. Suppressed notifications are not replayed; discoveries remain available in the inbox.

## Verification and remaining work

Run `npm test` for the complete Node suite and `npm run build` for the production bundle. Tests cover local HTTP account isolation, RSS-to-inbox persistence, queue/retry policies, real encryption/request generation with an injected transport, and isolated service-worker handlers. These are not substitutes for a real browser subscription or a real push-provider/device test. Browser QA was attempted but Chromium installation was unavailable in this environment.

Next release work: live source verification, real browser/device notification tests, production authenticated storage and scheduling, remaining agreed experience controls, responsive/accessibility QA and deployment operations. Do not spend money, activate paid services, set prices, merge or publicly deploy without owner approval.
