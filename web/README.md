# Caseload Scheduler — web app

Open `index.html` in a browser (double-click, or serve this folder). No install, no Google account.

- **Workspace JSON** is the full file (settings, caseload, schedule). Auto-saved in `localStorage`; download/open anytime.
- **CSV** import/export per table (students, hours, grades, student blocks, schedule). Headers are listed on Import / export. CSV can **replace** a table or **merge** (students match by ID).
- **Generate schedule** runs the same engine as the Sheets build. **Undo generate** restores the previous schedule for this browser tab only.
- First visit starts empty. A short wizard walks hours → grade lunches → first student, or load the sample caseload.
- After generate: click a week block to lock, move the whole group to valid times only, or add/remove members. Coverage revalidates live (under/over alerts).
- **Print…** lets you choose times, teachers, group IDs, grade legend, coverage summary, compact layout, and week range.
- Students can belong to multiple named groups (comma-separated Group IDs).
- Individual students can be marked **No Group** to stay out of auto-grouping.
- Navigation is five screens: **Students** (caseload + per-student unavailable times), **Hours & grades**, **Week & coverage** (tabs: week, coverage, sessions, open slots), **Import / export**, **Settings**.

`engine.js` must sit next to `index.html`.
