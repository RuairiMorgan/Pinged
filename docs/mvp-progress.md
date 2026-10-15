# Pinged MVP development log

## 2026-10-14 — Dashboard and draft workflow

- Replaced URL/keyword-only prototype screen with responsive Apple-inspired Home, Inbox and Account navigation.
- Connected rule-based natural-language planner to a two-step review and save-draft flow.
- Source suggestions show their actual unconnected status; no fake verified source integrations.
- Added local draft persistence, editing, deletion, export and migration from the old browser schema.
- Added Node unit tests for draft creation and migration.
- Next: secure verified-source monitoring connector and scheduled backend, then persistence and notifications.

**Verification:** 10 Node tests passed locally. JSX transpilation syntax check and CSS parsing passed. A full Vite build could not run in the isolated workspace because npm dependencies were not installed. Browser interaction remains unverified.

**Launch status:** not deployed; no accounts, live monitoring or notifications.

## 2026-10-14 — Allowlisted RSS/Atom checker security pass

- Replaced URL-accepting feed checker with server-only source-ID lookup and a single configured, unverified BBC RSS URL.
- Enforced HTTPS, rejected redirects and credentials, required RSS/Atom XML MIME types, limited streamed responses to 1 MB, capped parsed entries at 250, and validated keywords.
- Added source-scoped stable IDs, within-batch deduplication, seen-ID filtering, safe article URL handling and explicit successful-check metadata. Failures throw instead of appearing as zero discoveries.
- Added six mock-HTTP Node tests for allowlist/SSRF boundary, request options, RSS/Atom parsing, deduplication and error/size limits.

**Verification:** six new tests passed using Node.js 22.16.0 (`node --test tests/monitor.test.mjs`) in an isolated local test directory. The previous ten frontend/planner tests were not rerun in this pass. No live network feed, full Vite build, or browser workflow was verified.

**Remaining blockers:** source is not live-verified; no DNS/IP egress filtering, scheduler, persistent seen IDs, UI/backend bridge or notifications. No deployment.

## 2026-10-14 — Durable single-process polling prototype

- Added `FilePollStore` for atomic local JSON state writes, serialized in-process transactions and fail-closed corrupt-state handling.
- Added `pollAlert` that accepts only allowlisted source IDs, retains discoveries and deduplicates across process restarts, preserves historical inbox entries on check failure and records truthful last-check statuses.
- Bounded retained seen IDs (2,000) and inbox entries (100), rejected unsafe alert IDs and configuration mutation under the same alert ID.
- Added five isolated mocked-checker tests; `data/` is gitignored.

**Verification:** five new tests passed under Node.js 22.16.0 in an isolated directory with an injected checker and a stub import for `server/monitor.mjs`. Existing repository tests, full Vite build, live feed requests and browser checks were **not** rerun in this pass.

**Limitations:** single process only; no scheduler, source verification, IP/DNS egress controls, authenticated API, UI wiring, cloud persistence or notifications. No public deployment.

## 2026-10-14 — Pinned HTTPS feed transport security increment

- Added `server/safeFeedFetch.mjs` as the default transport for allowlisted feed checks, pinning DNS-validated public IPv4 addresses to the HTTPS socket while preserving original-host TLS verification.
- Rejected unsafe/reserved/mixed DNS answers, literal IP hostnames, non-HTTPS URLs, credentials, nonstandard ports, fragments and redirects. IPv6-only sources fail closed; the request abort signal also covers DNS resolution.
- Added six focused transport tests for IP filtering, DNS failure, request policy, pinned lookup, redirects and abort behavior.

**Verification:** six new Node 22.16.0 tests passed locally (`node --test tests/safeFeedFetch.test.mjs`); initial test assertion/fixture failures were corrected before commit. The full repository test suite, Vite build, live HTTPS feed availability and browser experience were not verified in this run.

**Remaining blockers:** live source verification, infrastructure egress rules, authenticated API, scheduler, draft-to-monitor activation, notifications and end-to-end QA. No deployment.

