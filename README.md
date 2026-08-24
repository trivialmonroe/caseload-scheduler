# Caseload Scheduler — Setup Guide

A Google Sheets + Apps Script tool for building a pull-out schedule from a caseload, a provider's availability, and each grade's daily schedule. Built for school-based service providers who see students on a recurring basis and need to work around grade schedules and their own limited windows — speech-language pathologists, OTs, PTs, reading interventionists, counselors, or anyone else scheduling pull-out sessions in a school setting. Nothing about the scheduling logic is speech-specific; "Students," "sessions," and "minutes" are generic enough to fit any of these caseloads.

## 1. Install
1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it something like "Caseload Scheduler."
2. Extensions → Apps Script.
3. Apps Script starts you with one file called `Code.gs`. Rename it: click the **⋮** menu next to it in the left sidebar → **Rename** → type `Constants` (the `.gs` is automatic). Delete its contents and paste in **Constants.gs** from this project.
4. Click the **+** next to Files → Script, and repeat for each remaining `.gs` file in this project (`Setup.gs`, `DataHelpers.gs`, `SchedulingEngine.gs`, `Outputs.gs`, `Interactive.gs`) — name each new file to match exactly, and paste in its contents. Apps Script treats every `.gs` file in a project as one shared global scope, so it doesn't matter which file a function lives in, or what order they're created in — this split is purely to keep the codebase navigable.
5. Click the **+** next to Files → HTML → name it exactly `StudentForm` → paste in **StudentForm.html**.
6. Save (Ctrl/Cmd+S). Close the Apps Script tab and go back to the Sheet.
7. Reload the spreadsheet. A new **Caseload Scheduler** menu will appear (takes a few seconds — reload again if it's not there).
8. Caseload Scheduler → **1. Set Up Sheets (run once)**. First run will ask you to authorize the script — that's normal, it's just running under your own account.

This creates 9 tabs. You'll fill in five of them (Students, Grades, Constraints, MyAvailability, Settings); the other four (Schedule_Log, Schedule_Review, Open_Slots, Printable_Schedule) are generated for you.

### What each file does
| File | Purpose |
|---|---|
| `Constants.gs` | Sheet names, colors, column widths/alignment - shared config, no logic |
| `Setup.gs` | Everything that runs during "Set Up Sheets": tab creation, validation, formatting, the Read Me tab |
| `DataHelpers.gs` | Pure helpers + sheet readers - time/day parsing, loading each input tab into plain objects |
| `SchedulingEngine.gs` | The actual algorithm - requirements, candidate slots, the main placement loop |
| `Outputs.gs` | Everything that writes a result back: Schedule_Log, Schedule_Review, Open_Slots, Printable_Schedule |
| `Interactive.gs` | User-triggered actions outside Generate Schedule: the sidebar form, live validation, Show Alternatives |
| `StudentForm.html` | The "Add / Edit Student" sidebar UI |
| `appsscript.json` | Standard Apps Script project manifest (only needed if you adopt `clasp` - see below) |

## 2. Entering days (applies to Grades, Constraints, and MyAvailability)
The "Day" column on all three of these tabs accepts more than just a single day, so you don't have to write out five rows for something that happens every day:

| What you type | What it means |
|---|---|
| `Mon` | Just Monday |
| `Mon-Fri` | Monday through Friday, inclusive |
| `Mon, Wed, Fri` | Just those three (commas, spaces optional) |
| `All` | Every school day configured in Settings |

The Start/End/Reason on that row apply identically to every day it expands to — so a daily lunch block is one row, not five.

## 3. Fill in `Grades`
One row per unavailable block, per grade. This is inherited by every student in that grade — you don't re-enter it per student.

| Grade | Day | Start Time | End Time | Reason |
|---|---|---|---|---|
| 2 | Mon-Fri | 11:30 AM | 12:15 PM | Lunch |
| 2 | Tue | 1:00 PM | 1:45 PM | Specials |
| K | Mon, Wed | 9:00 AM | 9:30 AM | Recess |

## 4. Fill in `MyAvailability`
Your open working windows — the times you're actually free to pull kids, already excluding your own lunch/planning/meetings.

| Day | Start Time | End Time | Week Pattern | Notes |
|---|---|---|---|---|
| Mon-Fri | 8:00 AM | 11:00 AM | | |
| Mon, Wed | 12:30 PM | 3:00 PM | | |
| Tue, Thu, Fri | 12:30 PM | 2:30 PM | | |

### Part-time / alternating (A/B) schedules
If you work a different pattern every other week — e.g. Mon-Tue one week, Mon-Tue-Wed the next — use the **Week Pattern** column:

| Day | Start | End | Week Pattern |
|---|---|---|---|
| Mon | 8:00 AM | 3:00 PM | *(blank)* |
| Tue | 8:00 AM | 3:00 PM | *(blank)* |
| Wed | 8:00 AM | 3:00 PM | B |

- Leave it blank for anything that applies every week — that's the default and fully backward-compatible; a normal full-time schedule never needs this column.
- Mark a row `A` or `B` for a day that only exists on alternating weeks.
- **Settings → Starting Week Pattern** decides whether Quarter Week 1 is an A-week or a B-week (default `A`); it alternates automatically from there across the whole quarter.
- **Weekly students** are only ever placed in slots that exist in *both* patterns — the scheduler intersects A and B availability before offering candidate slots, so a weekly-recurring student can never get silently scheduled into a week you don't actually work.
- If a student should genuinely only be seen every other week (not just "whenever there's room"), model them as **Quarterly** instead — Quarterly sessions are already pinned to specific quarter weeks, which is the right fit for a true every-other-week cadence.
- **Settings → Prefer Consistent Weekly Pattern** (default Yes) makes Quarterly students settle into the same day/time across weeks whenever possible — once a student lands on, say, Tuesday 9am, later occurrences prefer that same slot, so the routine is predictable for the provider, teachers, and the student rather than a different day/time every visit.
- **Settings → Front-Load First Sessions Into Weeks 1-2** (default Yes) gives every Quarterly student's *very first* session a strong push into Week 1 or 2 specifically, before the general algorithm even runs. It first tries an individual slot there; if none exists, it leans on grouping — joining an already-scheduled Week 1-2 session using the same rules as Automatic Group Rescue (duration tolerance + group size cap), so raw individual capacity isn't the hard ceiling on who gets front-loaded. Combined with the setting above, this means the first two weeks end up showing nearly the entire caseload starting their normal pattern — which is what makes the `Printable_Schedule` 2-week view actually representative of the whole quarter. It only falls through to a later week if *both* an individual slot and a compatible group are genuinely unavailable — and even then, it lands as early as possible rather than being left unscheduled. A real manually-created group is never split up or force-joined by someone else, exactly as with the general group rescue pass.

## 5. Fill in `Students`
Use the sheet rows directly for bulk entry, or **Caseload Scheduler → Add/Edit Student (form)** for one-offs — the form writes into this same sheet, and re-using the same Student ID updates that row instead of duplicating it.

- **Service Type**: `Individual` or `Group`
- **Group ID**: required for `Group` students — everyone in the group must share the same ID. The scheduler treats them as one shared session (so all group members must actually be free at the same time — grade blackouts and individual `Constraints` are checked for each member).
- **Frequency Type**: `Weekly` or `Quarterly` — see below, this changes which columns you fill in.
- **Sessions/Week (auto)**: informational only, filled in automatically.
- **Teacher** (optional): e.g. "Mrs. Lee - Rm 204" — so you know at a glance whose classroom to pull a student from. Shows up on `Schedule_Log` and `Printable_Schedule` whenever **Show Teacher on Schedule Outputs** (Settings tab, default Yes) is on. For a group, every member's distinct teacher is listed; if they all share one, it only shows once.
- **Fixed Day / Fixed Start Time** (optional): only fill this in if a student has a genuine external constraint requiring an exact day/time (e.g. tied to another provider's schedule). That exact slot gets booked first, before the flexible algorithm runs for anyone else. For a Quarterly student, every occurrence uses that same day/time; for a Weekly student needing more than one session/week, only the first is pinned and the rest stay flexible. Leave both blank for a normal, flexible placement — most students should never need this.

### Weekly students (e.g. "60 min/week")
Fill in **Minutes/Week Required**, and optionally **Preferred Session Length**.
- Leave Preferred Session Length blank and the scheduler auto-splits the week toward your configured **Max Session Length** (fewest pull-outs). Set a number if you want a specific target instead (still clamped to Min/Max).
- The result is **one session per day**, on that many different days, e.g. with Max = 60 / Min = 15: 60 min/week → 1×60; 90 min/week → 2×45; 100 min/week → 2×50.
- This same weekly pattern recurs identically every week.

### Quarterly students (e.g. "8 x 30-minute sessions per 9-week quarter")
This is the standard way IEP minutes are usually written, so it's treated as its own frequency type rather than converted to a weekly average. Fill in **Sessions Per Quarter** and **Session Length (Quarterly)** — these are used exactly as entered, not auto-split, since they're typically an exact mandated count.
- The scheduler tries to spread that count roughly one-per-week across the **Weeks Per Quarter** (Settings tab, default 9, matching a standard 9-week grading quarter) — it only doubles up in an already-used week once every other week is genuinely exhausted.
- One session per day still applies, but it's per *specific quarter week* — a quarterly student can land on a Tuesday in Week 1 and a different Tuesday in Week 2; those are different calendar days.
- **Limitation to know about**: `Grades` and `Constraints` blackout windows are assumed to repeat identically every week of the quarter (e.g. lunch is always at the same time on Tuesdays). If a grade's specials schedule itself rotates week to week, that's not modeled — you'd need to add rows for the busiest-case blackout.

### Min / Max Session Length + Quarter Length (Settings tab)
| Setting | Value |
|---|---|
| Min Session Length (min) | 15 |
| Max Session Length (min) | 60 |
| Weeks Per Quarter | 9 |

Weekly students' session lengths always fall within Min/Max. Quarterly students' fixed lengths bypass that (they're contractual), but you'll get a warning in `Schedule_Review` if a quarterly length falls outside the configured range, just as a sanity check. If a *weekly* student's minutes can't be delivered within one-session-per-day × max length × available school days, the scheduler still schedules what it can and adds a capacity warning rather than silently under-serving them.

If your district's IEPs are actually written against a different rotation (say, a 6-week or 12-week cycle instead of 9), just change **Weeks Per Quarter** — everything else adapts automatically.

## 6. Fill in `Constraints` (optional, per-student)
Anything specific to one kid beyond their grade's general schedule — e.g., they already have OT Tuesdays 10:00–10:30, or resource room every morning.

| Student ID | Day | Start Time | End Time | Reason |
|---|---|---|---|---|
| SMITHJ01 | Tue | 10:00 AM | 10:30 AM | OT |
| JONESM02 | Mon-Fri | 8:00 AM | 8:30 AM | Resource room |

## 7. Generate
**Caseload Scheduler → Generate Schedule.** This produces or refreshes:

- **`Schedule_Log`**: flat list of every placed session — the source of truth. Has a **Locked** column (see below).
- **`Schedule_Review`**: the compliance check in one place — one row per active student comparing required minutes against what actually got scheduled, sorted worst-served first. Weekly students are compared per week; Quarterly students per quarter. Rows highlight red if under, green if met or exceeded. A **Notes** column explains anything short (unplaced-session reasons and capacity warnings, deduplicated).
- **`Open_Slots`**: a diagnostic capacity map, regenerated automatically alongside the schedule (or on demand via **Caseload Scheduler → Show Open Slots by Grade**). For each grade — and each A/B week pattern, if you have a part-time/alternating schedule — it shows a color-coded grid of raw capacity, independent of any student bookings:
  - Green = genuinely open (you're working and that grade isn't blocked)
  - Grey = you're just not working then, regardless of grade
  - Red = you're working, but that grade's own schedule (lunch/recess/specials) blocks it

  A summary table at the top ranks every grade/pattern combo by total open minutes per week, worst-first — if a grade shows very little green, that's a structural capacity problem no scheduling algorithm can work around; it needs either more `MyAvailability` hours or fewer `Grades` blackouts for that grade, not a smarter scheduler.
- **`Printable_Schedule`**: a clean, shareable calendar view — colored blocks sized and positioned by each session's actual time, with the time range and teacher shown under each name. Build/refresh it any time via **Caseload Scheduler → Build Printable Schedule (2-Week View)** (it reads straight from `Schedule_Log`, so no need to re-run the full scheduler just to rebuild this view). Each grade gets a consistent, vibrant color with a legend at the top; group sessions collapse into one block showing every member's name. If you have any Quarterly students, this fast default only shows the first 2-week pair (Week 1 + 2) — with **Front-Load First Sessions** and **Prefer Consistent Weekly Pattern** both on (both default Yes, see below), that first pair should show nearly everyone's normal recurring pattern. If you want to see every actual week, **Caseload Scheduler → Build Printable Schedule (All Weeks)** instead renders every quarter-week as sequential 2-week blocks (Week 1+2, Week 3+4, ...) — slower since it's building several times as much content, so it's a separate, deliberate action rather than the default.

### Automatic Group Rescue
After the main pass, any Individual student still unscheduled gets checked against every already-scheduled session for a compatible bucket-mate (closest grade first) to see if they can simply join it. A host session can be slightly longer than what the joining student strictly needs — up to **Group Rescue Extra Minutes Allowed** (Settings, default 10) — so a student can get a few bonus minutes of playtime or be dismissed a bit early. Groups stop growing at **Max Students Per Auto-Group** (Settings, default 6). Auto-formed groups get a Group ID starting `AUTO-GROUP-` and highlight in light purple on `Schedule_Log`, so they're easy to spot and review for clinical fit — the algorithm only checks scheduling feasibility, not whether kids are a good therapeutic match. Manually-created groups are never touched by this.

## 8. Locking a session in place
Once you're happy with part of a generated schedule, mark those rows' **Locked** column (on `Schedule_Log`) as `Yes`. The next time you run Generate Schedule, every locked session gets booked at **exactly** its previous placement — before anything else — and only the remaining, unlocked need gets re-optimized around it. Small caseload changes no longer reshuffle a schedule you already reviewed and approved. Locked status carries forward automatically on every rebuild.

**Caseload Scheduler → Clear All Locks** resets every row back to unlocked in one step, if you ever want a full clean-slate re-optimization again.

### Do I need to run Clear Generated Schedule before Generate Schedule?
No — Generate Schedule already fully rewrites `Schedule_Log` on its own every time (fully respecting whatever's locked). **Clear Generated Schedule** is a separate, standalone "reset to blank" utility for when you want an empty state *without* immediately regenerating — e.g. pausing the process for a while, or just wanting a clean view for a screenshot. It **preserves locked rows** — clearing never silently undoes an approved decision. To wipe everything including locks, run **Clear All Locks** first, then **Clear Generated Schedule**.

## 9. Adjust manually
Click any row on `Schedule_Log`, then **Caseload Scheduler → Show Alternatives for Selected Row**. It recalculates open slots for that student (excluding their own current booking) against everything else already placed, and shows you up to 20 options. Manually edit the row's Day/Start/End in `Schedule_Log` to apply your pick, or delete the row and re-run Generate Schedule to let the algorithm re-place it. (For anything that never got scheduled at all, check `Schedule_Review`'s Notes column for why, and `Open_Slots` to check whether it's a fundamental capacity issue.)

`Schedule_Log` has a **Week** column ("Every Week" for weekly-recurring sessions, or "Week 2" etc. for quarterly ones) — this matters for Show Alternatives, since alternatives for a quarterly session are scoped to that one quarter week, not every week.

## How the algorithm decides order
It schedules the *most constrained* student/session first (the one with the fewest valid open slots), not just top-to-bottom — this avoids a common greedy-scheduling failure mode where an easy-to-place kid steals a slot that a tightly-constrained kid actually needed. When two sessions are equally constrained, the longer one goes first, so a short session can't grab a slot a longer one actually needed.

## Notes on scaling this up
- **Slot Increment** (Settings tab) controls the granularity the scheduler checks — 5 minutes is precise but slower; 15 minutes is faster for large caseloads.
- If you ever want the grid to run 6am–6pm or restrict school days, edit the `MyAvailability` rows — everything auto-sizes to whatever range you enter there.
- If a group's members have mismatched minutes/session lengths or mismatched frequency types, the scheduler uses the *first* member's numbers for the shared session — worth eyeballing `Schedule_Review`/`Schedule_Log` after a run if your groups aren't uniform.
- The tool doesn't currently enforce max-gap-between-sessions rules (e.g., "no more than 10 school days between sessions" for quarterly students) — only weekly minute/session totals. Worth a manual spot-check on IEP timing compliance for quarterly students whose sessions land unevenly across the quarter.

## Development
This project lives in git, but Apps Script itself has no native git integration — the workflow above (copy/paste into the web editor) is the zero-setup path and works fine for personal use.

### Standalone HTML (no Google account, no install)

For a fully self-contained version that runs in any browser without Google Sheets or clasp, open **`standalone/CaseloadScheduler.html`**. It embeds the same scheduling engine, preloads a sample caseload, and writes results to in-page Schedule Log / Schedule Review tables (data saved in your browser via localStorage). See the About tab inside the file for usage.

If you want real local-editor + git + Apps Script syncing, Google's [`clasp`](https://github.com/google/clasp) CLI is the standard tool: `npm install -g @google/clasp`, `clasp login`, `clasp clone <scriptId>` (or `clasp create` for a new project), then `clasp push`/`clasp pull` to sync this folder with the live Apps Script project. The included `appsscript.json` is clasp's expected manifest file — it's ignored by the plain copy/paste workflow, so you don't need to touch it unless you adopt clasp.

Every function in every `.gs` file shares one global scope (that's how Apps Script works — no imports/exports needed between files), so the six-file split is purely organizational. Reading `SchedulingEngine.gs` end to end is the fastest way to understand the actual algorithm; everything else is setup, I/O, or user-triggered actions around it.
