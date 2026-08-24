# AGENTS.md

## Cursor Cloud specific instructions

This repo is the **Caseload Scheduler**, a **Google Apps Script (GAS)** project — plain V8
JavaScript (`.gs` files) that runs only inside Google's hosted Apps Script runtime bound to a
Google Sheet. See `README.md` for the full product overview and end-user setup.

Key facts that are non-obvious for a dev/CI environment:

- **No package manager, build, lint, or test framework.** There is no `package.json`, no lockfile,
  no bundler/transpiler, and no automated test suite. There is nothing to "install" for the
  project itself; the only runtime dependency is Node (preinstalled), used solely by the local
  harness below.
- **All `.gs` files share one global scope** (that's how Apps Script works — no imports/exports).
  The file split is purely organizational; `SchedulingEngine.gs` is the actual algorithm.
- **The real product cannot run headlessly.** Actually running it requires deploying the code into
  an Apps Script project bound to a Google Sheet and clicking the `Caseload Scheduler` menu, which
  needs interactive Google OAuth. Do not expect to launch a local server or hit an endpoint.

### Running / verifying the engine locally (no Google account needed)

Because the `.gs` files are plain JS, the core scheduling algorithm can be exercised locally by
stubbing the Google-only globals. Use the committed harness:

```
node dev/run-engine.js
```

It loads the unmodified `.gs` sources, fakes `SpreadsheetApp` with an in-memory spreadsheet, seeds
the sample caseload from `README.md`, runs the real `generateSchedule()` entry point, and prints
the generated `Schedule_Log` and `Schedule_Review`. This is the fastest way to sanity-check a
change to `SchedulingEngine.gs` / `DataHelpers.gs` / `Outputs.gs` without touching Google. The
harness only reads the source files; it never modifies them. Edit the `seed()` function in
`dev/run-engine.js` to try other caseloads.

The fake only implements the small surface the engine touches (sheet reads/writes); all other
chained formatting calls are no-ops. If you add engine code that depends on a new Apps Script API,
you may need to extend the fake in `dev/run-engine.js`.

### Deploying to real Google Apps Script (optional, needs interactive login)

The documented workflow uses Google's `clasp` CLI (see `README.md` → Development). It is not
required for local engine verification and is intentionally not part of the automatic environment
setup because `clasp login` needs an interactive Google OAuth browser flow that can't run
headlessly. If you need it: `npm install -g @google/clasp`, `clasp login`, then `clasp push` /
`clasp pull` against a bound script project.
