/**
 * User-triggered actions outside the main Generate Schedule flow: the
 * sidebar form, live validation, the onEdit trigger, and Show Alternatives.
 */

function validateData() {
  const ui = SpreadsheetApp.getUi();
  const settings = loadSettings();
  const issues = [];

  const rawStudentRows = getSheetRows(SHEET_NAMES.STUDENTS);
  const gradeRows = getSheetRows(SHEET_NAMES.GRADES);
  const gradesInUse = {};
  gradeRows.forEach(r => { gradesInUse[String(r[0]).trim()] = true; });

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
    const groupId = r[5] ? String(r[5]).trim() : '';
    if (serviceType === 'Group') {
      if (!groupId) issues.push(`${label}: Service Type is Group but Group ID is blank.`);
      else {
        if (!groupMembers[groupId]) groupMembers[groupId] = [];
        groupMembers[groupId].push({ id: label, freq: rawFreq, minutes: r[7], preferredLen: r[8], sessionsQ: r[9], lenQ: r[10] });
      }
    }

    const grade = String(r[3]).trim();
    if (grade && !gradesInUse[grade]) {
      issues.push(`${label}: Grade "${grade}" has no rows on the Grades tab - no grade-level blackouts (lunch/recess/specials) will apply.`);
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
  const activeSheet = SpreadsheetApp.getActiveSheet();
  const row = SpreadsheetApp.getActiveRange().getRow();
  const name = activeSheet.getName();

  if (row < 2 || name !== SHEET_NAMES.LOG) {
    ui.alert('Select a row on the Schedule_Log tab first. (For anything unscheduled or under minutes, check Schedule_Review.)');
    return;
  }

  const studentId = String(activeSheet.getRange(row, 1).getValue()).trim();
  if (!studentId) { ui.alert('No Student ID found on that row.'); return; }

  const settings = loadSettings();
  const availByPattern = loadProviderAvailability();
  const gradeBlackouts = loadGradeBlackouts();
  const studentConstraints = loadStudentConstraints();
  const students = loadStudents();
  const student = students.find(s => s.id === studentId);
  if (!student) { ui.alert('Student not found (may be inactive).'); return; }

  const weekText = String(activeSheet.getRange(row, 5).getValue()).trim(); // "Every Week" / "Week 2" / ""
  const isAllWeeks = weekText === 'Every Week' || weekText === '';
  const weekNum = isAllWeeks ? ALL_WEEKS_KEY : Number(weekText.replace(/[^0-9]/g, ''));

  const logRows = getSheetRows(SHEET_NAMES.LOG);
  const providerBookingsByWeek = emptyBookingsByWeek(settings.weeksList);
  const memberBookingsByWeek = {};
  students.forEach(s => { memberBookingsByWeek[s.id] = emptyBookingsByWeek(settings.weeksList); });

  const excludeGroupId = student.groupId;

  logRows.forEach(r => {
    const rowStudentId = String(r[0]).trim();
    const rowGroupId = String(r[3]).trim();
    const isSameEntity = rowStudentId === studentId || (excludeGroupId && rowGroupId === excludeGroupId);
    if (isSameEntity) return; // exclude this student/group's own current bookings

    const rWeekText = String(r[4]).trim();
    const rIsAll = rWeekText === 'Every Week';
    const day = r[5], start = timeStrToMinutes(r[6]), end = timeStrToMinutes(r[7]);
    const weeksHit = rIsAll ? settings.weeksList : [Number(rWeekText.replace(/[^0-9]/g, ''))];

    weeksHit.forEach(w => {
      if (!providerBookingsByWeek[w]) return;
      providerBookingsByWeek[w][day].push({ start, end });
      if (memberBookingsByWeek[rowStudentId] && memberBookingsByWeek[rowStudentId][w]) {
        memberBookingsByWeek[rowStudentId][w][day].push({ start, end });
      }
    });
  });

  const members = excludeGroupId ? students.filter(s => s.groupId === excludeGroupId) : [student];

  let sessionLength;
  if (name === SHEET_NAMES.LOG) {
    sessionLength = timeStrToMinutes(activeSheet.getRange(row, 8).getValue()) - timeStrToMinutes(activeSheet.getRange(row, 7).getValue());
  } else {
    sessionLength = Number(activeSheet.getRange(row, 7).getValue()) ||
      (student.frequencyType === 'Quarterly' ? student.quarterlySessionLength : computeWeeklyPlan(student.minutesPerWeek, settings, student.preferredSessionLength).lengths[0]);
  }

  const session = { members, sessionLength, week: weekNum };
  const candidates = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, []);

  if (!candidates.length) {
    ui.alert('No alternative slots exist given current bookings and constraints.');
    return;
  }

  const list = candidates.slice(0, 20).map(c => `${c.day}  ${minutesToTimeStr(c.start)} - ${minutesToTimeStr(c.end)}`).join('\n');
  const scopeLabel = isAllWeeks ? '(applies every week)' : `(${weekLabel(weekNum)} only)`;
  ui.alert(`Alternatives for ${student.firstName} ${student.lastName}${excludeGroupId ? ' (group ' + excludeGroupId + ')' : ''} ${scopeLabel} - showing up to 20:\n\n${list}\n\nManually update the Schedule_Log row's Day/Start/End to apply your pick, or delete the row and re-run Generate Schedule to let the algorithm re-place it.`);
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
    data.fixedDay || '', data.fixedStartTime || ''
  ];

  if (existingRowIdx >= 0) {
    sheet.getRange(existingRowIdx + 2, 1, 1, rowValues.length).setValues([rowValues]);
    return 'Updated existing student: ' + data.firstName + ' ' + data.lastName;
  } else {
    sheet.appendRow(rowValues);
    return 'Added new student: ' + data.firstName + ' ' + data.lastName;
  }
}
