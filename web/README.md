# Caseload Scheduler — web app

Open `index.html` in a browser (double-click, or serve this folder). No install, no Google account.

- **Workspace JSON** is the full file (settings, caseload, schedule). Auto-saved in `localStorage`; download/open anytime.
- **Import** workspace JSON, a full Google Sheet **.xlsx** export (Apps Script tab names and headers), multiple CSVs at once, or one CSV table. **Export** JSON or per-table CSV.
- **Generate schedule** runs the same engine as the Sheets build. **Undo generate** restores the previous schedule; **Undo / Redo** (Ctrl/Cmd+Z) covers calendar edits in this tab.
- First visit starts empty. A short wizard walks hours → grade lunches → first student, or load the sample caseload.
- After generate: on the **week calendar**, drag sessions onto green cells to move, or onto amber-outlined sessions to **swap** when the schedule is full. Click a block for the session drawer (lock, members, move, swap). Coverage is a report tab with **Calendar** jump links; edits happen on the calendar. Coverage revalidates live (under/over alerts).
- **Print…** lets you choose times, teachers, group IDs, grade legend, coverage summary, compact layout, and week range.
- Students can belong to multiple named groups (comma-separated Group IDs).
- Individual students can be marked **No Group** to stay out of auto-grouping.
- Navigation is five screens: **Students** (caseload + per-student unavailable times), **Hours & grades**, **Week & coverage** (tabs: week, coverage, sessions, open slots), **Import / export**, **Settings**.

`engine.js` must sit next to `index.html`.
