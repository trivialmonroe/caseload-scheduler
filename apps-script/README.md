# Caseload Scheduler — Google Sheets / Apps Script

This folder is the original product: a Google Sheet with Apps Script.

## Use it

Follow the copy-paste install in the root `README.md` (Create a Sheet → Extensions → Apps Script → paste each `.gs` file plus `StudentForm.html`).

If you use [clasp](https://github.com/google/clasp), point it at this folder (`clasp push` from `apps-script/` with `appsscript.json`).

## Relationship to the web app

`../web/` is a standalone browser app with the same scheduling engine, rebuilt as the primary UI (calendar, coverage, CSV/JSON files). Keep algorithm changes in sync between `SchedulingEngine.gs` / `DataHelpers.gs` and `../web/engine.js` when you change placement behavior.
