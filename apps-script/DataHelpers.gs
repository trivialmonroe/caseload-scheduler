/**
 * Pure helpers and sheet-reading functions with no side effects beyond
 * reading data - time parsing, day-range parsing, and loading each input
 * tab into plain JS objects the scheduling engine works with.
 */

function timeStrToMinutes(t) {
  if (t instanceof Date) return t.getHours() * 60 + t.getMinutes();
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!m) throw new Error('Bad time format: ' + t);
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3];
  if (ampm) {
    if (/PM/i.test(ampm) && h !== 12) h += 12;
    if (/AM/i.test(ampm) && h === 12) h = 0;
  }
  return h * 60 + min;
}

function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function roundToIncrement(mins, inc) {
  return Math.max(inc, Math.round(mins / inc) * inc);
}

function parseDayList(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const lower = s.toLowerCase();

  if (lower === 'all' || lower === 'everyday' || lower === 'every day' || lower === 'mon-fri' || lower === 'monday-friday') {
    return DAYS.slice();
  }

  const rangeMatch = lower.match(/^([a-z]{3,})\s*-\s*([a-z]{3,})$/);
  if (rangeMatch) {
    const startIdx = DAY_INDEX[rangeMatch[1].slice(0, 3)];
    const endIdx = DAY_INDEX[rangeMatch[2].slice(0, 3)];
    if (startIdx !== undefined && endIdx !== undefined && startIdx <= endIdx) {
      return DAYS.slice(startIdx, endIdx + 1);
    }
  }

  const parts = s.split(/[,/&]+/).map(p => p.trim()).filter(Boolean);
  const result = [];
  parts.forEach(p => {
    const idx = DAY_INDEX[p.toLowerCase().slice(0, 3)];
    if (idx !== undefined && result.indexOf(DAYS[idx]) === -1) result.push(DAYS[idx]);
  });
  return result;
}

function getSheetRows(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return values.filter(row => row.some(cell => cell !== '' && cell !== null));
}

function loadSettings() {
  const rows = getSheetRows(SHEET_NAMES.SETTINGS);
  const settings = { slotIncrement: 5, schoolDays: DAYS, minSessionLength: 15, maxSessionLength: 60, weeksPerQuarter: 9, startingWeekPattern: 'A', groupRescueExtraMinutes: 10, maxGroupSize: 6, preferConsistentPattern: true, showTeacherInfo: true, frontLoadFirstSessions: true };
  rows.forEach(r => {
    const key = String(r[0]).trim();
    if (key === 'Slot Increment (min)') settings.slotIncrement = Number(r[1]) || 5;
    if (key === 'School Days') settings.schoolDays = String(r[1]).split(',').map(d => d.trim());
    if (key === 'Min Session Length (min)') settings.minSessionLength = Number(r[1]) || 15;
    if (key === 'Max Session Length (min)') settings.maxSessionLength = Number(r[1]) || 60;
    if (key === 'Weeks Per Quarter') settings.weeksPerQuarter = Math.max(1, Number(r[1]) || 9);
    if (key.indexOf('Starting Week Pattern') === 0) {
      const v = String(r[1]).trim().toUpperCase();
      settings.startingWeekPattern = (v === 'B') ? 'B' : 'A';
    }
    if (key.indexOf('Group Rescue Extra Minutes') === 0) {
      settings.groupRescueExtraMinutes = Math.max(0, Number(r[1]) || 0);
    }
    if (key.indexOf('Max Students Per Auto-Group') === 0) {
      settings.maxGroupSize = Math.max(2, Number(r[1]) || 2);
    }
    if (key.indexOf('Prefer Consistent Weekly Pattern') === 0) {
      settings.preferConsistentPattern = String(r[1]).trim().toLowerCase() !== 'no';
    }
    if (key.indexOf('Show Teacher on Schedule Outputs') === 0) {
      settings.showTeacherInfo = String(r[1]).trim().toLowerCase() !== 'no';
    }
    if (key.indexOf('Front-Load First Sessions') === 0) {
      settings.frontLoadFirstSessions = String(r[1]).trim().toLowerCase() !== 'no';
    }
  });
  if (settings.minSessionLength > settings.maxSessionLength) {
    settings.minSessionLength = settings.maxSessionLength;
  }
  settings.weeksList = [];
  for (let w = 1; w <= settings.weeksPerQuarter; w++) settings.weeksList.push(w);
  return settings;
}

function getWeekPattern(weekNum, settings) {
  const isOddWeek = weekNum % 2 === 1;
  const startsA = settings.startingWeekPattern === 'A';
  if (isOddWeek) return startsA ? 'A' : 'B';
  return startsA ? 'B' : 'A';
}

