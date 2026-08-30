/**
 * Session editing parity with the web app: live coverage from Schedule_Log,
 * diverse move alternatives, swap candidates, and add-student-to-session checks.
 */

function logObjectFromSheetRow(vals, sheetRow) {
  return {
    sheetRow: sheetRow,
    studentId: String(vals[0]).trim(),
    name: String(vals[1] || '').trim(),
    grade: String(vals[2] || '').trim(),
    groupId: vals[3] ? String(vals[3]).trim() : '',
    week: String(vals[4] || '').trim(),
    day: String(vals[5] || '').trim(),
    start: vals[6],
    end: vals[7],
    duration: Number(vals[8]) || 0,
    teacher: vals[9] ? String(vals[9]).trim() : '',
    locked: String(vals[10] || '').trim()
  };
}

function loadScheduleLogObjects() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const numRows = sheet.getLastRow() - 1;
  const data = sheet.getRange(2, 1, numRows, 11).getValues();
  const out = [];
  data.forEach((vals, i) => {
    if (!vals.some(c => c !== '' && c !== null)) return;
    out.push(logObjectFromSheetRow(vals, i + 2));
  });
  return out;
}

function getSelectedLogRowFromSheet() {
  const active = SpreadsheetApp.getActiveSheet();
  if (!active || active.getName() !== SHEET_NAMES.LOG) return null;
  const row = SpreadsheetApp.getActiveRange().getRow();
  if (row < 2) return null;
  const vals = active.getRange(row, 1, 1, 11).getValues()[0];
  if (!String(vals[0]).trim()) return null;
  return logObjectFromSheetRow(vals, row);
}

function sessionKeyFromLogRow(r) {
  return [
    normalizeWeekLabel(r.week),
    normalizeScheduleDay(r.day),
    String(r.start || '').trim(),
    String(r.end || '').trim(),
    String(r.groupId || '').trim()
  ].join('|');
}

function sessionMateRows(scheduleLog, logRow) {
  const key = sessionKeyFromLogRow(logRow);
  const gid = String(logRow.groupId || '').trim();
  const week = normalizeWeekLabel(logRow.week);
  const day = normalizeScheduleDay(logRow.day);
  const start = String(logRow.start || '').trim();
  const end = String(logRow.end || '').trim();
  return (scheduleLog || []).filter(r => {
    if (sessionKeyFromLogRow(r) === key) return true;
    if (!gid) return false;
    return String(r.groupId || '').trim() === gid
      && normalizeWeekLabel(r.week) === week
      && normalizeScheduleDay(r.day) === day
      && String(r.start || '').trim() === start
      && String(r.end || '').trim() === end;
  });
}

function scheduledEntriesFromLog(scheduleLog, students) {
  const studentsById = {};
  (students || []).forEach(s => { studentsById[s.id] = s; });
  const map = {};
  (scheduleLog || []).forEach(r => {
    const key = sessionKeyFromLogRow(r);
    if (!map[key]) {
      let start, end, week;
      try { start = timeStrToMinutes(r.start); end = timeStrToMinutes(r.end); } catch (e) { return; }
      const weekText = normalizeWeekLabel(r.week);
      week = (weekText === 'Every Week') ? ALL_WEEKS_KEY : (Number(String(weekText).replace(/[^0-9]/g, '')) || 1);
      map[key] = {
        reqId: String(r.groupId || r.studentId || ''),
        groupId: String(r.groupId || '').trim(),
        week, day: normalizeScheduleDay(r.day), start, end,
        members: [],
        locked: String(r.locked || '').toLowerCase() === 'yes'
      };
    }
    const sid = String(r.studentId).trim();
    if (map[key].members.some(m => m.id === sid)) return;
    const base = studentsById[sid] || {
      id: sid,
      firstName: String(r.name || '').split(' ')[0] || sid,
      lastName: String(r.name || '').split(' ').slice(1).join(' ') || '',
      grade: r.grade, teacher: r.teacher || '', groupId: r.groupId || '', noGroup: false,
      frequencyType: 'Weekly', minutesPerWeek: 0, sessionsPerQuarter: 0, quarterlySessionLength: 0
    };
    map[key].members.push(base);
  });
  return Object.values(map);
}

