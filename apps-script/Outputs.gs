/**
 * Everything that writes a generated result back to the spreadsheet -
 * Schedule_Log, Schedule_Review, Open_Slots, and Printable_Schedule.
 */

function writeScheduleLog(scheduled) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 11).clearContent();

  const rows = scheduled
    .sort((a, b) => {
      const aw = a.week === ALL_WEEKS_KEY ? 0 : a.week;
      const bw = b.week === ALL_WEEKS_KEY ? 0 : b.week;
      return aw - bw || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start;
    })
    .flatMap(s => s.members.map(m => [
      m.id, `${m.firstName} ${m.lastName}`, m.grade, m.groupId || '', weekLabel(s.week), s.day,
      minutesToTimeStr(s.start), minutesToTimeStr(s.end), s.end - s.start, m.teacher || '', s.locked ? 'Yes' : ''
    ]));

  if (rows.length) sheet.getRange(2, 1, rows.length, 11).setValues(rows);

  // Visually flag auto-formed groups so the "review for clinical fit" step is
  // easy to do at a glance, instead of having to read the Group ID text.
  const autoGroupRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=LEFT($D2,11)="AUTO-GROUP-"')
    .setBackground('#d9d2e9')
    .setRanges([sheet.getRange(2, 1, 999, 11)])
    .build();
  sheet.setConditionalFormatRules([autoGroupRule]);
}

function writeScheduleReview(scheduled, unscheduled, capacityWarnings) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.REVIEW);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.REVIEW);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.setTabColor(OUTPUT_TAB_COLOR);

  const students = loadStudents(); // active only
  if (!students.length) {
    sheet.getRange(1, 1).setValue('No active students found in the Students sheet.');
    return;
  }

  const scheduledByStudent = {};
  scheduled.forEach(s => {
    const minutes = s.end - s.start;
    s.members.forEach(m => { scheduledByStudent[m.id] = (scheduledByStudent[m.id] || 0) + minutes; });
  });

  const reasonsByStudent = {};
  unscheduled.forEach(u => {
    u.session.members.forEach(m => {
      if (!reasonsByStudent[m.id]) reasonsByStudent[m.id] = [];
      if (reasonsByStudent[m.id].indexOf(u.reason) === -1) reasonsByStudent[m.id].push(u.reason);
    });
  });
  (capacityWarnings || []).forEach(w => {
    w.members.forEach(m => {
      if (!reasonsByStudent[m.id]) reasonsByStudent[m.id] = [];
      if (reasonsByStudent[m.id].indexOf(w.message) === -1) reasonsByStudent[m.id].push(w.message);
    });
  });

  const rows = students.map(s => {
    const isQuarterly = s.frequencyType === 'Quarterly';
    const required = isQuarterly ? (s.sessionsPerQuarter * s.quarterlySessionLength) : s.minutesPerWeek;
    const scheduledMinutes = scheduledByStudent[s.id] || 0;
    const diff = scheduledMinutes - required;
    const pct = required > 0 ? Math.round((scheduledMinutes / required) * 100) : 0;
    const status = required <= 0 ? 'N/A' : (scheduledMinutes >= required ? (scheduledMinutes > required ? 'Over' : 'Met') : 'Under');
    const notes = (reasonsByStudent[s.id] || []).join(' | ');
    return {
      id: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade, freq: s.frequencyType,
      basis: isQuarterly ? 'per quarter' : 'per week', required, scheduled: scheduledMinutes, diff, pct, status, notes
    };
  });
  rows.sort((a, b) => a.pct - b.pct);

  const metCount = rows.filter(r => r.status === 'Met' || r.status === 'Over').length;

  let currentRow = 1;
  sheet.getRange(currentRow, 1, 1, 2).merge()
    .setValue(`${metCount} of ${rows.length} students meeting or exceeding required minutes`)
    .setFontWeight('bold').setFontSize(14);
  currentRow += 2;

  const headers = ['Student ID', 'Name', 'Grade', 'Frequency Type', 'Basis', 'Required (min)', 'Scheduled (min)', 'Difference (min)', '% of Required Met', 'Status', 'Notes'];
  const headerRow = currentRow;
  sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#434343').setFontColor('#ffffff');
  currentRow++;

  const dataStartRow = currentRow;
  const values = rows.map(r => [r.id, r.name, r.grade, r.freq, r.basis, r.required, r.scheduled, r.diff, r.pct + '%', r.status, r.notes]);
  sheet.getRange(dataStartRow, 1, values.length, headers.length).setValues(values);

  sheet.getRange(headerRow, 1, 1 + values.length, headers.length)
    .setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);

  const underRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$J${dataStartRow}="Under"`)
    .setBackground('#fce8e6')
    .setRanges([sheet.getRange(dataStartRow, 1, values.length, headers.length)])
    .build();
  const metRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=OR($J${dataStartRow}="Met",$J${dataStartRow}="Over")`)
    .setBackground('#d9ead3')
    .setRanges([sheet.getRange(dataStartRow, 1, values.length, headers.length)])
    .build();
  sheet.setConditionalFormatRules([underRule, metRule]);

  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 140);
  for (let c = 3; c <= 10; c++) sheet.setColumnWidth(c, 110);
  sheet.setColumnWidth(11, 320);
  sheet.getRange(headerRow, 3, 1 + values.length, 8).setHorizontalAlignment('center');
}

