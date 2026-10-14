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

## 2026-10-14 — RSS security foundation (follow-up)

- Added a server-owned registry with two **unverified** BBC RSS endpoint candidates; browser-provided URLs cannot be fetched.
- Updated the standalone monitor to enforce exact allowlisted HTTPS URLs, block redirects, cap streamed response size at 2 MB, reject unexpected MIME types and unsafe article link protocols, and validate keyword length.
- Added 9 mocked Node tests covering SSRF URL rejection, redirect blocking, RSS/Atom matching, deduplication, response errors and size limits.
- Existing UI and draft flow remain untouched. No feed was checked over the network, no backend scheduler or storage was activated and no results were delivered.
- Next: live verification of source endpoints in an approved network environment, then scheduled polling and durable per-alert discovery state.

**Verification:** 9 new Node tests passed locally with Node 22.16.0. The earlier 10-test suite was not re-run in this isolated workspace; full Vite build and browser QA remain unverified.
