/**
 * Sheet creation, formatting, validation, and the Read Me tab builder.
 * Everything here runs during "1. Set Up Sheets" or supports it.
 */

function applyColumnLayout(ss) {
  Object.keys(COLUMN_LAYOUT).forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const layout = COLUMN_LAYOUT[name];
    const maxRows = Math.max(sheet.getMaxRows(), 1000);
    layout.forEach((col, idx) => {
      const colIndex = idx + 1;
      sheet.setColumnWidth(colIndex, col.width);
      sheet.getRange(1, colIndex, maxRows, 1).setHorizontalAlignment(col.align);
    });
    sheet.getRange(1, 1, 1, layout.length).setHorizontalAlignment('center');
  });
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Caseload Scheduler')
    .addItem('1. Set Up Sheets (run once)', 'setupSheets')
    .addSeparator()
    .addItem('Add / Edit Student (form)', 'showStudentSidebar')
    .addItem('Validate Data', 'validateData')
    .addSeparator()
    .addItem('Generate Schedule', 'generateSchedule')
    .addItem('Refresh Coverage from Schedule_Log', 'refreshCoverageFromLog')
    .addSeparator()
    .addItem('Show Alternatives for Selected Row', 'showAlternativesForSelection')
    .addItem('Move Selected Session to Alternative', 'moveSelectedSessionToAlternative')
    .addItem('Show Swap Candidates for Selected Row', 'showSwapCandidatesForSelection')
    .addItem('Apply Swap for Selected Session', 'applySwapForSelectedSession')
    .addItem('Add Student to Selected Session', 'addStudentToSelectedSession')
    .addSeparator()
    .addItem('Build Printable Schedule (2-Week View)', 'writeVisualSchedule')
    .addItem('Build Printable Schedule (All Weeks)', 'writeVisualScheduleAllWeeks')
    .addItem('Show Open Slots by Grade (diagnostic)', 'writeOpenSlotsGrid')
    .addSeparator()
    .addItem('Clear Generated Schedule', 'clearSchedule')
    .addItem('Clear All Locks', 'clearAllLocks')
    .addToUi();
}

