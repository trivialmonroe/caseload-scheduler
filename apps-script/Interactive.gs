/**
 * User-triggered actions outside the main Generate Schedule flow: the
 * sidebar form, live validation, the onEdit trigger, and Show Alternatives.
 */

function validateData() {
  const ui = SpreadsheetApp.getUi();
  const settings = loadSettings();
  const issues = [];

  const rawStudentRows = getSheetRows(SHEET_NAMES.STUDENTS);

  const groupMembers = {};

  rawStudentRows.forEach(r => {
    const id = String(r[0]).trim();
    const label = id || '(blank Student ID)';
    const status = String(r[13] || 'Active').trim();
    if (status.toLowerCase() !== 'active') return; // skip inactive students

    const rawFreq = String(r[6]).trim();
    if (rawFreq !== 'Weekly' && rawFreq !== 'Quarterly') {
      issues.push(`${label}: Frequency Type is "${rawFreq}" - must be exactly "Weekly" or "Quarterly", or it silently defaults to Weekly with 0 minutes.`);
    }

    const serviceType = String(r[4]).trim();
    const gids = parseGroupIds(r[5]);
    if (serviceType.toLowerCase() === 'group') {
      if (!gids.length) issues.push(`${label}: Service Type is Group but Group ID is blank.`);
      else {
        gids.forEach(gid => {
          if (!groupMembers[gid]) groupMembers[gid] = [];
          groupMembers[gid].push({ id: label, freq: rawFreq, minutes: r[7], preferredLen: r[8], sessionsQ: r[9], lenQ: r[10] });
        });
      }
    }
    const noGroupRaw = String(r[17] == null ? '' : r[17]).trim().toLowerCase();
    const noGroup = noGroupRaw === 'yes' || noGroupRaw === 'y' || noGroupRaw === 'true' || noGroupRaw === '1';
    if (noGroup && serviceType.toLowerCase() === 'group') {
      issues.push(`${label}: No Group cannot be Yes when Service Type is Group.`);
    }

    if (rawFreq === 'Weekly' && (!r[7] || Number(r[7]) <= 0)) {
      issues.push(`${label}: Weekly student has no Minutes/Week Required.`);
    }
    if (rawFreq === 'Weekly' && r[8] && (Number(r[8]) < settings.minSessionLength || Number(r[8]) > settings.maxSessionLength)) {
      issues.push(`${label}: Preferred Session Length (${r[8]} min) is outside the configured Min/Max (${settings.minSessionLength}-${settings.maxSessionLength} min) - it'll be silently clamped to fit, which may not be the length you meant.`);
    }
    if (rawFreq === 'Quarterly' && (!r[9] || !r[10] || Number(r[9]) <= 0 || Number(r[10]) <= 0)) {
      issues.push(`${label}: Quarterly student is missing Sessions Per Quarter or Session Length.`);
    }
  });

  Object.keys(groupMembers).forEach(gid => {
    const members = groupMembers[gid];
    if (members.length < 2) {
      issues.push(`Group "${gid}" only has 1 active member (${members[0].id}) - it will still schedule fine, but double check this is intentional.`);
    }
    const first = members[0];
    members.slice(1).forEach(m => {
      if (m.freq !== first.freq || m.minutes !== first.minutes || m.sessionsQ !== first.sessionsQ || m.lenQ !== first.lenQ) {
        issues.push(`Group "${gid}": ${m.id} has different minutes/session settings than ${first.id} - the scheduler uses ${first.id}'s numbers for the whole group.`);
      }
    });
  });

  if (!getSheetRows(SHEET_NAMES.AVAILABILITY).length) {
    issues.push('MyAvailability tab is empty - nothing can be scheduled until you add your open working blocks.');
  }
  if (settings.minSessionLength > settings.maxSessionLength) {
    issues.push('Settings: Min Session Length is greater than Max Session Length.');
  }

  if (!issues.length) {
    ui.alert('Validate Data', 'No issues found. Looks ready to generate.', ui.ButtonSet.OK);
  } else {
    ui.alert('Validate Data - ' + issues.length + ' issue(s) found', issues.map((s, i) => `${i + 1}. ${s}`).join('\n\n'), ui.ButtonSet.OK);
  }
}

