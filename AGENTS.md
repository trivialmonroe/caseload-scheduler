# AGENTS.md

## Cursor Cloud specific instructions

This repo ships **two products** that share a scheduling algorithm:

| Product | Location | How to run |
|---------|----------|------------|
| **Web app (directional UI)** | `web/index.html` + `web/engine.js` | Open `web/index.html` or `python3 -m http.server` from repo root and visit `/web/` |
| **Google Sheets** | `apps-script/` | Copy `.gs` files into a bound Apps Script project (see root README) |

### Web app (preferred for local verification)

- No install. Keep `engine.js` next to `index.html`.
- First visit is an **empty workspace** (no auto-sample). A three-step wizard (hours → grade lunches → first student) plus **Load sample caseload** appears until those three exist. A stored empty workspace stays empty on reload.
- Click **Load sample caseload** or **Generate schedule**. Workspace auto-saves in `localStorage`. **Undo generate** restores the previous week in this tab only (not persisted).
- Five screens: Students, Hours & grades, Week & coverage (tabbed), Import / export, Settings. Student OT/resource blocks live on the student card, not a separate page. Day chips auto-save; times use `<input type="time">`.
- On the **week calendar**, drag a session onto a green cell to move the whole group, or onto an amber-outlined session to **swap** places when the week is full. Click a block to open the **session drawer** (members, move, swap). **Undo / Redo** (header or Ctrl/Cmd+Z) covers calendar edits; **Undo generate** is separate. Legend shows green move / amber swap / lock / Auto-group badges; **Compact calendar** toggles row density on screen.
- Coverage tab includes **Calendar** jump links to highlight a student’s session on the week view.
- **Print…** opens options (times, teachers, group IDs, legend, coverage summary, compact, all weeks).
- Group students may list **multiple Group IDs** (comma-separated). Auto-rescue can join compatible sessions even when peers already share a group, unless **No Group** is set.
- Import/export: full **workspace JSON**, a Google Sheet **.xlsx** workbook (Students, MyAvailability, Grades, Constraints, Settings, Schedule_Log — Apps Script column labels), multiple tab **CSVs**, or per-table CSV. CSV import can replace a table or merge by student ID.
- After caseload edits, a banner on Students / Hours / Schedule prompts regenerate. Generate confirms if `validateCaseload` reports issues.
- Individual students can be marked **No Group** so auto-group rescue / front-load joining never combines them with others.
- Feature set vs Sheets: generate, coverage, session log with locks, alternate times, open-slot grids, printable week view, student form, validate, A/B hours, weekly + quarterly, groups, auto-group rescue.
- Algorithm lives in `web/engine.js`. If you change placement rules, also update `apps-script/SchedulingEngine.gs` and `apps-script/DataHelpers.gs`.

### Google Apps Script version

- Sources moved to `apps-script/` (including `appsscript.json` and `StudentForm.html`).
- No package manager, build, or automated tests.
- `clasp` (optional) should run from `apps-script/`. Login is interactive, not headless.

`standalone/CaseloadScheduler.html` redirects to `web/index.html`.