## 2026-10-14 — Opt-in scheduler prototype

Added bounded, operator-configured polling scheduler with explicit start/stop, 15-minute minimum interval, no overlapping runs and exponential error backoff. Six isolated Node.js tests passed using mocked pollers and fake clocks. No real feed, full build or browser testing was performed. Scheduler is not running, is not connected to the UI, and keeps timing state in memory. Next: verify source availability, add authenticated backend and durable scheduling.

## 2026-10-15 — Feed envelope validator staged

Added `server/feedEnvelope.mjs`, a conservative RSS 2.0 / Atom envelope validator, with five isolated Node tests. It recognizes expected feed shapes and rejects mislabeled HTML, XML declarations for DTD/entities, and unbalanced item/entry tags. **This is a staged utility, not yet integrated into `checkFeed`**: the existing monitoring behavior is unchanged. The connector blocked writing the modified `server/monitor.mjs`, so the integration was intentionally not claimed. The validator is not a standards-compliant XML parser.

**Verification:** five isolated Node.js 22.16.0 unit tests passed; module syntax check passed. No live source request, complete repository test suite, Vite build, browser QA, or deployment was performed. Next: integrate the validator, rerun the entire monitoring suite, verify the configured feed live, and connect scheduler persistence.


## 2026-10-15 — Integrate conservative feed envelope validation

- Wired `validateFeedEnvelope(xml)` into `checkFeed` after the bounded body read and before item extraction.
- Added a checker-level regression test to reject HTML disguised as XML, unbalanced item tags and DTD/entity declarations rather than returning a successful empty discovery list.
- Preserved existing allowlist, HTTPS transport, persistence and scheduler behavior. No monitoring service was started.

**Verification:** Node.js 22.16.0 syntax checks passed for the integrated checker and validator in an isolated local reproduction. Four focused Node tests passed using injected RSS/Atom responses, including malformed-envelope rejection. The isolated reproduction used a stub HTTPS transport and was manually reconstructed from the committed source; it is **not** a complete repository checkout or proof that the committed GitHub test suite passes. The previous five validator unit tests passed in the preceding run. The complete repository suite, Vite build, browser QA and live feed availability remain unverified. Next: execute all Node tests in a local checkout, verify an approved live feed, then wire scheduler results to an authenticated backend.

## 2026-10-15 — Consolidated local monitoring/dashboard path

Branch `mvp-connected-dashboard-20261015` starts from the full feed-envelope branch, preserving that dashboard and all server security work. Main's three-active-Ping requirement is implemented transactionally in the new service rather than copying its older URL-only UI.

- Recovered product decisions in `docs/product-decisions.md`, including free 3 active / 3 sources, unlimited saved ideas, silent/push choice, no advertising, restrained Pro, optional reviewable learning and accepted experience backlog.
- Added loopback-only HTTP API and dashboard integration: explicit exact-keyword setup, persistent active Pings, pause/resume/remove, truthful source health, silent inbox folders, saved discoveries and useful/not-useful feedback. Saved-idea setup preserves the original request and asks for exact RSS matching criteria; unsupported filters are disclosed.
- Enforced active limits in serialized storage transactions (including concurrent creates and resume), source allowlist and unavailable-delivery rejection. No arbitrary URL fetching endpoint.
- Durable due times and exponential backoff survive restart; checks do not hold the store transaction during network I/O, and pause/delete during a fetch discards that arrival. Local retention is bounded and disclosed.
- Preserved minimal teal design and approved headline. Added lockfile for reproducible dependency installation.

**Verification:** complete checkout test suite passes (46 tests), including real loopback HTTP API integration, restart deduplication, concurrency/limit enforcement, pause during fetch, failure/backoff persistence and HTTP → actual RSS parser → persistent inbox with injected feed bytes. `npm run build` passes with Vite 5.4.21. `git diff --check` passes. A real BBC feed attempt failed at DNS (`queryA ECONNREFUSED feeds.bbci.co.uk`), so source availability remains unverified. Browser visual/interaction QA was not available; no public deployment, production accounts, push or email delivered.