function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.STUDENTS) return;
  const col = e.range.getColumn();
  const row = e.range.getRow();
  if (row < 2 || col === 12) return; // ignore header and the auto column itself
  if (col < 1 || col > 11) return;   // only react to edits in the fields that feed the calculation

  const numRows = e.range.getNumRows();
  const settings = loadSettings();

  for (let i = 0; i < numRows; i++) {
    const r = row + i;
    const rowVals = sheet.getRange(r, 1, 1, 11).getValues()[0];
    const frequencyType = String(rowVals[6]).trim();
    let info = '';
    if (frequencyType === 'Quarterly') {
      const sessionsQ = Number(rowVals[9]) || 0;
      if (sessionsQ > 0) info = `~${(sessionsQ / settings.weeksPerQuarter).toFixed(1)}/wk (${sessionsQ}/quarter)`;
    } else if (frequencyType === 'Weekly') {
      const minutesPerWeek = Number(rowVals[7]) || 0;
      const preferredLen = rowVals[8] ? Number(rowVals[8]) : null;
      if (minutesPerWeek > 0) info = computeWeeklyPlan(minutesPerWeek, settings, preferredLen).lengths.length;
    }
    sheet.getRange(r, 12).setValue(info);
  }
}

function showAlternativesForSelection() {
  const ui = SpreadsheetApp.getUi();
  const logRow = getSelectedLogRowFromSheet();
  if (!logRow) {
    ui.alert('Select a row on the Schedule_Log tab first. (For anything unscheduled or under minutes, check Schedule_Review.)');
    return;
  }

  const result = findAlternativeSlotsForLogRow(logRow);
  if (result.error) {
    ui.alert(result.error);
    return;
  }
  if (!result.candidates.length) {
    ui.alert('No alternative slots exist given current bookings and constraints.');
    return;
  }

  const list = result.candidates.slice(0, 20).map((c, i) =>
    `${i + 1}. ${c.day}  ${minutesToTimeStr(c.start)} - ${minutesToTimeStr(c.end)}${c.week != null && c.week !== ALL_WEEKS_KEY ? ' (' + weekLabel(c.week) + ')' : ''}`
  ).join('\n');
  const student = result.members[0];
  const scopeLabel = result.isAllWeeks ? '(applies every week)' : '(' + weekLabel(result.weekNum) + ' only)';
  const groupNote = logRow.groupId ? ' (group ' + logRow.groupId + ')' : '';
  ui.alert(
    `Alternatives for ${student.firstName} ${student.lastName}${groupNote} ${scopeLabel} — showing up to 20 (spread across days):\n\n${list}\n\nUse "Move Selected Session to Alternative" and enter the number, or manually update Day/Start/End on Schedule_Log.`
  );
}