function buildScheduleReviewFromScheduled(scheduled, unscheduled, capacityWarnings, students) {
  const scheduledByStudent = {};
  scheduled.forEach(s => {
    const minutes = s.end - s.start;
    s.members.forEach(m => { scheduledByStudent[m.id] = (scheduledByStudent[m.id] || 0) + minutes; });
  });
  const reasonsByStudent = {};
  (unscheduled || []).forEach(u => u.session.members.forEach(m => {
    if (!reasonsByStudent[m.id]) reasonsByStudent[m.id] = [];
    if (reasonsByStudent[m.id].indexOf(u.reason) === -1) reasonsByStudent[m.id].push(u.reason);
  }));
  (capacityWarnings || []).forEach(w => w.members.forEach(m => {
    if (!reasonsByStudent[m.id]) reasonsByStudent[m.id] = [];
    if (reasonsByStudent[m.id].indexOf(w.message) === -1) reasonsByStudent[m.id].push(w.message);
  }));
  return students.map(s => {
    const isQuarterly = s.frequencyType === 'Quarterly';
    const required = isQuarterly ? (s.sessionsPerQuarter * s.quarterlySessionLength) : s.minutesPerWeek;
    const scheduledMinutes = scheduledByStudent[s.id] || 0;
    const diff = scheduledMinutes - required;
    const pct = required > 0 ? Math.round((scheduledMinutes / required) * 100) : 0;
    const status = required <= 0 ? 'N/A' : (scheduledMinutes >= required ? (scheduledMinutes > required ? 'Over' : 'Met') : 'Under');
    return {
      id: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade, freq: s.frequencyType,
      basis: isQuarterly ? 'per quarter' : 'per week', required, scheduled: scheduledMinutes, diff, pct, status,
      notes: (reasonsByStudent[s.id] || []).join(' | ')
    };
  }).sort((a, b) => a.pct - b.pct);
}

function reviewFromScheduleLogObjects(scheduleLog, students) {
  const scheduled = scheduledEntriesFromLog(scheduleLog, students);
  return buildScheduleReviewFromScheduled(scheduled, [], [], students);
}

/** Rewrite Schedule_Review from the current Schedule_Log without regenerating. */
function refreshCoverageFromLog() {
  const scheduleLog = loadScheduleLogObjects();
  const students = loadStudents();
  if (!students.length) {
    SpreadsheetApp.getUi().alert('No active students found.');
    return;
  }
  if (!scheduleLog.length) {
    SpreadsheetApp.getUi().alert('Schedule_Log is empty — run Generate Schedule first, or import a schedule.');
    return;
  }
  const scheduled = scheduledEntriesFromLog(scheduleLog, students);
  writeScheduleReview(scheduled, [], []);
  const review = buildScheduleReviewFromScheduled(scheduled, [], [], students);
  const met = review.filter(r => r.status === 'Met' || r.status === 'Over').length;
  SpreadsheetApp.getActiveSpreadsheet().toast(
    met + ' of ' + review.length + ' students meeting minutes (from current Schedule_Log).',
    'Coverage refreshed', 6);
}

function pickDiverseCandidates(candidates, limit) {
  const lim = limit || 80;
  if (!candidates || !candidates.length) return [];
  const aligned = candidates.filter(c => c.start % 15 === 0);
  const preferred = aligned.length ? aligned : candidates;
  const buckets = {};
  preferred.forEach(c => {
    const key = String(c.day) + '|' + String(c.week != null ? c.week : '');
    (buckets[key] = buckets[key] || []).push(c);
  });
  const keys = Object.keys(buckets);
  const out = [];
  const seen = {};
  let i = 0;
  while (out.length < lim) {
    let added = false;
    for (let k = 0; k < keys.length; k++) {
      const c = buckets[keys[k]][i];
      if (!c) continue;
      const id = c.day + '|' + c.start + '|' + (c.week != null ? c.week : '');
      if (seen[id]) continue;
      seen[id] = true;
      out.push(c);
      added = true;
      if (out.length >= lim) break;
    }
    if (!added) break;
    i++;
  }
  if (out.length < lim) {
    for (let n = 0; n < candidates.length; n++) {
      const c = candidates[n];
      const id = c.day + '|' + c.start + '|' + (c.week != null ? c.week : '');
      if (seen[id]) continue;
      seen[id] = true;
      out.push(c);
      if (out.length >= lim) break;
    }
  }
  return out;
}

