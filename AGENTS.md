# AGENTS.md

## Cursor Cloud specific instructions

This repo ships **two products** that share a scheduling algorithm:

| Product | Location | How to run |
|---------|----------|------------|
| **Web app (directional UI)** | `web/index.html` + `web/engine.js` | Open `web/index.html` or `python3 -m http.server` from repo root and visit `/web/` |
| **Google Sheets** | `apps-script/` | Copy `.gs` files into a bound Apps Script project (see root README) |

### Web app (preferred for local verification)

- No install. Keep `engine.js` next to `index.html`.
- Click **Load sample caseload** (empty state) or **Generate schedule**. Workspace auto-saves in `localStorage`.
- Import/export: full **workspace JSON**, or per-table **CSV** (students, hours, grades, blocks, schedule).
- Feature set vs Sheets: generate, coverage, session log with locks, alternate times, open-slot grids, printable week view, student form, validate, A/B hours, weekly + quarterly, groups, auto-group rescue.
- Algorithm lives in `web/engine.js`. If you change placement rules, also update `apps-script/SchedulingEngine.gs` and `apps-script/DataHelpers.gs`.

### Google Apps Script version

- Sources moved to `apps-script/` (including `appsscript.json` and `StudentForm.html`).
- No package manager, build, or automated tests.
- `clasp` (optional) should run from `apps-script/`. Login is interactive, not headless.

`standalone/CaseloadScheduler.html` redirects to `web/index.html`.
