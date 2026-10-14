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