function ensureDefaultSettings(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  const defaults = [
    ['Slot Increment (min)', 5],
    ['School Days', 'Mon,Tue,Wed,Thu,Fri'],
    ['Min Session Length (min)', 15],
    ['Max Session Length (min)', 60],
    ['Weeks Per Quarter', 9],
    ['Starting Week Pattern (A/B)', 'A'],
    ['Group Rescue Extra Minutes Allowed', 10],
    ['Max Students Per Auto-Group', 6],
    ['Prefer Consistent Weekly Pattern (Yes/No)', 'Yes'],
    ['Show Teacher on Schedule Outputs (Yes/No)', 'Yes'],
    ['Front-Load First Sessions Into Weeks 1-2 (Yes/No)', 'Yes']
  ];
  const existingKeys = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim())
    : [];
  const missing = defaults.filter(([key]) => existingKeys.indexOf(key) === -1);
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
  }
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const defs = {
    [SHEET_NAMES.STUDENTS]: ['Student ID', 'First Name', 'Last Name', 'Grade',
      'Service Type (Individual/Group)', 'Group ID (comma-separate multiple)',
      'Frequency Type (Weekly/Quarterly)',
      'Minutes/Week Required (Weekly only)',
      'Preferred Session Length (min, optional, Weekly only)',
      'Sessions Per Quarter (Quarterly only)',
      'Session Length (min, Quarterly only)',
      'Sessions/Week (auto, informational)', 'Notes', 'Status (Active/Inactive)', 'Teacher',
      'Fixed Day (optional)', 'Fixed Start Time (optional, HH:MM)', 'No Group (Yes/No)'],
    [SHEET_NAMES.GRADES]: ['Grade', "Day (single, 'Mon-Fri' range, comma list, or 'All')", 'Start Time (HH:MM)', 'End Time (HH:MM)', 'Reason'],
    [SHEET_NAMES.CONSTRAINTS]: ['Student ID', "Day (single, 'Mon-Fri' range, comma list, or 'All')", 'Start Time (HH:MM)', 'End Time (HH:MM)', 'Reason'],
    [SHEET_NAMES.AVAILABILITY]: ["Day (single, 'Mon-Fri' range, comma list, or 'All')", 'Start Time (HH:MM)', 'End Time (HH:MM)', "Week Pattern (optional: A, B, or blank for every week)", 'Notes'],
    [SHEET_NAMES.SETTINGS]: ['Setting', 'Value'],
    [SHEET_NAMES.LOG]: ['Student ID', 'Name', 'Grade', 'Group ID', 'Week', 'Day', 'Start Time', 'End Time', 'Duration (min)', 'Teacher', 'Locked (Yes/No)'],
    [SHEET_NAMES.OPENSLOTS]: [],
    [SHEET_NAMES.VISUAL]: [],
    [SHEET_NAMES.REVIEW]: []
  };

  const inputTabs = [SHEET_NAMES.STUDENTS, SHEET_NAMES.GRADES, SHEET_NAMES.CONSTRAINTS, SHEET_NAMES.AVAILABILITY, SHEET_NAMES.SETTINGS];
  const outputTabs = [SHEET_NAMES.LOG, SHEET_NAMES.OPENSLOTS, SHEET_NAMES.VISUAL, SHEET_NAMES.REVIEW];

  Object.keys(defs).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = defs[name];
    if (headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#434343').setFontColor('#ffffff').setWrap(true);
      sheet.setFrozenRows(1);
    }
    if (inputTabs.indexOf(name) !== -1) sheet.setTabColor(INPUT_TAB_COLOR);
    if (outputTabs.indexOf(name) !== -1) sheet.setTabColor(OUTPUT_TAB_COLOR);
  });

  ensureDefaultSettings(ss);

  applyColumnLayout(ss);
  applyStudentValidation(ss);
  applyConditionalFormatting(ss);
  applyRowBanding(ss, inputTabs);
  buildReadMeSheet(ss);

  // Put Read Me first, tabs in a sensible left-to-right order after it
  const order = [SHEET_NAMES.README, SHEET_NAMES.STUDENTS, SHEET_NAMES.GRADES, SHEET_NAMES.CONSTRAINTS,
    SHEET_NAMES.AVAILABILITY, SHEET_NAMES.SETTINGS, SHEET_NAMES.LOG, SHEET_NAMES.REVIEW, SHEET_NAMES.OPENSLOTS, SHEET_NAMES.VISUAL];
  order.forEach((name, idx) => {
    const sheet = ss.getSheetByName(name);
    if (sheet) { ss.setActiveSheet(sheet); ss.moveActiveSheet(idx + 1); }
  });
  ss.setActiveSheet(ss.getSheetByName(SHEET_NAMES.README));

  ss.toast('Sheets set up. Start on the Read Me tab, then fill in Grades, MyAvailability, and Students.', 'Setup complete', 8);
}

function applyStudentValidation(ss) {
  const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
  const maxRows = 999;

  const serviceRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Individual', 'Group', 'Walk in', 'Other'], true)
    .setAllowInvalid(true).build();
  const freqRule = SpreadsheetApp.newDataValidation().requireValueInList(['Weekly', 'Quarterly'], true).setAllowInvalid(false).build();
  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(['Active', 'Inactive'], true).setAllowInvalid(false).build();

  studentsSheet.getRange(2, 5, maxRows, 1).setDataValidation(serviceRule);  // E: Service Type
  studentsSheet.getRange(2, 7, maxRows, 1).setDataValidation(freqRule);     // G: Frequency Type
  studentsSheet.getRange(2, 14, maxRows, 1).setDataValidation(statusRule); // N: Status

  // Week Pattern (A/B/blank) is easy to typo since it's less obviously a fixed
  // set of choices than the Students dropdowns above - a blank cell is still
  // allowed (it means "every week"), the dropdown just prevents stray text.
  const availabilitySheet = ss.getSheetByName(SHEET_NAMES.AVAILABILITY);
  const patternRule = SpreadsheetApp.newDataValidation().requireValueInList(['A', 'B'], true).setAllowInvalid(true).build();
  availabilitySheet.getRange(2, 4, maxRows, 1).setDataValidation(patternRule); // D: Week Pattern

  // Fixed Day (optional) - blank allowed, same reasoning as Week Pattern above.
  const dayRule = SpreadsheetApp.newDataValidation().requireValueInList(DAYS, true).setAllowInvalid(true).build();
  studentsSheet.getRange(2, 16, maxRows, 1).setDataValidation(dayRule); // P: Fixed Day

  const noGroupRule = SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).setAllowInvalid(true).build();
  studentsSheet.getRange(2, 18, maxRows, 1).setDataValidation(noGroupRule); // R: No Group

  // Locked (Yes/No) on Schedule_Log - blank means unlocked, same as the others.
  const logSheet = ss.getSheetByName(SHEET_NAMES.LOG);
  const lockedRule = SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).setAllowInvalid(true).build();
  logSheet.getRange(2, 11, maxRows, 1).setDataValidation(lockedRule); // K: Locked
}

