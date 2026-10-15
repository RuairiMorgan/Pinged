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