function writeOpenSlotsGrid() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = loadSettings();
  const availByPattern = loadProviderAvailability();
  const gradeBlackouts = loadGradeBlackouts();
  const students = loadStudents();

  let sheet = ss.getSheetByName(SHEET_NAMES.OPENSLOTS);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.OPENSLOTS);
  sheet.clear();
  sheet.setTabColor(OUTPUT_TAB_COLOR);

  // Grades to show: any grade with an active student, plus any grade that has
  // Grades-tab rows even if nobody's assigned there yet.
  const gradeSet = {};
  students.forEach(s => { if (s.grade) gradeSet[s.grade] = true; });
  Object.keys(gradeBlackouts).forEach(g => { if (g) gradeSet[g] = true; });
  const grades = Object.keys(gradeSet).sort();

  if (!grades.length) {
    sheet.getRange(1, 1).setValue('Add students and/or Grades rows first.');
    return;
  }

  let minStart = Infinity, maxEnd = -Infinity;
  ['ALL', 'A', 'B'].forEach(p => DAYS.forEach(d => (availByPattern[p][d] || []).forEach(w => {
    minStart = Math.min(minStart, w.start);
    maxEnd = Math.max(maxEnd, w.end);
  })));
  if (!isFinite(minStart)) { sheet.getRange(1, 1).setValue('Set MyAvailability first.'); return; }

  const hasAlternating = DAYS.some(d => (availByPattern.A[d] || []).length || (availByPattern.B[d] || []).length);
  const patternsToShow = hasAlternating ? ['A', 'B'] : ['ALL'];

  const inc = 15; // coarser than the scheduling increment - this is an overview, not a booking grid
  const rowsCount = Math.max(1, Math.ceil((maxEnd - minStart) / inc));
  const header = ['Time', ...DAYS];

  const COLOR_OPEN = '#d9ead3';
  const COLOR_BLOCKED = '#f4cccc';
  const COLOR_OFF = '#e0e0e0';

  // Build each grid first so we can also total up open minutes for the summary table.
  const blocks = [];
  grades.forEach(grade => {
    patternsToShow.forEach(pattern => {
      const providerAvail = {};
      DAYS.forEach(d => {
        providerAvail[d] = pattern === 'ALL'
          ? (availByPattern.ALL[d] || [])
          : (availByPattern.ALL[d] || []).concat(availByPattern[pattern][d] || []);
      });
      const blackouts = gradeBlackouts[grade] || {};

      const gridValues = [];
      const gridColors = [];
      let openMinutes = 0;
      for (let i = 0; i < rowsCount; i++) {
        const t = minStart + i * inc;
        const rowVals = [minutesToTimeStr(t)];
        const rowColors = ['#ffffff'];
        DAYS.forEach(day => {
          const availWindow = (providerAvail[day] || []).find(w => t >= w.start && t < w.end);
          if (!availWindow) {
            rowVals.push('');
            rowColors.push(COLOR_OFF);
          } else {
            const blockedHere = (blackouts[day] || []).find(b => t >= b.start && t < b.end);
            if (blockedHere) {
              rowVals.push(blockedHere.reason || 'Blocked');
              rowColors.push(COLOR_BLOCKED);
            } else {
              rowVals.push('');
              rowColors.push(COLOR_OPEN);
              openMinutes += inc;
            }
          }
        });
        gridValues.push(rowVals);
        gridColors.push(rowColors);
      }

      blocks.push({ grade, pattern, gridValues, gridColors, openMinutes });
    });
  });

  let currentRow = 1;
  sheet.getRange(currentRow, 1, 1, 2).merge().setValue('Open Slots by Grade & Week Pattern')
    .setFontWeight('bold').setFontSize(16);
  currentRow += 2;

  sheet.getRange(currentRow, 1).setValue('Summary (lowest open capacity first)').setFontWeight('bold');
  currentRow++;
  sheet.getRange(currentRow, 1, 1, 2).setValues([['Grade / Pattern', 'Open Minutes / Week']]).setFontWeight('bold');
  currentRow++;
  const summaryStartRow = currentRow;
  const sortedBlocks = blocks.slice().sort((a, b) => a.openMinutes - b.openMinutes);
  sortedBlocks.forEach(b => {
    sheet.getRange(currentRow, 1).setValue(`Grade ${b.grade}${hasAlternating ? ' - Pattern ' + b.pattern : ''}`);
    sheet.getRange(currentRow, 2).setValue(b.openMinutes).setHorizontalAlignment('right');
    currentRow++;
  });
  sheet.getRange(summaryStartRow, 1, sortedBlocks.length, 2)
    .setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
  currentRow += 2;

  blocks.forEach(b => {
    const label = `Grade ${b.grade}${hasAlternating ? ' - Pattern ' + b.pattern : ''} (${b.openMinutes} open min/week)`;
    sheet.getRange(currentRow, 1).setValue(label).setFontWeight('bold').setFontSize(12);
    currentRow++;
    sheet.getRange(currentRow, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    currentRow++;

    sheet.getRange(currentRow, 1, b.gridValues.length, header.length).setValues(b.gridValues)
      .setBackgrounds(b.gridColors).setHorizontalAlignment('center');
    currentRow += b.gridValues.length + 2;
  });

  sheet.setColumnWidth(1, 200);
  for (let c = 2; c <= header.length; c++) sheet.setColumnWidth(c, 120);
}

