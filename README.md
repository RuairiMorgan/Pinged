# Pinged

Pinged is a personal monitoring and discovery product: describe something you care about, choose suggested sources, and eventually receive verified, deduplicated discoveries. The visual direction is a minimal, accessible, Apple-inspired interface with Ocean Teal `#007F86`.

## Current status — prototype, **not** a live monitoring service

- The responsive Home / Inbox / Account UI is a local preview.
- Natural-language requests are parsed by a basic **rule-based** planner (`src/searchPlanner.js`). It is not an AI agent.
- Source recommendations are **candidates**, not verified working integrations. RSS candidates still require feed verification, a backend, and scheduled checks.
- Users can review source choices and save/edit/remove alert **drafts**. Drafts are stored only in the current browser's `localStorage` and can be exported as JSON.
- Inbox intentionally shows no fabricated results. **No** monitoring jobs, accounts, cloud sync, email/push notifications, billing, or public deployment are connected.
- Older URL-and-keyword prototype alerts are migrated into clearly labeled drafts. An old `enabled` flag does **not** mean a monitor is running.
- `server/monitor.mjs` contains a server-only RSS/Atom keyword checker with an exact HTTPS source-ID allowlist (`server/feedSources.mjs`), no redirects, a 1 MB streamed response cap, MIME and RSS/Atom envelope validation, and stable deduplication IDs. It is **not** wired to the UI, persistent storage, or a scheduler. The BBC feed URL is configured but **not live-verified**. The default HTTPS transport now pins DNS-validated public IPv4 addresses; production still needs network-level egress policy, live source verification and feed health checks.

## Local development

Requires Node.js 20+.

```sh
npm install
npm run dev
npm test
npm run build
```

`npm test` uses Node's built-in test runner and does not require a browser. The Vite build requires installed dependencies.

## Architecture and priorities

1. **Experience:** accessible responsive Home / Inbox / Account shell, natural-language alert preview, truthful source capabilities, browser-local drafts.
2. **Real monitoring:** server-side exact-URL allowlist and bounded RSS checker are implemented with mocked tests; next verify feed availability and rights, verify the pinned IPv4 transport in a deployed network, source-to-draft mapping, scheduling, persistence, deduplication across runs, rate limits, audit trails and reliable failure reporting.
3. **Accounts and notifications:** authenticated storage, email/in-app delivery, per-alert notification preferences, privacy and security controls.
4. **Quality and launch readiness:** end-to-end tests, error handling, deployment/observability, cost monitoring, accessibility checks and owner-approved launch.

Do not claim a successful check, a connected source, a verified discovery, or a notification until the relevant backend action has actually succeeded. Do not spend money, enable paid services, set prices or publicly deploy without owner approval.

## Server feed checker (not connected to the app)

`checkFeed("bbc-news", "climate", { seen })` returns `{ sourceId, checkedAt, status, totalEntries, matches }` after a successful fetch. Unknown source IDs, including arbitrary URLs, fail **before** a request is made. Errors throw; they are never treated as an empty result. `seen` is an in-memory set supplied by the caller, not persistent deduplication. The test suite uses mocked HTTP responses: **no live feed success has been verified**. Do not expose this function as an unauthenticated arbitrary-check endpoint.

## Durable local polling prototype (not scheduled)

`server/polling.mjs` adds `FilePollStore` and `pollAlert({ alertId, sourceId, keyword, store })`. Successful checks persist deduplicated discoveries and last-check metadata; failed checks persist an explicit error status without deleting earlier discoveries. The file is written through an atomic temporary-file rename with restrictive permissions, and read-modify-write operations are serialized **only within one store instance/process**. Keep state files out of version control (the `data/` directory is ignored).

**Limits:** only configured source IDs are allowed; 2,000 seen IDs and 100 inbox items are retained per alert. Evicted old IDs may be rediscovered. There is no cross-process locking, database, authentication, scheduling, notification delivery, DNS/IP egress protection or UI bridge. The BBC source remains unverified; no real monitoring service is running. Do not run multiple server processes against the same state file. Production needs an authenticated database-backed job queue, durable deduplication, retention controls, and network egress restrictions.