**Next:** verify the source and UI in a permitted runtime, add production account-isolated database storage/job scheduling and genuine push/email, integrate supported marketplace/source APIs, complete remaining accepted experience controls and deployment QA. Do not present the local service as a finished MVP.

### Stable MVP progress rubric

Estimate progress against these release outcomes; preserve weights between updates. Percentages reflect acceptance evidence, not files or commits. Initial estimate for this increment: **30%**, with substantial uncertainty until live/browser testing.

| Outcome | Weight | Evidence credit |
| --- | ---: | ---: |
| Responsive approved dashboard and creation/review experience | 15 | 10 |
| Supported-source coverage and exact verified matching | 15 | 3 |
| Persistent scheduling, deduplication, pause and recovery | 15 | 10 |
| Accounts, user isolation and production data controls | 15 | 0 |
| Inbox, folders and genuine notification delivery | 15 | 5 |
| Free/Pro entitlements and restrained upgrade experience | 10 | 2 |
| Suggestions, preference controls and agreed discovery experience | 5 | 0 |
| Live/browser QA, deployment and operational readiness | 10 | 0 |
| Total | 100 | 30 |

## 2026-10-15 — Activation race safety

- Fixed a pause → resume race: a check started before pausing can no longer write stale discoveries or failure/backoff metadata into a newly resumed Ping. Each enable-state transition increments an activation revision, checked before applying network results.
- Added `tests/activationRevision.test.mjs` covering an in-flight result returned after pause/resume.
- **Verification:** GitHub accepted the code and test commits. The new test and full suite have **not** been executed in this run; build, live feeds, browser QA and deployment remain unverified here. The previous verified 46-test/build result belongs to the preceding increment.
- **Progress rubric:** unchanged at **30% estimated** until the regression test and full suite are run; this is a safety fix, not a newly satisfied release gate.
- Next: run full suite/build in a checkout, verify feed reachability and browser interaction, then implement authenticated account isolation and genuine notifications.

## 2026-10-15 — Verified active-Ping editing

- Added dashboard editing for an active or paused Ping's description, exact phrase, source and folder, backed by a dedicated `PUT /api/pings/:id` route and transactional service update.
- Monitoring changes invalidate in-flight results from the previous criteria, clear obsolete source health, reset failure backoff and make an enabled Ping due immediately. Existing inbox history is retained.
- Added service/API regression coverage for persistence and the edit-during-fetch race.

**Verification:** the complete repository suite passes with **48 tests** on Node.js 22, including the previously unexecuted activation-revision test and the new edit path. `npm run build` passes with Vite 5.4.21 and `git diff --check` passes. Live feed availability, browser visual/interaction QA, production accounts, genuine push/email and deployment remain unverified.

**Progress rubric:** **31% estimated**. Dashboard/creation-review evidence increases from 10/15 to 11/15 because a running Ping can now be edited through the UI/API with persisted, race-safe monitoring criteria. No credit changed for accounts, live sources, genuine notifications or deployment.

Next: add authenticated account isolation, then genuine notification delivery and live/browser QA.

## 2026-10-15 — Opt-in local accounts and isolated workspaces

- Added local username/password registration, sign-in and sign-out. Passwords use salted scrypt derivation; only hashes of random session tokens are stored. Sessions expire after seven days, survive restart and are revoked on sign-out. Cookies are HttpOnly and SameSite=Strict on the existing loopback-only server.
- Authenticated API requests resolve the account from the session, never a client-supplied account ID. Each account has its own store, active-Ping allowance, inbox and scheduled monitoring. Unauthenticated reads/writes return 401; another account's Ping IDs return 404 for edit, pause, delete and feedback.
- Added sign-in/create-account screens, sign-out in Account, session-expiry handling and account-scoped browser draft keys. Existing single-owner preview data is left in its original workspace and is not silently imported into a new account.
- Added bounded password-work concurrency and sign-in/registration throttling. This remains an explicitly enabled **local, single-process preview**, not production authentication: no recovery, verified email, hosted database, distributed rate limiting, HTTPS hosting or public deployment.

