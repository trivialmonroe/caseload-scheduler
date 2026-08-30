# Caseload Scheduler — Google Sheets / Apps Script

This folder is the original product: a Google Sheet with Apps Script.

## Use it

Follow the copy-paste install in the root `README.md` (Create a Sheet → Extensions → Apps Script → paste each `.gs` file plus `StudentForm.html`).

If you use [clasp](https://github.com/google/clasp), point it at this folder (`clasp push` from `apps-script/` with `appsscript.json`).

## Relationship to the web app

`../web/` is a standalone browser app with the same scheduling engine, rebuilt as the primary UI (calendar drag-and-drop, coverage, CSV/JSON files). Keep algorithm changes in sync between `SchedulingEngine.gs` / `DataHelpers.gs` and `../web/engine.js` when you change placement behavior.

## Session editing (Sheets parity)

`SessionEditing.gs` adds web-style session tools via the **Caseload Scheduler** menu:

| Menu item | Web equivalent |
|-----------|----------------|
| Refresh Coverage from Schedule_Log | Live coverage after log edits |
| Show Alternatives for Selected Row | Session drawer → move chips (diverse slots) |
| Move Selected Session to Alternative | Drag session to green cell |
| Show / Apply Swap | Session drawer → swap |
| Add Student to Selected Session | Session drawer → add member |

Day/week labels on Schedule_Log are normalized (`Tuesday` → `Tue`, `week 1` → `Week 1`) for printable schedule and coverage, matching the web calendar fix.

Service types **Walk in** and custom **Other** are allowed on the Students sheet (grade blocks optional — no validation failure).