/**
 * Builds the Printable_Schedule tab. By default (showAllWeeks = false) only
 * the first 2-week pair is shown - fast, and with "Prefer Consistent Weekly
 * Pattern" on, later weeks normally look the same anyway. Pass true to
 * instead render every quarter week, stacked as sequential 2-week blocks
 * (Week 1+2, Week 3+4, ...) so a part-time provider can see every actual
 * permutation across the full quarter - this is slower since it's building
 * roughly 4-5x as much content, so it's opt-in rather than the default.
 */
function writeVisualSchedule(showAllWeeks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.VISUAL);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.VISUAL);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.setTabColor(OUTPUT_TAB_COLOR);

  const settings = loadSettings();
  const logRows = getSheetRows(SHEET_NAMES.LOG);
  if (!logRows.length) {
    sheet.getRange(1, 1).setValue('Run Generate Schedule first - nothing in Schedule_Log yet.');
    return;
  }

  const sessions = logRows.map(r => ({
    grade: String(r[2]).trim(), groupId: r[3] ? String(r[3]).trim() : '', name: r[1],
    weekLabel: String(r[4]).trim(), day: r[5], start: timeStrToMinutes(r[6]), end: timeStrToMinutes(r[7]),
    teacher: r[9] ? String(r[9]).trim() : ''
  }));

  // Collapse individual student rows that share one session (same week/day/time/group) into a single block.
  const entryMap = {};
  sessions.forEach(s => {
    const key = s.weekLabel + '|' + s.day + '|' + s.start + '|' + s.end + '|' + (s.groupId || s.name);
    if (!entryMap[key]) entryMap[key] = { weekLabel: s.weekLabel, day: s.day, start: s.start, end: s.end, grade: s.grade, names: [], teachers: [] };
    entryMap[key].names.push(s.name);
    if (s.teacher && entryMap[key].teachers.indexOf(s.teacher) === -1) entryMap[key].teachers.push(s.teacher);
  });
  const entries = Object.values(entryMap);

  // Assign each grade a stable color, ordered by grade so it's the same every time this is rebuilt.
  const distinctGrades = Array.from(new Set(entries.map(e => e.grade))).sort((a, b) => gradeSortValue(a) - gradeSortValue(b));
  const gradeColors = {};
  distinctGrades.forEach((g, i) => { gradeColors[g] = SCHEDULE_COLOR_PALETTE[i % SCHEDULE_COLOR_PALETTE.length]; });

  const hasSpecificWeeks = entries.some(e => e.weekLabel !== 'Every Week');
  const weeksToShow = hasSpecificWeeks ? settings.weeksList : [1];

  const availByPattern = loadProviderAvailability();
  let minStart = Infinity, maxEnd = -Infinity;
  ['ALL', 'A', 'B'].forEach(p => DAYS.forEach(d => (availByPattern[p][d] || []).forEach(w => {
    minStart = Math.min(minStart, w.start);
    maxEnd = Math.max(maxEnd, w.end);
  })));
  if (!isFinite(minStart)) { minStart = timeStrToMinutes('8:00 AM'); maxEnd = timeStrToMinutes('3:00 PM'); }

  const inc = 15; // display granularity - fine enough to place sessions accurately, coarse enough to keep row count sane
  const rowsCount = Math.max(1, Math.ceil((maxEnd - minStart) / inc));
  const header = ['Time', ...DAYS];
  // Same rounding function used for BOTH a session's start and end time, so a
  // session that ends exactly when another begins always computes adjacent
  // (not overlapping) rows - using floor() for start and round() for end
  // independently can round a shared boundary to two different rows, which
  // is exactly what throws "you must select all cells in a merged cell".
  const rowForTime = (t) => Math.round((t - minStart) / inc);

  // Legend
  let currentRow = 1;
  sheet.getRange(currentRow, 1).setValue('Legend:').setFontWeight('bold').setFontSize(11);
  distinctGrades.forEach((g, i) => {
    sheet.getRange(currentRow, 2 + i).setValue('Grade ' + g)
      .setBackground(gradeColors[g].bg).setFontColor(gradeColors[g].text).setFontSize(10).setHorizontalAlignment('center');
  });
  currentRow += 2;

  const gridRanges = []; // {startRow, numRows} for every week block, resized once at the end

  // By default only the FIRST 2-week pair is shown - the point of that view is
  // a clean, fast reference for the provider's real 2-week rotation, not an
  // exhaustive week-by-week record. With showAllWeeks, every quarter week is
  // included instead, stacked as sequential 2-week blocks (Week 1+2, Week
  // 3+4, ...) so every actual A/B permutation across the quarter is visible.
  const weekPairs = [];
  if (showAllWeeks && hasSpecificWeeks) {
    for (let i = 0; i < weeksToShow.length; i += 2) weekPairs.push(weeksToShow.slice(i, i + 2));
  } else {
    weekPairs.push(weeksToShow.slice(0, 2));
  }

  weekPairs.forEach(pairWeeks => {
    sheet.getRange(currentRow, 1, 1, header.length).merge()
      .setValue(hasSpecificWeeks
        ? pairWeeks.map(w => weekLabel(w)).join('  +  ') + (showAllWeeks ? '' : '  (representative 2-week view - see Schedule_Log for every week, or Build Printable Schedule (All Weeks))')
        : 'Weekly Schedule')
      .setFontWeight('bold').setFontSize(14);
    currentRow += 2;

    pairWeeks.forEach(week => {
      if (hasSpecificWeeks) {
        sheet.getRange(currentRow, 1, 1, header.length).merge()
          .setValue(`${weekLabel(week)}  -  Pattern ${getWeekPattern(week, settings)}`)
          .setFontWeight('bold').setFontSize(12);
        currentRow++;
      }

      sheet.getRange(currentRow, 1, 1, header.length).setValues([header])
        .setFontWeight('bold').setBackground('#434343').setFontColor('#ffffff');
      currentRow++;

      const gridStartRow = currentRow;
      const timeLabels = [];
      for (let r = 0; r < rowsCount; r++) timeLabels.push([minutesToTimeStr(minStart + r * inc)]);
      sheet.getRange(gridStartRow, 1, rowsCount, 1).setValues(timeLabels).setFontColor('#999999').setFontSize(9);

      // Track occupied rows per day within THIS week's grid, so if two entries
      // still somehow compute overlapping rows (e.g. a data anomaly), the
      // second one falls back to a single unmerged cell instead of throwing
      // and aborting the rest of the sheet.
      const occupiedByDay = {};
      DAYS.forEach(d => occupiedByDay[d] = new Set());

      entries
        .filter(e => e.weekLabel === 'Every Week' || (hasSpecificWeeks && e.weekLabel === weekLabel(week)))
        .forEach(e => {
          const dayCol = DAYS.indexOf(e.day) + 2;
          if (dayCol < 2) return;

          let startOffset = Math.max(0, rowForTime(e.start));
          let endOffset = Math.min(rowsCount, Math.max(startOffset + 1, rowForTime(e.end)));

          const occupied = occupiedByDay[e.day];
          let overlaps = false;
          for (let r = startOffset; r < endOffset; r++) { if (occupied.has(r)) { overlaps = true; break; } }
          if (overlaps) { endOffset = Math.min(rowsCount, startOffset + 1); } // shrink to a single safe cell rather than skip the entry entirely

          const numRows = Math.max(1, endOffset - startOffset);
          for (let r = startOffset; r < startOffset + numRows; r++) occupied.add(r);

          const color = gradeColors[e.grade] || SCHEDULE_COLOR_PALETTE[0];
          const timeRangeText = minutesToTimeStr(e.start) + '-' + minutesToTimeStr(e.end);
          let cellText = e.names.join(' + ') + '\n' + timeRangeText;
          if (settings.showTeacherInfo && e.teachers.length) cellText += '\n(' + e.teachers.join(', ') + ')';
          try {
            const range = sheet.getRange(gridStartRow + startOffset, dayCol, numRows, 1);
            if (numRows > 1) range.merge();
            range.setValue(cellText)
              .setBackground(color.bg).setFontColor(color.text)
              .setFontSize(10).setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(true);
          } catch (err) {
            sheet.getRange(gridStartRow + startOffset, dayCol).setValue(cellText)
              .setBackground(color.bg).setFontColor(color.text).setFontSize(9).setWrap(true);
          }
        });

      sheet.getRange(gridStartRow, 1, rowsCount, header.length)
        .setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);

      gridRanges.push({ startRow: gridStartRow, numRows: rowsCount });
      currentRow = gridStartRow + rowsCount + 2;
    });

    currentRow++; // extra spacer between pair-blocks when there's more than one
  });

  sheet.setColumnWidth(1, 64);
  for (let c = 2; c <= header.length; c++) sheet.setColumnWidth(c, 150);

  // Resize rows/columns to fit whatever actually got written - wrapped
  // multi-name group blocks need more height than autoResize gives them by
  // default on a merged cell, so enforce a sensible minimum on top of it.
  gridRanges.forEach(g => {
    sheet.autoResizeRows(g.startRow, g.numRows);
    for (let r = g.startRow; r < g.startRow + g.numRows; r++) {
      if (sheet.getRowHeight(r) < 20) sheet.setRowHeight(r, 20);
    }
  });
  sheet.autoResizeColumns(2, header.length - 1);
  for (let c = 2; c <= header.length; c++) {
    if (sheet.getColumnWidth(c) < 110) sheet.setColumnWidth(c, 110);
  }
}