function applyConditionalFormatting(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
  const maxRows = 999;
  const greyOut = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$G2="Quarterly"')
    .setBackground('#f3f3f3').setFontColor('#b7b7b7')
    .setRanges([sheet.getRange(2, 8, maxRows, 2)]) // H:I - Weekly-only fields
    .build();
  const greyOutQuarterly = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$G2="Weekly"')
    .setBackground('#f3f3f3').setFontColor('#b7b7b7')
    .setRanges([sheet.getRange(2, 10, maxRows, 2)]) // J:K - Quarterly-only fields
    .build();
  sheet.setConditionalFormatRules([greyOut, greyOutQuarterly]);
}

function applyRowBanding(ss, tabNames) {
  tabNames.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet.getBandings().length > 0) return; // already banded, don't double up
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    try {
      sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 200), lastCol)
        .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
    } catch (e) { /* banding can fail on already-formatted ranges; safe to skip */ }
  });
}

function buildReadMeSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.README);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.README);
  sheet.clear();
  sheet.setTabColor(README_TAB_COLOR);
  sheet.setHiddenGridlines(true);

  let row = 1;
  const setTitle = (text, size) => {
    sheet.getRange(row, 1).setValue(text).setFontWeight('bold').setFontSize(size || 14);
    row++;
  };
  const setBody = (text) => {
    sheet.getRange(row, 1).setValue(text).setWrap(true);
    row++;
  };
  const blank = () => { row++; };

  setTitle('Caseload Scheduler', 20);
  setBody('Builds a weekly + quarterly pull-out schedule from your caseload, your availability, and each grade\'s daily schedule.');
  blank();

  // Live status box
  sheet.getRange(row, 1, 1, 2).merge().setValue('STATUS').setFontWeight('bold').setBackground('#434343').setFontColor('#ffffff');
  row++;
  const statusStartRow = row;
  sheet.getRange(row, 1).setValue('Last Generated:').setFontWeight('bold');
  sheet.getRange(row, 2).setValue('(not yet run)');
  row++;
  sheet.getRange(row, 1).setValue('Sessions Scheduled:').setFontWeight('bold');
  sheet.getRange(row, 2).setValue('-');
  row++;
  sheet.getRange(row, 1).setValue('Sessions Unplaced:').setFontWeight('bold');
  sheet.getRange(row, 2).setValue('-');
  row++;
  sheet.getRange(row, 1).setValue('Students Auto-Grouped:').setFontWeight('bold');
  sheet.getRange(row, 2).setValue('-');
  row++;
  sheet.getRange(statusStartRow, 1, 4, 2).setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
  blank();

  setTitle('Quick Start', 14);
  const steps = [
    '1. Fill in Grades - one row per grade-wide blackout (lunch, recess, specials). Use Mon, Mon-Fri, Mon-Wed-Fri, or All in the Day column.',
    '2. Fill in MyAvailability - your open working blocks by day.',
    '3. Fill in Students - one row per student. Use the sidebar form (Caseload Scheduler menu) or type directly into the sheet; dropdowns keep Service Type, Frequency Type, and Status typo-proof.',
    '4. Optionally fill in Constraints for anything specific to one student beyond their grade\'s schedule (e.g. existing OT/resource room times).',
    '5. Run Caseload Scheduler > Validate Data to catch mistakes before generating.',
    '6. Run Caseload Scheduler > Generate Schedule. Check Schedule_Review for anything under its required minutes, and Printable_Schedule for the visual layout.',
    '7. After manual edits on Schedule_Log, run Refresh Coverage from Schedule_Log to update minutes without regenerating.',
    '8. Select a Schedule_Log row to move, swap, or add a student via the Caseload Scheduler menu (parity with the web session drawer).'
  ];
  steps.forEach(s => setBody(s));
  blank();

  setTitle('Tab Guide', 14);
  const tabGuide = [
    ['Students', 'Your caseload database. One row per student or group member. Includes an optional Teacher field for knowing where to pull a student from.'],
    ['Grades', 'Default unavailable windows per grade - inherited by every student in that grade.'],
    ['Constraints', 'Student-specific unavailable windows (other services, pull-outs) layered on top of Grades.'],
    ['MyAvailability', 'Your own open working blocks by day - the only source of when YOU can see students.'],
    ['Settings', 'Slot increment, school days, min/max session length, and how many weeks are in a quarter.'],
    ['Schedule_Log', 'Generated - flat list of every scheduled session. The source of truth - mark a row\'s Locked column "Yes" to keep it exactly as-is on future runs.'],
    ['Schedule_Review', 'Generated - one row per active student: required vs. actually-scheduled minutes (worst-served first), plus a Notes column explaining anything short. Red = under, green = met or over. This is the IEP-compliance check in one place.'],
    ['Printable_Schedule', 'Generated - clean calendar view for sharing/printing, colored blocks sized to each session\'s actual time, with the time and teacher shown under each name. "Build Printable Schedule (2-Week View)" shows just the first 2 quarter-weeks (fast); "Build Printable Schedule (All Weeks)" shows every quarter-week as sequential 2-week blocks (slower, shows every actual A/B permutation).'],
    ['Open_Slots', 'Generated diagnostic - green/grey/red capacity map per grade & A/B pattern, independent of student bookings. Run "Show Open Slots by Grade" if you need to check whether a grade is fundamentally under-resourced.']
  ];
  tabGuide.forEach(([name, desc]) => {
    sheet.getRange(row, 1).setValue(name).setFontWeight('bold');
    sheet.getRange(row, 2).setValue(desc).setWrap(true);
    row++;
  });
  blank();

  setTitle('Weekly vs. Quarterly', 14);
  setBody('Weekly: give total Minutes/Week. The scheduler auto-splits into one session/day (length between Settings Min/Max) and repeats that pattern every week.');
  setBody('Quarterly: give an exact Sessions Per Quarter and Session Length (the way IEP minutes are usually written, e.g. "8 x 30-min sessions"). These are used exactly as entered and spread evenly across the Weeks Per Quarter setting (default 9).');
  blank();

  setTitle('Day Column Shorthand', 14);
  setBody('Grades, Constraints, and MyAvailability all accept: a single day (Mon), a range (Mon-Fri), a comma list (Mon, Wed, Fri), or All - instead of one row per day.');
  blank();

  setTitle('Part-Time / Alternating Schedules', 14);
  setBody('If you work a different pattern every other week (e.g. Mon-Tue one week, Mon-Tue-Wed the next), use the Week Pattern column on MyAvailability: leave it blank for days that apply every week, and mark "A" or "B" for days that only apply on alternating weeks. The Settings tab\'s "Starting Week Pattern" decides whether Quarter Week 1 is an A-week or a B-week; it alternates automatically from there. Weekly students only get placed in slots that exist in BOTH patterns (so they are never accidentally scheduled into a week they don\'t work) - if a student should truly only be seen every other week, model them as Quarterly instead, since Quarterly sessions are already pinned to specific weeks.');
  blank();

  setTitle('Consistent Weekly Pattern', 14);
  setBody('Weekly students already land on the exact same day/time every single week, by construction - there\'s nothing to configure. Quarterly students are different: each of their sessions gets placed independently, so with "Prefer Consistent Weekly Pattern" ON (Settings tab, default Yes), once a Quarterly student\'s first session lands on, say, Tuesday at 9am, later sessions in other weeks will preferentially reuse that same day and time whenever it\'s available - so the provider, teachers, and the student settle into a predictable "always Tuesday" cadence instead of a different day/time every visit. Turn it off if you\'d rather the scheduler optimize purely for fitting everyone in, with no preference for repetition.');
  blank();

  setTitle('Front-Loading First Sessions', 14);
  setBody('With "Front-Load First Sessions Into Weeks 1-2" ON (Settings tab, default Yes), every Quarterly student\'s VERY FIRST session gets a strong push into Week 1 or 2 specifically, before the general algorithm even runs. It first tries an individual slot there; if none exists, it leans on grouping - joining an already-scheduled Week 1-2 session using the exact same rules as Automatic Group Rescue below (duration tolerance + group size cap), so raw individual capacity in weeks 1-2 isn\'t the hard ceiling. Combined with Consistent Weekly Pattern above, this means the first two weeks end up showing nearly everyone on the caseload starting their normal recurring pattern - which is exactly what the Printable_Schedule 2-week view is trying to represent. It only ever falls through to a later week if BOTH an individual slot and a compatible group are genuinely unavailable in weeks 1-2 - and even then, only far enough to still get that student scheduled, never leaving anyone out over it. A real manually-created group is never split up or force-joined by someone else, same as everywhere else in this tool.');
  blank();

  setTitle('Automatic Group Rescue', 14);
  setBody('After the main pass, any Individual student still unscheduled gets checked against every already-scheduled session for a compatible bucket-mate (closest grade first) to see if they can simply join it. A host session can be slightly longer than what the joining student strictly needs - up to "Group Rescue Extra Minutes Allowed" (Settings tab, default 10) - so a student can get a few bonus minutes of playtime or be dismissed a bit early within a session built for someone else\'s slightly longer need. Groups stop growing once they hit "Max Students Per Auto-Group" (Settings tab, default 6). Auto-formed groups get a Group ID starting "AUTO-GROUP-" and show up highlighted in light purple on Schedule_Log, so they\'re easy to spot and review for clinical fit - the algorithm only checks scheduling feasibility, not whether kids are a good therapeutic match. Manually-created groups from the Students sheet are never touched by this or counted against the cap. Set No Group = Yes on an Individual student to keep them out of auto-grouping entirely (they will not join another session, and nobody will join theirs via rescue).');
  blank();

  setTitle('Teacher Info', 14);
  setBody('Students has an optional Teacher column (e.g. "Mrs. Lee - Rm 204") so you know at a glance whose classroom to pull a student from, or return them to. With "Show Teacher on Schedule Outputs" ON (Settings tab, default Yes), it shows up on Schedule_Log, Printable_Schedule, and the Printable Schedule Doc. For a group session, every member\'s distinct teacher is listed - if they all share one teacher, it only shows once.');
  blank();

  setTitle('Fixed Day / Time', 14);
  setBody('If a student MUST be seen at a specific day and time (an external constraint you don\'t control), set Fixed Day and Fixed Start Time on their Students row. That exact slot gets booked first, before the flexible algorithm runs for anyone else - so it always wins over optimization. For a Quarterly student, every occurrence uses that same day/time, spread across different weeks as usual. For a Weekly student needing more than one session/week, only the first is pinned; the rest stay flexible. If the exact slot genuinely isn\'t available (a conflict with availability, a blackout, or a locked booking), that session shows up in Unscheduled with a clear reason instead of silently landing somewhere else.');
  blank();

  setTitle('Locking a Session In Place', 14);
  setBody('Once you\'re happy with part of a generated schedule, mark those rows\' Locked column (on Schedule_Log) as "Yes." The next time you run Generate Schedule, every locked session gets booked at EXACTLY its previous placement - before anything else - and only the remaining, unlocked need gets re-optimized around it. This means small caseload changes no longer reshuffle a schedule you already reviewed and approved. Locked status carries forward automatically on every rebuild, so once you mark something locked, it stays locked until you clear it. Caseload Scheduler > Clear All Locks resets every row back to unlocked in one step, if you ever want a full clean-slate re-optimization again.');
  blank();

  setTitle('Known Limitations', 14);
  setBody('- Grades/Constraints blackouts repeat identically every week of the quarter (a grade\'s specials schedule can\'t itself rotate week to week).');
  setBody('- No max-gap-between-sessions enforcement for Quarterly students - worth a manual spot check against IEP timing language.');
  setBody('- Manually-created groups (set directly on the Students sheet) are assumed to share the same minutes/session pattern; the scheduler uses the first member\'s numbers.');
  blank();

  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 520);
  sheet.getRange(1, 1, Math.max(row, 1), 2).setVerticalAlignment('top');
}

function updateReadMeStatus(scheduledCount, unscheduledCount, rescuedStudentCount) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.README);
  if (!sheet || sheet.getLastRow() < 1) return; // nothing to update if the tab is empty/missing
  // Status box is written at a fixed location by buildReadMeSheet(); find it by label instead of a hardcoded row
  // in case someone reorders the Read Me content, so this stays robust.
  const values = sheet.getRange(1, 1, Math.min(sheet.getLastRow(), 30), 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === 'Last Generated:') {
      sheet.getRange(i + 1, 2).setValue(new Date().toLocaleString());
      sheet.getRange(i + 2, 2).setValue(scheduledCount);
      sheet.getRange(i + 3, 2).setValue(unscheduledCount);
      sheet.getRange(i + 4, 2).setValue(rescuedStudentCount || 0);
      break;
    }
  }
}