function weekNumFromLogRow(logRow) {
  const weekText = normalizeWeekLabel(logRow.week);
  const isAllWeeks = weekText === 'Every Week';
  return { isAllWeeks, weekNum: isAllWeeks ? ALL_WEEKS_KEY : Number(String(weekText).replace(/[^0-9]/g, '')) };
}

function resolveSessionMembers(scheduleLog, logRow, studentsById) {
  const mateRows = sessionMateRows(scheduleLog, logRow);
  const mateIds = mateRows.map(r => String(r.studentId).trim());
  let members = mateIds.map(id => studentsById[id]).filter(Boolean);
  if (!members.length) {
    const student = studentsById[String(logRow.studentId).trim()];
    if (student) members = [student];
  }
  return { mateRows, mateIds, members };
}

function uniqueSessionRepresentatives(scheduleLog) {
  const seen = {};
  const out = [];
  (scheduleLog || []).forEach((r, i) => {
    const key = sessionKeyFromLogRow(r);
    if (seen[key]) return;
    seen[key] = true;
    out.push({ row: r, index: i, key, sheetRow: r.sheetRow });
  });
  return out;
}

function fillBookingsExcluding(scheduleLog, settings, students, excludeMovingKeys) {
  const providerBookingsByWeek = emptyBookingsByWeek(settings.weeksList);
  const memberBookingsByWeek = {};
  students.forEach(s => { memberBookingsByWeek[s.id] = emptyBookingsByWeek(settings.weeksList); });
  (scheduleLog || []).forEach(r => {
    const rowStudentId = String(r.studentId).trim();
    if (excludeMovingKeys[sessionKeyFromLogRow(r) + '|' + rowStudentId]) return;
    const rWeekText = normalizeWeekLabel(r.week);
    const rIsAll = rWeekText === 'Every Week';
    let start, end;
    try { start = timeStrToMinutes(r.start); end = timeStrToMinutes(r.end); } catch (e) { return; }
    const day = normalizeScheduleDay(r.day);
    const weeksHit = rIsAll ? settings.weeksList : [Number(String(rWeekText).replace(/[^0-9]/g, ''))];
    weeksHit.forEach(w => {
      if (!providerBookingsByWeek[w]) return;
      providerBookingsByWeek[w][day].push({ start, end });
      if (memberBookingsByWeek[rowStudentId] && memberBookingsByWeek[rowStudentId][w]) {
        memberBookingsByWeek[rowStudentId][w][day].push({ start, end });
      }
    });
  });
  return { providerBookingsByWeek, memberBookingsByWeek };
}

function canPlaceSessionAt(session, day, start, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings) {
  const duration = session.sessionLength;
  const end = start + duration;
  const weeksToCheck = weeksForEntry(session.week, settings);
  const providerAvail = effectiveAvailability(weeksToCheck, availByPattern, settings);
  const windows = providerAvail[day] || [];
  if (!windows.some(win => start >= win.start && end <= win.end)) return false;
  if (weeksToCheck.some(w => !providerBookingsByWeek[w] || (providerBookingsByWeek[w][day] || []).some(b => overlaps(start, end, b.start, b.end)))) {
    return false;
  }
  const memberBlackouts = session.members.map(m => getStudentBlackouts(m, gradeBlackouts, studentConstraints));
  for (let i = 0; i < session.members.length; i++) {
    const m = session.members[i];
    if ((memberBlackouts[i][day] || []).some(b => overlaps(start, end, b.start, b.end))) return false;
    if (weeksToCheck.some(w =>
      !(memberBookingsByWeek[m.id] && memberBookingsByWeek[m.id][w])
      || (memberBookingsByWeek[m.id][w][day] || []).some(b => overlaps(start, end, b.start, b.end))
    )) return false;
  }
  return true;
}