**Verification:** all **53 Node tests pass**, including real HTTP registration/session cookies, unauthenticated denial, cross-account reads/mutations, independent slot limits, scheduler/inbox persistence, restart, password/token-at-rest checks, logout and expiry. Vite production build and `git diff --check` pass. Browser QA was attempted, but no Chromium executable was installed and browser downloads returned invalid archives; therefore the React account flow remains **browser-unverified**. RSS responses in these tests are mocked; no live source or real notification success is claimed.

**Progress rubric:** **35% estimated**: accounts/isolation evidence receives 4/15 for the verified local path (previously 0/15); other credits stay unchanged, including live/browser QA at 0/10. Production accounts remain a release gate.

Next: run browser QA in a browser-capable runtime, move isolated storage/session handling to production infrastructure, verify a real source, implement genuine chosen notification delivery and complete release testing.

## 2026-10-15 — Configurable Web Push path and account-switch protection

- Added optional per-Ping push delivery alongside the default silent inbox. Push is gated on operator VAPID configuration, account mode, an explicit browser-permission action and a saved device subscription; unavailable push cannot be selected as if connected.
- Added `web-push` for actual encrypted/VAPID-authenticated request generation, using a custom HTTPS transport with exact provider hosts, public DNS pinning, original-host TLS, a ten-second deadline and no redirects. No VAPID keys were generated/activated, no real provider was contacted and no notification was delivered to a real device.
- New inbox discoveries and push events persist in one transaction. The outbox survives restart, has bounded retry/backoff, removes retired endpoints and cancels stale events after pause, deletion, edits, silent preference, disconnect or session expiry. Inbox data survives failed notification delivery. Provider acceptance is explicitly distinct from confirmed device display.
- Added a service worker with generic lock-screen text, current-account checks and same-origin inbox navigation. It does not cache private pages. Signed-out, stale-account and offline events are suppressed rather than showing another account's notification.
- Added browser subscription controls, push status and safe account switching across tabs. Dashboard mutations and sign-out from stale account views are rejected by the server; cross-tab session changes refresh the mounted workspace.
- Resource bounds: five devices per account, 900 pending events plus 100 terminal history records, 24-hour job expiry, five send attempts and 20 sends per tick. Queue overflow is reported without evicting pending jobs or rolling back inbox discoveries. In-flight provider requests cannot be recalled; crash recovery uses at-least-once delivery and stable browser tags.

**Verification:** 11 new focused tests pass: silent/push opt-in and deduplication; durable retries/restart; permanent/retired endpoint failures; cancellation after pause/delete/edit/silent/disconnect; lease recovery; subscription/provider/key validation; real encryption and pinned request construction; real HTTP registration → subscription → Ping creation → actual RSS parser → inbox/outbox → injected provider acceptance; session/account ownership and expiry; stale-tab mutation/logout rejection; isolated worker privacy/navigation; retry exhaustion and queue bounds. Feed/provider network responses are injected. Complete-suite/build results are recorded at the final checkpoint below. Real browser subscription, live provider acceptance, device display, live RSS and hosted deployment remain unverified.

**Progress rubric:** **37% estimated**. Inbox/notification evidence increases from 5/15 to 7/15 for the tested durable/configurable path. Accounts/isolation stays at 4/15, dashboard at 11/15, sources at 3/15, persistence at 10/15, entitlements at 2/10, suggestions at 0/5 and live/browser/deployment at 0/10. No credit is assigned for a real push delivery or deployed production service.

**Final checkpoint verification:** the complete **64-test** Node suite passes, `npm run build` passes with Vite 5.4.21, and `git diff --check` passes. Tests ran on Node.js 24.19.0. No browser, live feed or actual push-provider/device success is claimed. Estimated release completion remains **37%**.

