# Pinged

Pinged is a personal monitoring and discovery product: describe something you care about, choose suggested sources, and eventually receive verified, deduplicated discoveries. The visual direction is a minimal, accessible, Apple-inspired interface with Ocean Teal `#007F86`.

## Current status — prototype, **not** a live monitoring service

- The responsive Home / Inbox / Account UI is a local preview.
- Natural-language requests are parsed by a basic **rule-based** planner (`src/searchPlanner.js`). It is not an AI agent.
- Source recommendations are **candidates**, not verified working integrations. RSS candidates still require feed verification, a backend, and scheduled checks.
- Users can review source choices and save/edit/remove alert **drafts**. Drafts are stored only in the current browser's `localStorage` and can be exported as JSON.
- Inbox intentionally shows no fabricated results. **No** monitoring jobs, accounts, cloud sync, email/push notifications, billing, or public deployment are connected.
- Older URL-and-keyword prototype alerts are migrated into clearly labeled drafts. An old `enabled` flag does **not** mean a monitor is running.
- `server/monitor.mjs` contains a standalone RSS/Atom parser and keyword matcher. It is **not** wired to the UI or scheduler. It must only fetch allowlisted URLs; arbitrary URLs would introduce SSRF risk.

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
2. **Real monitoring:** vetted source connector contracts, verified RSS feed allowlist, server-side scheduling, persistence, deduplication, rate limits, audit trails and reliable failure reporting.
3. **Accounts and notifications:** authenticated storage, email/in-app delivery, per-alert notification preferences, privacy and security controls.
4. **Quality and launch readiness:** end-to-end tests, error handling, deployment/observability, cost monitoring, accessibility checks and owner-approved launch.

Do not claim a successful check, a connected source, a verified discovery, or a notification until the relevant backend action has actually succeeded. Do not spend money, enable paid services, set prices or publicly deploy without owner approval.