function findAlternativeSlotsForLogRow(logRow) {
  const settings = loadSettings();
  const availByPattern = loadProviderAvailability();
  const gradeBlackouts = loadGradeBlackouts();
  const studentConstraints = loadStudentConstraints();
  const students = loadStudents();
  const scheduleLog = loadScheduleLogObjects();
  const studentsById = {};
  students.forEach(s => { studentsById[s.id] = s; });

  const mateRows = sessionMateRows(scheduleLog, logRow);
  const mateIds = mateRows.map(r => String(r.studentId).trim());
  let members = mateIds.map(id => studentsById[id]).filter(Boolean);
  if (!members.length) {
    const student = studentsById[logRow.studentId];
    if (!student) return { error: 'Student not found (may be inactive).', candidates: [] };
    members.push(student);
  }

  const aWeek = weekNumFromLogRow(logRow);
  const providerBookingsByWeek = emptyBookingsByWeek(settings.weeksList);
  const memberBookingsByWeek = {};
  students.forEach(s => { memberBookingsByWeek[s.id] = emptyBookingsByWeek(settings.weeksList); });
  const movingKeys = {};
  mateRows.forEach(r => { movingKeys[sessionKeyFromLogRow(r) + '|' + String(r.studentId).trim()] = true; });

  scheduleLog.forEach(r => {
    const rowStudentId = String(r.studentId).trim();
    if (movingKeys[sessionKeyFromLogRow(r) + '|' + rowStudentId]) return;
    const rWeekText = normalizeWeekLabel(r.week);
    const rIsAll = rWeekText === 'Every Week';
    let start, end;
    try { start = timeStrToMinutes(r.start); end = timeStrToMinutes(r.end); } catch (e) { return; }
    const day = normalizeScheduleDay(r.day);
    const weeksHit = rIsAll ? settings.weeksList : [Number(String(rWeekText).replace(/[^0-9]/g, ''))];
    weeksHit.forEach(w => {
      if (!providerBookingsByWeek[w]) return;
      providerBookingsByWeek[w][day].push({ start, end });
      if (memberBookingsByWeek[rowStudentId] && memberBookingsByWeek[rowStudentId][w]) {
        memberBookingsByWeek[rowStudentId][w][day].push({ start, end });
      }
    });
  });

  let sessionLength;
  try { sessionLength = timeStrToMinutes(logRow.end) - timeStrToMinutes(logRow.start); } catch (e) { sessionLength = settings.minSessionLength; }
  const session = { members, sessionLength, week: aWeek.weekNum, reqId: String(logRow.groupId || members[0].id) };
  const candidates = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, [], {});

  return {
    members,
    mateRows,
    isAllWeeks: aWeek.isAllWeeks,
    weekNum: aWeek.weekNum,
    candidates: pickDiverseCandidates(candidates, 80)
  };
}