function loadProviderAvailability() {
  const rows = getSheetRows(SHEET_NAMES.AVAILABILITY);
  const buckets = { ALL: {}, A: {}, B: {} };
  ['ALL', 'A', 'B'].forEach(key => DAYS.forEach(d => buckets[key][d] = []));
  rows.forEach(r => {
    const days = parseDayList(r[0]);
    const entry = { start: timeStrToMinutes(r[1]), end: timeStrToMinutes(r[2]) };
    const patternRaw = String(r[3] || '').trim().toUpperCase();
    const bucket = (patternRaw === 'A' || patternRaw === 'B') ? patternRaw : 'ALL';
    days.forEach(day => buckets[bucket][day].push(entry));
  });
  return buckets;
}

function availabilityForWeek(weekNum, availByPattern, settings) {
  const pattern = getWeekPattern(weekNum, settings);
  const merged = {};
  DAYS.forEach(d => merged[d] = (availByPattern.ALL[d] || []).concat(availByPattern[pattern][d] || []));
  return merged;
}

function effectiveAvailability(weeksToCheck, availByPattern, settings) {
  const perWeekDayMaps = weeksToCheck.map(w => availabilityForWeek(w, availByPattern, settings));
  if (perWeekDayMaps.length === 1) return perWeekDayMaps[0];

  const result = {};
  DAYS.forEach(day => {
    let current = mergeOverlapping(perWeekDayMaps[0][day] || []);
    for (let i = 1; i < perWeekDayMaps.length && current.length; i++) {
      current = intersectWindows(current, perWeekDayMaps[i][day] || []);
    }
    result[day] = current;
  });
  return result;
}

function mergeOverlapping(windows) {
  if (!windows.length) return [];
  const sorted = windows.slice().sort((a, b) => a.start - b.start);
  const merged = [Object.assign({}, sorted[0])];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end);
    else merged.push(Object.assign({}, sorted[i]));
  }
  return merged;
}

function intersectWindows(listA, listB) {
  const result = [];
  listA.forEach(a => {
    listB.forEach(b => {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (start < end) result.push({ start, end });
    });
  });
  return result;
}

function loadGradeBlackouts() {
  const rows = getSheetRows(SHEET_NAMES.GRADES);
  const map = {};
  rows.forEach(r => {
    const grade = String(r[0]).trim();
    const days = parseDayList(r[1]);
    if (!map[grade]) { map[grade] = {}; DAYS.forEach(d => map[grade][d] = []); }
    const entry = { start: timeStrToMinutes(r[2]), end: timeStrToMinutes(r[3]), reason: r[4] || 'Grade schedule' };
    days.forEach(day => map[grade][day].push(entry));
  });
  return map;
}

function loadStudentConstraints() {
  const rows = getSheetRows(SHEET_NAMES.CONSTRAINTS);
  const map = {};
  rows.forEach(r => {
    const id = String(r[0]).trim();
    const days = parseDayList(r[1]);
    if (!map[id]) { map[id] = {}; DAYS.forEach(d => map[id][d] = []); }
    const entry = { start: timeStrToMinutes(r[2]), end: timeStrToMinutes(r[3]), reason: r[4] || 'Other service' };
    days.forEach(day => map[id][day].push(entry));
  });
  return map;
}