## 2026-10-15 — Private, reviewable interest learning controls

- Added opt-in interest learning driven only by explicit Useful / Not useful discovery feedback. Learning is off by default and never modifies a Ping's request, exact keyword, sources, folder or delivery.
- Added an account screen that shows the complete learned profile as useful/not-useful counts by keyword, folder and source, with controls to disable learning or erase it completely.
- Added account-scoped API controls and persisted profiles. Separate accounts cannot read or alter one another's learning preferences.
- The UI explicitly states that new suggested Pings will still require approval. No automatic Ping creation or criteria mutation was added.

**Verification:** the complete **65-test** Node suite passes, including opt-in behavior, feedback replacement, criteria immutability, reset and HTTP account isolation. `npm run build` passes with Vite 5.4.21 and `git diff --check` passes. Browser interaction, live sources, actual push delivery and deployment remain unverified.

**Progress rubric:** **39% estimated**. Suggestions/preference-controls evidence increases from 0/5 to 2/5 for the persisted, account-isolated review/reset path. No credit is claimed for generated suggestions because that feature is not implemented; all other rubric values remain unchanged.

Next: generate conservative reviewable suggestions without activating them, then verify the complete experience in a real browser and live-source environment.

## 2026-10-15 — Evidence-based suggestions with explicit approval

- Added conservative suggestion generation from repeated terms across at least two discoveries the user explicitly marked Useful. Existing Ping keywords, common filler words and one-off signals are excluded.
- Suggestions explain their evidence, are capped at five, and can be dismissed persistently. Dismissal and suggestion data remain account-scoped.
- Choosing Review idea only copies the proposed request into the existing review flow. It does not save, activate, change or consume an active-Ping slot; the user must still review sources and explicitly save or start it.
- No external AI, paid integration or unverified related-interest claim was introduced.

**Verification:** the complete **66-test** Node suite passes, including repeated-evidence thresholds, dismissal persistence, unchanged existing criteria and no automatic Ping creation. `npm run build` passes with Vite 5.4.21 and `git diff --check` passes. Browser interaction, live sources, actual device notification delivery and deployment remain unverified.

**Progress rubric:** **41% estimated**. Suggestions/preference-controls evidence increases from 2/5 to 4/5 for the generated, explainable, dismissible and approval-gated flow. No other rubric credit changes.

Next: prioritize real browser/live-source verification, production account infrastructure and deployed end-to-end QA.

## 2026-10-15 — Complete private account-data export

- Replaced the browser-drafts-only export with one JSON export containing active and paused Pings, exact criteria, source-check history, inbox discoveries, explicit feedback, learning preferences and browser-local saved ideas.
- The authenticated endpoint resolves the workspace from the server session and preserves account isolation. Cross-account export coverage verifies that one account cannot receive another account's Pings or inbox.
- Credentials, sessions, push subscriptions/endpoints, delivery jobs, deduplication history, activation revisions, failure counters and scheduler due times are deliberately excluded. Exporting does not mutate or pause monitoring.
- Updated the Account screen and privacy documentation to describe precisely what is and is not included.

**Verification:** the focused account/service suite passes with **16 tests**. The complete **67-test** Node suite passes, `npm run build` passes with Vite 5.4.21, and `git diff --check` passes. The hosted browser could not reach the loopback preview and timed out, so no browser interaction or visual QA is claimed. Live RSS, actual device notification display and deployment also remain unverified.

**Progress rubric:** **42% estimated**. Accounts, user isolation and production data controls increase from 4/15 to 5/15 for a tested, account-isolated user-data export. This remains local JSON storage and is not credited as production account infrastructure. All other rubric credits are unchanged, including live/browser/deployment at 0/10.

Next: browser QA in a runtime that can reach the preview, live supported-source verification, production account/storage/job infrastructure and real device-notification testing.