function moveSelectedSessionToAlternative() {
  const ui = SpreadsheetApp.getUi();
  const logRow = getSelectedLogRowFromSheet();
  if (!logRow) {
    ui.alert('Select a row on the Schedule_Log tab first.');
    return;
  }
  if (String(logRow.locked).toLowerCase() === 'yes') {
    ui.alert('Unlock this session first (clear Locked column), then move it.');
    return;
  }

  const result = findAlternativeSlotsForLogRow(logRow);
  if (result.error) { ui.alert(result.error); return; }
  if (!result.candidates.length) {
    ui.alert('No alternative slots exist given current bookings and constraints.');
    return;
  }

  const picks = result.candidates.slice(0, 12);
  const list = picks.map((c, i) =>
    `${i + 1}. ${c.day} ${minutesToTimeStr(c.start)}-${minutesToTimeStr(c.end)}`
  ).join('\n');
  const resp = ui.prompt(
    'Move session',
    `Pick a slot number (moves the whole group):\n\n${list}`,
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const n = Number(String(resp.getResponseText()).trim());
  if (!Number.isFinite(n) || n < 1 || n > picks.length) {
    ui.alert('Enter a number from the list.');
    return;
  }

  applyMoveToLogRows(result.mateRows, picks[n - 1]);
  refreshCoverageFromLog();
  SpreadsheetApp.getActiveSpreadsheet().toast('Session moved on Schedule_Log.', 'Moved', 5);
}

function showSwapCandidatesForSelection() {
  const ui = SpreadsheetApp.getUi();
  const logRow = getSelectedLogRowFromSheet();
  if (!logRow) {
    ui.alert('Select a row on the Schedule_Log tab first.');
    return;
  }
  if (String(logRow.locked).toLowerCase() === 'yes') {
    ui.alert('Unlock this session before swapping.');
    return;
  }

  const result = findSwapCandidatesForLogRow(logRow);
  if (result.error) { ui.alert(result.error); return; }
  if (!result.swaps.length) {
    ui.alert('No valid swap partners found (need a mutual fit — same week scope, neither locked).');
    return;
  }

  const list = result.swaps.slice(0, 12).map((s, i) =>
    `${i + 1}. Swap with ${s.otherLabel} (${s.otherDay} ${minutesToTimeStr(s.otherStart)})`
  ).join('\n');
  ui.alert(`Swap options for selected session:\n\n${list}\n\nUse "Apply Swap for Selected Session" and enter the number.`);
}

function applySwapForSelectedSession() {
  const ui = SpreadsheetApp.getUi();
  const logRow = getSelectedLogRowFromSheet();
  if (!logRow) {
    ui.alert('Select a row on the Schedule_Log tab first.');
    return;
  }

  const result = findSwapCandidatesForLogRow(logRow);
  if (result.error) { ui.alert(result.error); return; }
  const picks = result.swaps.slice(0, 12);
  if (!picks.length) {
    ui.alert('No valid swap partners found.');
    return;
  }

  const list = picks.map((s, i) =>
    `${i + 1}. ${s.otherLabel} (${s.otherDay} ${minutesToTimeStr(s.otherStart)})`
  ).join('\n');
  const resp = ui.prompt('Apply swap', `Pick a swap number:\n\n${list}`, ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const n = Number(String(resp.getResponseText()).trim());
  if (!Number.isFinite(n) || n < 1 || n > picks.length) {
    ui.alert('Enter a number from the list.');
    return;
  }

  const swap = picks[n - 1];
  const scheduleLog = loadScheduleLogObjects();
  const otherRow = scheduleLog.find(r => r.sheetRow === swap.otherSheetRow);
  if (!otherRow) { ui.alert('Could not find the other session row.'); return; }
  const bMates = sessionMateRows(scheduleLog, otherRow);

  applySwapOnLogRows(result.mateRows, bMates, swap);
  refreshCoverageFromLog();
  SpreadsheetApp.getActiveSpreadsheet().toast('Sessions swapped on Schedule_Log.', 'Swapped', 5);
}

function addStudentToSelectedSession() {
  const ui = SpreadsheetApp.getUi();
  const logRow = getSelectedLogRowFromSheet();
  if (!logRow) {
    ui.alert('Select a row on the Schedule_Log tab first.');
    return;
  }

  const resp = ui.prompt('Add student to session', 'Enter the Student ID to add:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const studentId = String(resp.getResponseText()).trim();
  if (!studentId) return;

  const check = canAddStudentToSessionForLogRow(logRow, studentId);
  if (!check.ok) {
    ui.alert(check.error);
    return;
  }

  appendStudentToSessionOnLog(logRow, check.student);
  refreshCoverageFromLog();
  SpreadsheetApp.getActiveSpreadsheet().toast('Added ' + check.student.firstName + ' to the session.', 'Added', 5);
}

function showStudentSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('StudentForm').setTitle('Add / Edit Student');
  SpreadsheetApp.getUi().showSidebar(html);
}

function submitStudentForm(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.STUDENTS);
  const rows = getSheetRows(SHEET_NAMES.STUDENTS);
  const existingRowIdx = rows.findIndex(r => String(r[0]).trim() === String(data.id).trim());

  const settings = loadSettings();
  const isQuarterly = data.frequencyType === 'Quarterly';

  let sessionsPerWeekInfo;
  if (isQuarterly) {
    sessionsPerWeekInfo = `~${(Number(data.sessionsPerQuarter) / settings.weeksPerQuarter).toFixed(1)}/wk (${data.sessionsPerQuarter}/quarter)`;
  } else {
    const preferredLen = data.sessionLength ? Number(data.sessionLength) : null;
    const plan = computeWeeklyPlan(Number(data.minutesPerWeek), settings, preferredLen);
    sessionsPerWeekInfo = plan.lengths.length;
  }

  const rowValues = [
    data.id, data.firstName, data.lastName, data.grade, data.serviceType,
    data.groupId || '', data.frequencyType,
    isQuarterly ? '' : Number(data.minutesPerWeek),
    isQuarterly ? '' : (data.sessionLength ? Number(data.sessionLength) : ''),
    isQuarterly ? Number(data.sessionsPerQuarter) : '',
    isQuarterly ? Number(data.quarterlySessionLength) : '',
    sessionsPerWeekInfo,
    data.notes || '', data.status || 'Active', data.teacher || '',
    data.fixedDay || '', data.fixedStartTime || '',
    data.noGroup ? 'Yes' : ''
  ];

  if (existingRowIdx >= 0) {
    sheet.getRange(existingRowIdx + 2, 1, 1, rowValues.length).setValues([rowValues]);
    if (String(data.serviceType).toLowerCase() === 'group' && data.groupId) {
      syncGroupIdOnScheduleLog(data.id, data.groupId);
    }
    return 'Updated existing student: ' + data.firstName + ' ' + data.lastName;
  } else {
    sheet.appendRow(rowValues);
    if (String(data.serviceType).toLowerCase() === 'group' && data.groupId) {
      syncGroupIdOnScheduleLog(data.id, data.groupId);
    }
    return 'Added new student: ' + data.firstName + ' ' + data.lastName;
  }
}