## DNS-rebinding-resistant feed transport (not live-verified)

The default `checkFeed` transport is now `server/safeFeedFetch.mjs`: it resolves the operator-configured HTTPS hostname to IPv4, rejects mixed or non-public/reserved DNS answers, and **pins** the validated IP in `https.request`'s socket lookup while retaining normal hostname-based TLS certificate verification. It rejects redirects and nonstandard ports, forwards the 12-second abort signal, and does not follow proxy environment variables. IPv6-only sources fail closed. Mock `fetcher` injection remains available for isolated checker tests. This reduces DNS-rebinding SSRF risk but is **not** a substitute for production egress firewall rules, isolated worker permissions, DNS and TLS integration tests, or verified feed availability. No real source was contacted during this change.

## Opt-in polling scheduler (not running)

`server/scheduler.mjs` provides `createPollingScheduler({ alerts, store })` for an operator-controlled host to explicitly call `start()` or `runDue()`. Only 1–25 configured alerts with allowlisted source IDs are accepted. The minimum interval is 15 minutes and maximum is 24 hours. Overlapping ticks share one run; failed checks use bounded exponential backoff. `stop()` prevents future ticks but does not abort in-flight checks. Unexpected storage failures are reported as **not persisted**.

**Limits:** retry counters and next-run times are in-memory only, and the local file store is single-process only. No host currently starts the scheduler, and the UI is not connected. The BBC source is still configured but unverified. There is no production queue, account authentication, live delivery, notification service or deployment. Six mock-poller tests cover scheduling behavior; no real feed was contacted.

## Feed envelope validator (integrated, not a full XML parser)

`checkFeed` now invokes `server/feedEnvelope.mjs` after bounded response reading and before entry extraction. The conservative RSS 2.0 / Atom envelope check rejects mislabeled HTML, DTD/entity declarations, and unbalanced item/entry tags as **errors**, not as a successful zero-match check. It does **not** verify full XML correctness or replace a production-grade, hardened XML parser. Tests use injected responses; the BBC source remains unverified and no live checks or notifications run.

## Connected local dashboard — October 15

The `mvp-connected-dashboard-20261015` branch adds a **single-owner loopback preview** connecting the RSS checker to durable Pings and the dashboard. It is not a hosted multi-user MVP.

```sh
npm ci
npm test
npm run build
npm start
# Open http://127.0.0.1:8787
```

For frontend development, run `npm start` alongside `npm run dev`; Vite proxies `/api` to loopback port 8787. The API binds only to `127.0.0.1`, checks Host/Origin and requires a custom browser header. These are local-browser protections, **not production authentication**. Do not expose through a public reverse proxy or shared host.

- Saved ideas remain unlimited browser-local drafts. Set up monitoring asks for an exact keyword and supported source before activation. The planner's price/grade filters are not applied to RSS.
- Three active Pings are enforced transactionally, including concurrent create and resume. Paused monitors retain discoveries. Up to three configured sources per Ping are accepted, but only BBC RSS is currently configured.
- The service checks due Pings every 30 seconds, with at least 15 minutes between source checks. Next-run times and failure backoff persist. Only one server/store instance may write the JSON file.
- Discoveries reach a silent inbox with folders, save and useful/not-useful feedback. Feedback never rewrites criteria. Up to 100 discoveries and 2,000 deduplication IDs per Ping are retained; old evicted IDs can recur. This bounded local retention is provisional, not approved pricing/tier policy.
- Push/email are explicitly unavailable; accounts, learning, billing, production storage, other marketplace/news integrations, browser QA and deployment are still pending.

See `docs/product-decisions.md` for the owner-approved product contract and release gates. Earlier sections describe staged development; this section supersedes statements that the checker has no local UI bridge.
