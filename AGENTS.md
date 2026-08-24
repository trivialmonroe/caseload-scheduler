# AGENTS.md

## Cursor Cloud specific instructions

This repo is the **Caseload Scheduler**. There are two ways to use it:

| Mode | Location | Runtime |
|------|----------|---------|
| **Standalone (no install)** | `standalone/CaseloadScheduler.html` | Any modern browser — open the file directly or serve it statically |
| **Google Sheets + Apps Script** | Root `.gs` files | Google account + bound Sheet (see `README.md`) |

### Standalone HTML (preferred for local verification)

- **No install, no server required** — double-click `standalone/CaseloadScheduler.html` or open it from the browser File menu.
- Optional: `python3 -m http.server 8765` then visit `http://127.0.0.1:8765/standalone/CaseloadScheduler.html`.
- Click **Load sample caseload** → **Generate Schedule**. Data persists in `localStorage`.
- The embedded JS is a port of the same scheduling algorithm from `SchedulingEngine.gs` / `DataHelpers.gs` (most-constrained-first, group rescue, front-loading, A/B patterns). Output tabs: Schedule Log, Schedule Review.
- **Not ported** (Sheets-only or deferred): printable calendar grid, open-slots diagnostic heatmap, sidebar HTML form, sheet setup/formatting. The standalone file is intentionally streamlined.

When changing scheduling logic, update **both** the `.gs` sources and `standalone/CaseloadScheduler.html` (or extract shared logic later).

### Google Apps Script version

- No package manager, build, lint, or automated tests in repo.
- All `.gs` files share one global scope; `SchedulingEngine.gs` is the algorithm.
- Optional deploy: `clasp` CLI needs interactive `clasp login` (not headless).

### Node harness (optional)

If `dev/run-engine.js` exists on your branch, it runs the `.gs` sources in Node with stubbed `SpreadsheetApp` — useful for CI-style checks without a browser. The standalone HTML supersedes it for human demos when no Node setup is desired.
