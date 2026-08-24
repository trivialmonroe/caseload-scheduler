# Caseload Scheduler — web app

Open `index.html` in a browser (double-click, or serve this folder). No install, no Google account.

- **Workspace JSON** is the full file (settings, caseload, schedule). Auto-saved in `localStorage`; download/open anytime.
- **CSV** import/export per table (students, hours, grades, student blocks, schedule). Headers are listed on Import / export. CSV can **replace** a table or **merge** (students match by ID).
- **Generate schedule** runs the same engine as the Sheets build.
- Navigation is five screens: **Students** (caseload + per-student unavailable times), **Hours & grades**, **Week & coverage** (tabs: week, coverage, sessions, open slots), **Import / export**, **Settings**.

`engine.js` must sit next to `index.html`.