/**
 * Clears everything EXCEPT locked rows - locked sessions represent a
 * decision you've already reviewed and approved, so this should never
 * silently undo them. To truly wipe everything, run Clear All Locks first,
 * then this.
 */
function clearSchedule() {
  const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  let lockedCount = 0;
  if (logSheet && logSheet.getLastRow() > 1) {
    const numRows = logSheet.getLastRow() - 1;
    const numCols = logSheet.getLastColumn();
    const data = logSheet.getRange(2, 1, numRows, numCols).getValues();
    const lockedRows = data.filter(row => String(row[10] || '').trim().toLowerCase() === 'yes');
    lockedCount = lockedRows.length;
    logSheet.getRange(2, 1, numRows, numCols).clearContent();
    if (lockedRows.length) logSheet.getRange(2, 1, lockedRows.length, numCols).setValues(lockedRows);
  }
  const review = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REVIEW);
  if (review) review.clear();
  const lockMsg = lockedCount ? ` ${lockedCount} locked session(s) were kept.` : '';
  SpreadsheetApp.getActiveSpreadsheet().toast(`Generated schedule cleared.${lockMsg}`, 'Cleared', 5);
}

function clearAllLocks() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 11, sheet.getLastRow() - 1, 1).clearContent();
  }
  SpreadsheetApp.getActiveSpreadsheet().toast('All locks cleared - the next Generate Schedule will re-optimize everything.', 'Cleared', 5);
}

/** Thin wrapper so the menu (which calls functions by name with no arguments) can trigger the all-weeks mode. */
function writeVisualScheduleAllWeeks() {
  writeVisualSchedule(true);
}