function parseGroupIds(value) {
  if (Object.prototype.toString.call(value) === '[object Array]') {
    const out = [];
    value.forEach(v => {
      const s = String(v || '').trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  return String(value == null ? '' : value).split(/[,;|/]+/).map(v => v.trim()).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function loadStudents() {
  const rows = getSheetRows(SHEET_NAMES.STUDENTS);
  return rows.map(r => {
    let fixedStart = null;
    if (r[16]) {
      try { fixedStart = timeStrToMinutes(r[16]); } catch (e) { fixedStart = null; } // bad format - ignore rather than crash the whole run
    }
    const serviceType = String(r[4]).trim();
    const noGroupRaw = String(r[17] == null ? '' : r[17]).trim().toLowerCase();
    const noGroup = (noGroupRaw === 'yes' || noGroupRaw === 'y' || noGroupRaw === 'true' || noGroupRaw === '1')
      && serviceType.toLowerCase() !== 'group';
    const groupIds = noGroup ? [] : parseGroupIds(r[5]);
    return {
      id: String(r[0]).trim(),
      firstName: r[1],
      lastName: r[2],
      grade: String(r[3]).trim(),
      serviceType: serviceType,
      groupIds: groupIds,
      groupId: groupIds[0] || '',
      noGroup: noGroup,
      frequencyType: (String(r[6]).trim().toLowerCase() === 'quarterly') ? 'Quarterly' : 'Weekly',
      minutesPerWeek: Number(r[7]) || 0,
      preferredSessionLength: r[8] ? Number(r[8]) : null,
      sessionsPerQuarter: Number(r[9]) || 0,
      quarterlySessionLength: Number(r[10]) || 0,
      status: String(r[13] || 'Active').trim(),
      teacher: r[14] ? String(r[14]).trim() : '',
      fixedDay: r[15] ? String(r[15]).trim() : '',
      fixedStart: fixedStart
    };
  }).filter(s => s.id && s.status.toLowerCase() === 'active');
}

function loadLockedSessions() {
  const rows = getSheetRows(SHEET_NAMES.LOG);
  const groups = {};
  rows.forEach(r => {
    const locked = String(r[10] || '').trim().toLowerCase() === 'yes';
    if (!locked) return;
    const studentId = String(r[0]).trim();
    const groupId = r[3] ? String(r[3]).trim() : '';
    const reqId = groupId || studentId;
    const weekLabelRaw = String(r[4]).trim();
    const week = normalizeWeekLabel(weekLabelRaw) === 'Every Week' ? ALL_WEEKS_KEY : (Number(String(weekLabelRaw).replace(/[^0-9]/g, '')) || 1);
    const day = normalizeScheduleDay(r[5]);
    let start, end;
    try { start = timeStrToMinutes(r[6]); end = timeStrToMinutes(r[7]); } catch (e) { return; } // skip malformed rows rather than crash
    const key = reqId + '|' + week + '|' + day + '|' + start + '|' + end;
    if (!groups[key]) groups[key] = { reqId, week, day, start, end, studentIds: [] };
    groups[key].studentIds.push(studentId);
  });
  return Object.values(groups);
}

function getStudentBlackouts(student, gradeBlackouts, studentConstraints) {
  const merged = {};
  DAYS.forEach(d => merged[d] = []);
  const gb = gradeBlackouts[student.grade];
  if (gb) DAYS.forEach(d => { merged[d] = merged[d].concat(gb[d] || []); });
  const sc = studentConstraints[student.id];
  if (sc) DAYS.forEach(d => { merged[d] = merged[d].concat(sc[d] || []); });
  return merged;
}

function weeksForEntry(weekValue, settings) {
  return weekValue === ALL_WEEKS_KEY ? settings.weeksList : [weekValue];
}

/** Map quarter week 1/3/5/7/9 → 1 and 2/4/6/8 → 2 for the provider's A/B rotation. */
function twoWeekCycleWeek(weekNum) {
  return ((weekNum - 1) % 2) + 1;
}

/** Day/time already established for this reqId in the odd or even half of the 2-week cycle. */
function establishedTwoWeekCycleSlot(reqId, cycleWeek, scheduled) {
  const match = (scheduled || []).find(s =>
    s.reqId === reqId &&
    s.week !== ALL_WEEKS_KEY &&
    twoWeekCycleWeek(s.week) === cycleWeek
  );
  return match ? { day: match.day, start: match.start } : null;
}

/** When consistent pattern is on, quarterly sessions must reuse their cycle's Week 1/2 template. */
function filterCandidatesForTwoWeekCycle(candidates, session, scheduled, settings) {
  if (!settings.preferConsistentPattern || session.week !== ANY_WEEK_KEY) return candidates;
  const filtered = (candidates || []).filter(c => {
    const template = establishedTwoWeekCycleSlot(session.reqId, twoWeekCycleWeek(c.week), scheduled);
    if (!template) return true;
    return c.day === template.day && c.start === template.start;
  });
  return filtered.length ? filtered : candidates;
}

function weekLabel(week) {
  return week === ALL_WEEKS_KEY ? 'Every Week' : `Week ${week}`;
}

/** Blank / missing week means weekly (every week). */
function normalizeWeekLabel(raw) {
  const w = String(raw || '').trim();
  if (!w || w.toLowerCase() === 'every week') return 'Every Week';
  const n = Number(String(w).replace(/[^0-9]/g, ''));
  if (Number.isFinite(n) && n > 0) return 'Week ' + n;
  return w;
}

/** Map schedule day cells to Mon–Fri (calendar grid + engine use short labels). */
function normalizeScheduleDay(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  const full = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri' };
  if (full[lower]) return full[lower];
  const short = lower.slice(0, 3);
  if (DAY_INDEX[short] !== undefined) return DAYS[DAY_INDEX[short]];
  if (DAYS.indexOf(s) >= 0) return s;
  return s;
}

function gradeSortValue(grade) {
  const g = String(grade).trim().toUpperCase();
  if (g === 'K' || g === 'KG' || g === 'KINDER' || g === 'KINDERGARTEN') return 0;
  const n = parseInt(g, 10);
  return isNaN(n) ? 999 : n;
}