function findSwapCandidatesForLogRow(logRow) {
  const settings = loadSettings();
  const availByPattern = loadProviderAvailability();
  const gradeBlackouts = loadGradeBlackouts();
  const studentConstraints = loadStudentConstraints();
  const students = loadStudents();
  const scheduleLog = loadScheduleLogObjects();
  const studentsById = {};
  students.forEach(s => { studentsById[s.id] = s; });

  const a = resolveSessionMembers(scheduleLog, logRow, studentsById);
  if (!a.members.length) return { error: 'Student not found (may be inactive).', swaps: [] };
  const aWeek = weekNumFromLogRow(logRow);
  let aStart, aLen;
  try {
    aStart = timeStrToMinutes(logRow.start);
    aLen = timeStrToMinutes(logRow.end) - aStart;
  } catch (e) {
    return { error: 'Bad session time.', swaps: [] };
  }
  const aDay = normalizeScheduleDay(logRow.day);
  const aKey = sessionKeyFromLogRow(logRow);
  const aSession = {
    members: a.members,
    sessionLength: aLen,
    week: aWeek.weekNum,
    reqId: String(logRow.groupId || a.members[0].id)
  };

  const swaps = [];
  uniqueSessionRepresentatives(scheduleLog).forEach(rep => {
    if (rep.key === aKey) return;
    const other = rep.row;
    if (String(other.locked).toLowerCase() === 'yes') return;
    if (String(logRow.locked).toLowerCase() === 'yes') return;
    const bWeek = weekNumFromLogRow(other);
    if (aWeek.isAllWeeks !== bWeek.isAllWeeks) return;
    if (!aWeek.isAllWeeks && Number(aWeek.weekNum) !== Number(bWeek.weekNum)) return;

    const b = resolveSessionMembers(scheduleLog, other, studentsById);
    if (!b.members.length) return;
    if (a.mateIds.some(id => b.mateIds.indexOf(id) >= 0)) return;

    let bStart, bLen;
    try {
      bStart = timeStrToMinutes(other.start);
      bLen = timeStrToMinutes(other.end) - bStart;
    } catch (e) { return; }
    const bDay = normalizeScheduleDay(other.day);
    if (bDay === aDay && bStart === aStart) return;

    const exclude = {};
    a.mateRows.forEach(r => { exclude[sessionKeyFromLogRow(r) + '|' + String(r.studentId).trim()] = true; });
    b.mateRows.forEach(r => { exclude[sessionKeyFromLogRow(r) + '|' + String(r.studentId).trim()] = true; });
    const bookings = fillBookingsExcluding(scheduleLog, settings, students, exclude);

    const bSession = {
      members: b.members,
      sessionLength: bLen,
      week: bWeek.weekNum,
      reqId: String(other.groupId || b.members[0].id)
    };

    const aFitsAtB = canPlaceSessionAt(
      aSession, bDay, bStart,
      availByPattern, gradeBlackouts, studentConstraints,
      bookings.providerBookingsByWeek, bookings.memberBookingsByWeek, settings
    );
    const bFitsAtA = canPlaceSessionAt(
      bSession, aDay, aStart,
      availByPattern, gradeBlackouts, studentConstraints,
      bookings.providerBookingsByWeek, bookings.memberBookingsByWeek, settings
    );
    if (!aFitsAtB || !bFitsAtA) return;

    const names = Array.from(new Set(b.mateRows.map(r => r.name).filter(Boolean)));
    swaps.push({
      otherSheetRow: other.sheetRow,
      otherLabel: names.join(' + ') || other.name,
      otherDay: bDay,
      otherStart: bStart,
      otherEnd: bStart + bLen,
      aGoesTo: { day: bDay, start: bStart, end: bStart + aLen },
      bGoesTo: { day: aDay, start: aStart, end: aStart + bLen }
    });
  });

  swaps.sort((x, y) => {
    const sameDayX = x.otherDay === aDay ? 0 : 1;
    const sameDayY = y.otherDay === aDay ? 0 : 1;
    if (sameDayX !== sameDayY) return sameDayX - sameDayY;
    return Math.abs(x.otherStart - aStart) - Math.abs(y.otherStart - aStart);
  });

  return { members: a.members, mateRows: a.mateRows, swaps: swaps.slice(0, 24) };
}

function canAddStudentToSessionForLogRow(logRow, studentId) {
  const settings = loadSettings();
  const students = loadStudents();
  const scheduleLog = loadScheduleLogObjects();
  const student = students.find(s => s.id === studentId);
  if (!student) return { ok: false, error: 'Student not found or inactive.' };
  if (student.noGroup) return { ok: false, error: student.firstName + ' is marked No Group.' };
  const mates = sessionMateRows(scheduleLog, logRow);
  if (mates.some(r => String(r.studentId) === String(studentId))) {
    return { ok: false, error: 'Already in this session.' };
  }
  const hostNoGroup = mates.some(m => {
    const s = students.find(x => String(x.id) === String(m.studentId));
    return s && s.noGroup;
  });
  if (hostNoGroup) return { ok: false, error: 'Cannot add members to a No Group student\'s session.' };
  if (mates.length >= settings.maxGroupSize) {
    return { ok: false, error: 'Session is at max group size (' + settings.maxGroupSize + ').' };
  }
  let start, end;
  try { start = timeStrToMinutes(logRow.start); end = timeStrToMinutes(logRow.end); } catch (e) {
    return { ok: false, error: 'Bad session time.' };
  }
  const day = normalizeScheduleDay(logRow.day);
  const gradeBlackouts = loadGradeBlackouts();
  const studentConstraints = loadStudentConstraints();
  const blackouts = getStudentBlackouts(student, gradeBlackouts, studentConstraints);
  if ((blackouts[day] || []).some(b => overlaps(start, end, b.start, b.end))) {
    return { ok: false, error: 'Conflicts with a grade or student blackout.' };
  }
  const weekText = normalizeWeekLabel(logRow.week);
  const busy = scheduleLog.some(r => {
    if (String(r.studentId) !== String(studentId)) return false;
    if (normalizeScheduleDay(r.day) !== day) return false;
    const rWeek = normalizeWeekLabel(r.week);
    const sameWeek = rWeek === weekText || rWeek === 'Every Week' || weekText === 'Every Week';
    if (!sameWeek) return false;
    try {
      return overlaps(start, end, timeStrToMinutes(r.start), timeStrToMinutes(r.end));
    } catch (e) { return false; }
  });
  if (busy) return { ok: false, error: 'Already booked at this time.' };
  return { ok: true, student: student };
}

