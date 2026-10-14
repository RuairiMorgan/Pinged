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