function applyMoveToLogRows(mateRows, candidate) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  const day = candidate.day;
  const startStr = minutesToTimeStr(candidate.start);
  const endStr = minutesToTimeStr(candidate.end);
  mateRows.forEach(r => {
    sheet.getRange(r.sheetRow, 6).setValue(day);
    sheet.getRange(r.sheetRow, 7).setValue(startStr);
    sheet.getRange(r.sheetRow, 8).setValue(endStr);
    sheet.getRange(r.sheetRow, 9).setValue(candidate.end - candidate.start);
  });
}

function applySwapOnLogRows(aMateRows, bMateRows, swapInfo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  aMateRows.forEach(r => {
    sheet.getRange(r.sheetRow, 6).setValue(swapInfo.aGoesTo.day);
    sheet.getRange(r.sheetRow, 7).setValue(minutesToTimeStr(swapInfo.aGoesTo.start));
    sheet.getRange(r.sheetRow, 8).setValue(minutesToTimeStr(swapInfo.aGoesTo.end));
    sheet.getRange(r.sheetRow, 9).setValue(swapInfo.aGoesTo.end - swapInfo.aGoesTo.start);
  });
  bMateRows.forEach(r => {
    sheet.getRange(r.sheetRow, 6).setValue(swapInfo.bGoesTo.day);
    sheet.getRange(r.sheetRow, 7).setValue(minutesToTimeStr(swapInfo.bGoesTo.start));
    sheet.getRange(r.sheetRow, 8).setValue(minutesToTimeStr(swapInfo.bGoesTo.end));
    sheet.getRange(r.sheetRow, 9).setValue(swapInfo.bGoesTo.end - swapInfo.bGoesTo.start);
  });
}

function appendStudentToSessionOnLog(logRow, student) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  let gid = String(logRow.groupId || '').trim();
  if (!gid) {
    gid = 'EDIT-GROUP-' + String(logRow.studentId).trim();
    sessionMateRows(loadScheduleLogObjects(), logRow).forEach(r => {
      sheet.getRange(r.sheetRow, 4).setValue(gid);
    });
  }
  const duration = (() => {
    try { return timeStrToMinutes(logRow.end) - timeStrToMinutes(logRow.start); } catch (e) { return 30; }
  })();
  sheet.appendRow([
    student.id,
    student.firstName + ' ' + student.lastName,
    student.grade,
    gid,
    normalizeWeekLabel(logRow.week),
    normalizeScheduleDay(logRow.day),
    logRow.start,
    logRow.end,
    duration,
    student.teacher || '',
    logRow.locked || ''
  ]);
}

function syncGroupIdOnScheduleLog(studentId, groupId) {
  if (!groupId) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.LOG);
  if (!sheet || sheet.getLastRow() < 2) return;
  const numRows = sheet.getLastRow() - 1;
  const data = sheet.getRange(2, 1, numRows, 11).getValues();
  data.forEach((vals, i) => {
    if (String(vals[0]).trim() === String(studentId).trim()) {
      sheet.getRange(i + 2, 4).setValue(groupId);
    }
  });
}
