// ─── Constants (from Constants.gs) ─────────────────────────────────────────
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4 };
const ALL_WEEKS_KEY = 'ALL';
const ANY_WEEK_KEY = 'ANY';

const DEFAULT_SETTINGS = {
  slotIncrement: 5,
  schoolDays: DAYS.slice(),
  minSessionLength: 15,
  maxSessionLength: 60,
  weeksPerQuarter: 9,
  startingWeekPattern: 'A',
  groupRescueExtraMinutes: 10,
  maxGroupSize: 6,
  preferConsistentPattern: true,
  showTeacherInfo: true,
  frontLoadFirstSessions: true,
};

// ─── Data helpers (from DataHelpers.gs) ─────────────────────────────────────
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
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

function overlaps(a, b, c, d) { return a < d && c < b; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function roundToIncrement(mins, inc) { return Math.max(inc, Math.round(mins / inc) * inc); }

function parseDayList(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const lower = s.toLowerCase();
  if (lower === 'all' || lower === 'everyday' || lower === 'every day' || lower === 'mon-fri' || lower === 'monday-friday') return DAYS.slice();
  const rangeMatch = lower.match(/^([a-z]{3,})\s*-\s*([a-z]{3,})$/);
  if (rangeMatch) {
    const startIdx = DAY_INDEX[rangeMatch[1].slice(0, 3)];
    const endIdx = DAY_INDEX[rangeMatch[2].slice(0, 3)];
    if (startIdx !== undefined && endIdx !== undefined && startIdx <= endIdx) return DAYS.slice(startIdx, endIdx + 1);
  }
  const parts = s.split(/[,/&]+/).map(p => p.trim()).filter(Boolean);
  const result = [];
  parts.forEach(p => {
    const idx = DAY_INDEX[p.toLowerCase().slice(0, 3)];
    if (idx !== undefined && result.indexOf(DAYS[idx]) === -1) result.push(DAYS[idx]);
  });
  return result;
}

function buildSettings(raw) {
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  if (raw) Object.assign(settings, raw);
  if (settings.minSessionLength > settings.maxSessionLength) settings.minSessionLength = settings.maxSessionLength;
  settings.weeksList = [];
  for (let w = 1; w <= settings.weeksPerQuarter; w++) settings.weeksList.push(w);
  return settings;
}

function loadProviderAvailability(rows) {
  const buckets = { ALL: {}, A: {}, B: {} };
  ['ALL', 'A', 'B'].forEach(key => DAYS.forEach(d => buckets[key][d] = []));
  (rows || []).forEach(r => {
    const days = parseDayList(r.day);
    const entry = { start: timeStrToMinutes(r.start), end: timeStrToMinutes(r.end) };
    const patternRaw = String(r.pattern || '').trim().toUpperCase();
    const bucket = (patternRaw === 'A' || patternRaw === 'B') ? patternRaw : 'ALL';
    days.forEach(day => buckets[bucket][day].push(entry));
  });
  return buckets;
}

function getWeekPattern(weekNum, settings) {
  const isOddWeek = weekNum % 2 === 1;
  const startsA = settings.startingWeekPattern === 'A';
  return isOddWeek ? (startsA ? 'A' : 'B') : (startsA ? 'B' : 'A');
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
  listA.forEach(a => listB.forEach(b => {
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (start < end) result.push({ start, end });
  }));
  return result;
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

function loadGradeBlackouts(rows) {
  const map = {};
  (rows || []).forEach(r => {
    const grade = String(r.grade).trim();
    const days = parseDayList(r.day);
    if (!map[grade]) { map[grade] = {}; DAYS.forEach(d => map[grade][d] = []); }
    const entry = { start: timeStrToMinutes(r.start), end: timeStrToMinutes(r.end), reason: r.reason || 'Grade schedule' };
    days.forEach(day => map[grade][day].push(entry));
  });
  return map;
}

function loadStudentConstraints(rows) {
  const map = {};
  (rows || []).forEach(r => {
    const id = String(r.studentId).trim();
    const days = parseDayList(r.day);
    if (!map[id]) { map[id] = {}; DAYS.forEach(d => map[id][d] = []); }
    const entry = { start: timeStrToMinutes(r.start), end: timeStrToMinutes(r.end), reason: r.reason || 'Other service' };
    days.forEach(day => map[id][day].push(entry));
  });
  return map;
}

function loadStudents(rows) {
  return (rows || []).map(s => {
    let fixedStart = null;
    if (s.fixedStart) {
      try { fixedStart = timeStrToMinutes(s.fixedStart); } catch (e) { fixedStart = null; }
    }
    return {
      id: String(s.id).trim(),
      firstName: s.firstName,
      lastName: s.lastName,
      grade: String(s.grade).trim(),
      serviceType: String(s.serviceType).trim(),
      groupId: s.groupId ? String(s.groupId).trim() : '',
      frequencyType: (String(s.frequencyType).trim().toLowerCase() === 'quarterly') ? 'Quarterly' : 'Weekly',
      minutesPerWeek: Number(s.minutesPerWeek) || 0,
      preferredSessionLength: s.preferredSessionLength ? Number(s.preferredSessionLength) : null,
      sessionsPerQuarter: Number(s.sessionsPerQuarter) || 0,
      quarterlySessionLength: Number(s.quarterlySessionLength) || 0,
      status: String(s.status || 'Active').trim(),
      teacher: s.teacher ? String(s.teacher).trim() : '',
      fixedDay: s.fixedDay ? String(s.fixedDay).trim() : '',
      fixedStart,
    };
  }).filter(s => s.id && s.status.toLowerCase() === 'active');
}

function loadLockedSessions(logRows) {
  const groups = {};
  (logRows || []).forEach(r => {
    if (String(r.locked || '').trim().toLowerCase() !== 'yes') return;
    const studentId = String(r.studentId).trim();
    const groupId = r.groupId ? String(r.groupId).trim() : '';
    const reqId = groupId || studentId;
    const weekLabelRaw = String(r.week).trim();
    const week = weekLabelRaw === 'Every Week' ? ALL_WEEKS_KEY : (Number(weekLabelRaw.replace(/[^0-9]/g, '')) || 1);
    let start, end;
    try { start = timeStrToMinutes(r.start); end = timeStrToMinutes(r.end); } catch (e) { return; }
    const key = reqId + '|' + week + '|' + r.day + '|' + start + '|' + end;
    if (!groups[key]) groups[key] = { reqId, week, day: r.day, start, end, studentIds: [] };
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

function weekLabel(week) {
  return week === ALL_WEEKS_KEY ? 'Every Week' : 'Week ' + week;
}

function gradeSortValue(grade) {
  const g = String(grade).trim().toUpperCase();
  if (g === 'K' || g === 'KG' || g === 'KINDER' || g === 'KINDERGARTEN') return 0;
  const n = parseInt(g, 10);
  return isNaN(n) ? 999 : n;
}

function emptyBookingsByWeek(weeksList) {
  const obj = {};
  weeksList.forEach(w => { obj[w] = {}; DAYS.forEach(d => obj[w][d] = []); });
  return obj;
}

// ─── Scheduling engine (from SchedulingEngine.gs) ─────────────────────────
function computeWeeklyPlan(minutesPerWeek, settings, preferredLength) {
  const minLen = settings.minSessionLength;
  const maxLen = settings.maxSessionLength;
  const maxDays = settings.schoolDays.length;
  const targetLen = preferredLength ? clamp(preferredLength, minLen, maxLen) : maxLen;
  let n = Math.max(1, Math.ceil(minutesPerWeek / targetLen));
  const cappedDays = n > maxDays;
  if (cappedDays) n = maxDays;
  const base = Math.floor(minutesPerWeek / n);
  const remainder = minutesPerWeek - base * n;
  const lengths = [];
  for (let i = 0; i < n; i++) {
    let len = base + (i < remainder ? 1 : 0);
    len = roundToIncrement(clamp(len, minLen, maxLen), settings.slotIncrement);
    lengths.push(len);
  }
  const deliveredTotal = lengths.reduce((a, b) => a + b, 0);
  return { lengths, cappedDays, deliveredTotal, shortfall: Math.max(0, minutesPerWeek - deliveredTotal) };
}

function buildRequirementSet(reqId, members, settings, warnings) {
  const primary = members[0];
  const hasFixedTime = !!(primary.fixedDay && primary.fixedStart !== null && primary.fixedStart !== undefined);
  if (primary.frequencyType === 'Quarterly') {
    const len = primary.quarterlySessionLength || settings.minSessionLength;
    const n = primary.sessionsPerQuarter || 0;
    const sessions = [];
    for (let i = 1; i <= n; i++) {
      const session = { reqId, members, sessionLength: len, week: ANY_WEEK_KEY, sessionIndex: i, totalSessions: n, scheduled: null };
      if (hasFixedTime) { session.fixedDay = primary.fixedDay; session.fixedStart = primary.fixedStart; }
      sessions.push(session);
    }
    if (len < settings.minSessionLength || len > settings.maxSessionLength) {
      warnings.push({ members, reqId, message: 'Quarterly session length (' + len + ' min) outside Min/Max.' });
    }
    return sessions;
  }
  const plan = computeWeeklyPlan(primary.minutesPerWeek, settings, primary.preferredSessionLength);
  const sessions = plan.lengths.map((len, idx) => {
    const session = { reqId, members, sessionLength: len, week: ALL_WEEKS_KEY, sessionIndex: idx + 1, totalSessions: plan.lengths.length, scheduled: null };
    if (hasFixedTime && idx === 0) { session.fixedDay = primary.fixedDay; session.fixedStart = primary.fixedStart; }
    return session;
  });
  if (plan.shortfall > 0) {
    warnings.push({ members, reqId, message: 'Needs ' + primary.minutesPerWeek + ' min/week but max deliverable is ' + plan.deliveredTotal + ' min/week.' });
  }
  return sessions;
}

function buildRequirements(students, settings) {
  const requirements = [];
  const warnings = [];
  const groups = {};
  students.forEach(s => {
    if (s.serviceType.toLowerCase() === 'group' && s.groupId) {
      if (!groups[s.groupId]) groups[s.groupId] = [];
      groups[s.groupId].push(s);
    } else {
      requirements.push(buildRequirementSet(s.id, [s], settings, warnings));
    }
  });
  Object.keys(groups).forEach(gid => requirements.push(buildRequirementSet(gid, groups[gid], settings, warnings)));
  return { requirements, warnings };
}

function findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, excludeDays, reqDaysUsed) {
  const duration = session.sessionLength;
  const memberBlackouts = session.members.map(m => getStudentBlackouts(m, gradeBlackouts, studentConstraints));
  const reqId = session.reqId;
  function candidatesForWeekSet(weeksToCheck, excluded) {
    const candidates = [];
    const providerAvail = effectiveAvailability(weeksToCheck, availByPattern, settings);
    DAYS.forEach(day => {
      if (excluded.indexOf(day) !== -1) return;
      (providerAvail[day] || []).forEach(win => {
        for (let start = win.start; start + duration <= win.end; start += settings.slotIncrement) {
          const end = start + duration;
          const providerBusy = weeksToCheck.some(w => (providerBookingsByWeek[w][day] || []).some(b => overlaps(start, end, b.start, b.end)));
          if (providerBusy) continue;
          const memberConflict = session.members.some((m, idx) => {
            if ((memberBlackouts[idx][day] || []).some(b => overlaps(start, end, b.start, b.end))) return true;
            return weeksToCheck.some(w => (memberBookingsByWeek[m.id][w][day] || []).some(b => overlaps(start, end, b.start, b.end)));
          });
          if (memberConflict) continue;
          candidates.push({ day, start, end });
        }
      });
    });
    return candidates;
  }
  if (session.week === ANY_WEEK_KEY) {
    let all = [];
    settings.weeksList.forEach(w => {
      const excluded = (reqDaysUsed && reqDaysUsed[reqId] && reqDaysUsed[reqId][String(w)]) || [];
      candidatesForWeekSet([w], excluded).forEach(c => all.push({ week: w, day: c.day, start: c.start, end: c.end }));
    });
    return all;
  }
  const weeksToCheck = weeksForEntry(session.week, settings);
  return candidatesForWeekSet(weeksToCheck, excludeDays || []).map(c => Object.assign({ week: session.week }, c));
}

function isReqIdRepresented(scheduled, session) {
  return session.members.some(sm => scheduled.some(s => s.members.some(m => m.id === sm.id)));
}

function tryJoinCompatibleHost(student, sessionLength, needsEveryWeek, hostCandidates, settings, gradeBlackouts, studentConstraints, memberBookingsByWeek, reqDaysUsed, groupIdState) {
  const blackouts = getStudentBlackouts(student, gradeBlackouts, studentConstraints);
  const candidates = hostCandidates.filter(entry => {
    if (entry.members.some(m => m.id === student.id)) return false;
    if (entry.members.length >= settings.maxGroupSize) return false;
    const hostIsEveryWeek = entry.week === ALL_WEEKS_KEY;
    if (needsEveryWeek !== hostIsEveryWeek) return false;
    const extra = (entry.end - entry.start) - sessionLength;
    return extra >= 0 && extra <= settings.groupRescueExtraMinutes;
  });
  candidates.sort((a, b) => {
    const da = Math.min.apply(null, a.members.map(m => Math.abs(gradeSortValue(m.grade) - gradeSortValue(student.grade))));
    const db = Math.min.apply(null, b.members.map(m => Math.abs(gradeSortValue(m.grade) - gradeSortValue(student.grade))));
    if (da !== db) return da - db;
    return ((a.end - a.start) - sessionLength) - ((b.end - b.start) - sessionLength);
  });
  for (let i = 0; i < candidates.length; i++) {
    const host = candidates[i];
    const weeksToCheck = weeksForEntry(host.week, settings);
    if ((blackouts[host.day] || []).some(b => overlaps(host.start, host.end, b.start, b.end))) continue;
    const weekKeyForHost = String(host.week);
    const daysAlreadyUsed = (reqDaysUsed[student.id] && reqDaysUsed[student.id][weekKeyForHost]) || [];
    if (daysAlreadyUsed.indexOf(host.day) !== -1) continue;
    const ownConflict = weeksToCheck.some(w => (memberBookingsByWeek[student.id][w][host.day] || []).some(b => overlaps(host.start, host.end, b.start, b.end)));
    if (ownConflict) continue;
    if (!host.groupId) { groupIdState.counter++; host.groupId = 'AUTO-GROUP-' + groupIdState.counter; }
    host.members = host.members.map(m => Object.assign({}, m, { groupId: host.groupId }));
    host.members.push(Object.assign({}, student, { groupId: host.groupId }));
    weeksToCheck.forEach(w => memberBookingsByWeek[student.id][w][host.day].push({ start: host.start, end: host.end }));
    if (!reqDaysUsed[student.id]) reqDaysUsed[student.id] = {};
    if (!reqDaysUsed[student.id][weekKeyForHost]) reqDaysUsed[student.id][weekKeyForHost] = [];
    reqDaysUsed[student.id][weekKeyForHost].push(host.day);
    return host;
  }
  return null;
}

function frontLoadFirstSessionsIntoEarlyWeeks(pending, scheduled, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, reqDaysUsed, individualsById, groupIdState) {
  if (!settings.frontLoadFirstSessions) return;
  const byReqId = {};
  pending.forEach(session => {
    if (session.week !== ANY_WEEK_KEY) return;
    if (isReqIdRepresented(scheduled, session)) return;
    if (!byReqId[session.reqId] || session.sessionLength > byReqId[session.reqId].sessionLength) byReqId[session.reqId] = session;
  });
  Object.values(byReqId).sort((a, b) => b.sessionLength - a.sessionLength).forEach(session => {
    const allCandidates = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, [], reqDaysUsed);
    const earlyOnly = allCandidates.filter(c => c.week <= 2).sort((a, b) => a.week - b.week || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start);
    if (earlyOnly.length) {
      const pick = earlyOnly[0];
      providerBookingsByWeek[pick.week][pick.day].push({ start: pick.start, end: pick.end });
      session.members.forEach(m => memberBookingsByWeek[m.id][pick.week][pick.day].push({ start: pick.start, end: pick.end }));
      const weekKey = String(pick.week);
      if (!reqDaysUsed[session.reqId]) reqDaysUsed[session.reqId] = {};
      if (!reqDaysUsed[session.reqId][weekKey]) reqDaysUsed[session.reqId][weekKey] = [];
      reqDaysUsed[session.reqId][weekKey].push(pick.day);
      scheduled.push({ reqId: session.reqId, members: session.members, week: pick.week, day: pick.day, start: pick.start, end: pick.end, sessionIndex: session.sessionIndex, totalSessions: session.totalSessions });
      const idx = pending.indexOf(session);
      if (idx !== -1) pending.splice(idx, 1);
      return;
    }
    const primary = session.members[0];
    if (session.members.length !== 1 || !individualsById[primary.id]) return;
    const hostCandidates = scheduled.filter(entry => (entry.week === 1 || entry.week === 2) && entry.members.every(m => individualsById[m.id]));
    const host = tryJoinCompatibleHost(primary, session.sessionLength, false, hostCandidates, settings, gradeBlackouts, studentConstraints, memberBookingsByWeek, reqDaysUsed, groupIdState);
    if (host) { const idx = pending.indexOf(session); if (idx !== -1) pending.splice(idx, 1); }
  });
}

function attemptGroupRescue(unscheduled, scheduled, individualsById, settings, gradeBlackouts, studentConstraints, memberBookingsByWeek, reqDaysUsed, groupIdState) {
  const rescuedUnscheduledEntries = [];
  let remaining = unscheduled.filter(u => u.session.members.length === 1 && individualsById[u.session.members[0].id]);
  let progress = true;
  while (progress && remaining.length > 0) {
    progress = false;
    remaining.sort((a, b) => b.session.sessionLength - a.session.sessionLength);
    const stillRemaining = [];
    for (let idx = 0; idx < remaining.length; idx++) {
      const u = remaining[idx];
      const session = u.session;
      const student = session.members[0];
      const needsEveryWeek = session.week === ALL_WEEKS_KEY;
      const hostCandidates = scheduled.filter(entry => entry.members.every(m => individualsById[m.id]));
      const host = tryJoinCompatibleHost(student, session.sessionLength, needsEveryWeek, hostCandidates, settings, gradeBlackouts, studentConstraints, memberBookingsByWeek, reqDaysUsed, groupIdState);
      if (host) { rescuedUnscheduledEntries.push(u); progress = true; continue; }
      stillRemaining.push(u);
    }
    remaining = stillRemaining;
  }
  return rescuedUnscheduledEntries;
}

function runSchedulingEngine(input) {
  const settings = buildSettings(input.settings);
  const availByPattern = loadProviderAvailability(input.availability);
  const gradeBlackouts = loadGradeBlackouts(input.grades);
  const studentConstraints = loadStudentConstraints(input.constraints);
  const students = loadStudents(input.students);
  if (!students.length) return { error: 'No active students.' };

  const lockedSessions = loadLockedSessions(input.scheduleLog);
  const studentsById = {};
  students.forEach(s => { studentsById[s.id] = s; });
  const individualsById = {};
  students.forEach(s => { if (s.serviceType.toLowerCase() === 'individual') individualsById[s.id] = s; });
  const groupIdState = { counter: 0 };

  const { requirements: requirementSets, warnings: capacityWarnings } = buildRequirements(students, settings);
  let pending = [].concat.apply([], requirementSets);
  const providerBookingsByWeek = emptyBookingsByWeek(settings.weeksList);
  const memberBookingsByWeek = {};
  students.forEach(s => { memberBookingsByWeek[s.id] = emptyBookingsByWeek(settings.weeksList); });
  const reqDaysUsed = {};
  const scheduled = [];
  let unscheduled = [];

  lockedSessions.forEach(ls => {
    const members = ls.studentIds.map(id => studentsById[id]).filter(Boolean);
    if (!members.length) return;
    const naturalReqIds = new Set();
    members.forEach(m => naturalReqIds.add((m.serviceType.toLowerCase() === 'group' && m.groupId) ? m.groupId : m.id));
    const duration = ls.end - ls.start;
    naturalReqIds.forEach(reqId => {
      let bestIdx = -1, bestDiff = Infinity;
      pending.forEach((session, idx) => {
        if (session.reqId !== reqId) return;
        const diff = Math.abs(session.sessionLength - duration);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = idx; }
      });
      if (bestIdx !== -1) pending.splice(bestIdx, 1);
    });
    weeksForEntry(ls.week, settings).forEach(w => {
      providerBookingsByWeek[w][ls.day].push({ start: ls.start, end: ls.end });
      members.forEach(m => memberBookingsByWeek[m.id][w][ls.day].push({ start: ls.start, end: ls.end }));
    });
    const weekKey = String(ls.week);
    if (!reqDaysUsed[ls.reqId]) reqDaysUsed[ls.reqId] = {};
    if (!reqDaysUsed[ls.reqId][weekKey]) reqDaysUsed[ls.reqId][weekKey] = [];
    reqDaysUsed[ls.reqId][weekKey].push(ls.day);
    scheduled.push({ reqId: ls.reqId, members, week: ls.week, day: ls.day, start: ls.start, end: ls.end, sessionIndex: 0, totalSessions: 0, locked: true });
  });

  const fixedPending = pending.filter(s => s.fixedDay && s.fixedStart != null);
  pending = pending.filter(s => !(s.fixedDay && s.fixedStart != null));
  fixedPending.forEach(session => {
    const weekKey = String(session.week);
    const excludeDays = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][weekKey]) || [];
    const matches = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, excludeDays, reqDaysUsed)
      .filter(c => c.day === session.fixedDay && c.start === session.fixedStart);
    if (!matches.length) {
      unscheduled.push({ session, reason: 'Fixed time unavailable' });
      return;
    }
    matches.sort((a, b) => {
      const usedA = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][String(a.week)]) || [];
      const usedB = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][String(b.week)]) || [];
      if (usedA.length !== usedB.length) return usedA.length - usedB.length;
      return (a.week === ALL_WEEKS_KEY ? 0 : a.week) - (b.week === ALL_WEEKS_KEY ? 0 : b.week);
    });
    const match = matches[0];
    weeksForEntry(match.week, settings).forEach(w => {
      providerBookingsByWeek[w][match.day].push({ start: match.start, end: match.end });
      session.members.forEach(m => memberBookingsByWeek[m.id][w][match.day].push({ start: match.start, end: match.end }));
    });
    const wk = String(match.week);
    if (!reqDaysUsed[session.reqId]) reqDaysUsed[session.reqId] = {};
    if (!reqDaysUsed[session.reqId][wk]) reqDaysUsed[session.reqId][wk] = [];
    reqDaysUsed[session.reqId][wk].push(match.day);
    scheduled.push({ reqId: session.reqId, members: session.members, week: match.week, day: match.day, start: match.start, end: match.end, sessionIndex: session.sessionIndex, totalSessions: session.totalSessions });
  });

  frontLoadFirstSessionsIntoEarlyWeeks(pending, scheduled, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, reqDaysUsed, individualsById, groupIdState);

  while (pending.length > 0) {
    let bestIdx = -1, bestCandidates = null, bestCount = Infinity, bestIsFirstOcc = false;
    pending.forEach((session, idx) => {
      const weekKey = String(session.week);
      const excludeDays = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][weekKey]) || [];
      const cands = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, excludeDays, reqDaysUsed);
      const isFirstOcc = settings.frontLoadFirstSessions && session.week === ANY_WEEK_KEY && !isReqIdRepresented(scheduled, session);
      const better = cands.length < bestCount ||
        (cands.length === bestCount && isFirstOcc && !bestIsFirstOcc) ||
        (cands.length === bestCount && isFirstOcc === bestIsFirstOcc && bestIdx !== -1 && session.sessionLength > pending[bestIdx].sessionLength);
      if (better) { bestCount = cands.length; bestIdx = idx; bestCandidates = cands; bestIsFirstOcc = isFirstOcc; }
    });
    const session = pending[bestIdx];
    if (bestCandidates.length === 0) {
      unscheduled.push({ session, reason: 'No slot satisfies availability + blackouts + one-session-per-day limit' });
      pending.splice(bestIdx, 1);
      continue;
    }
    const reqWeekLoad = (c) => session.week !== ANY_WEEK_KEY ? 0 : ((reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][String(c.week)]) || []).length;
    const isFirstOccurrence = !isReqIdRepresented(scheduled, session);
    const earlyStartBonus = (c) => (!settings.frontLoadFirstSessions || session.week !== ANY_WEEK_KEY || !isFirstOccurrence) ? 0 : ((c.week === ALL_WEEKS_KEY ? 0 : c.week) <= 2 ? 0 : 1);
    const matchesEstablishedPattern = (c) => (!settings.preferConsistentPattern || session.week !== ANY_WEEK_KEY) ? 0 : (scheduled.some(s => s.reqId === session.reqId && s.day === c.day && s.start === c.start) ? 0 : 1);
    const dayLoad = (c) => weeksForEntry(c.week, settings).reduce((sum, w) => sum + ((providerBookingsByWeek[w][c.day] || []).length), 0);
    bestCandidates.sort((a, b) => {
      let d = reqWeekLoad(a) - reqWeekLoad(b); if (d) return d;
      d = earlyStartBonus(a) - earlyStartBonus(b); if (d) return d;
      d = matchesEstablishedPattern(a) - matchesEstablishedPattern(b); if (d) return d;
      d = dayLoad(a) - dayLoad(b); if (d) return d;
      const wa = a.week === ALL_WEEKS_KEY ? 0 : a.week, wb = b.week === ALL_WEEKS_KEY ? 0 : b.week;
      if (wa !== wb) return wa - wb;
      return DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start;
    });
    const pick = bestCandidates[0];
    weeksForEntry(pick.week, settings).forEach(w => {
      providerBookingsByWeek[w][pick.day].push({ start: pick.start, end: pick.end });
      session.members.forEach(m => memberBookingsByWeek[m.id][w][pick.day].push({ start: pick.start, end: pick.end }));
    });
    const weekKey = String(pick.week);
    if (!reqDaysUsed[session.reqId]) reqDaysUsed[session.reqId] = {};
    if (!reqDaysUsed[session.reqId][weekKey]) reqDaysUsed[session.reqId][weekKey] = [];
    reqDaysUsed[session.reqId][weekKey].push(pick.day);
    scheduled.push({ reqId: session.reqId, members: session.members, week: pick.week, day: pick.day, start: pick.start, end: pick.end, sessionIndex: session.sessionIndex, totalSessions: session.totalSessions });
    pending.splice(bestIdx, 1);
  }

  const rescuedEntries = attemptGroupRescue(unscheduled, scheduled, individualsById, settings, gradeBlackouts, studentConstraints, memberBookingsByWeek, reqDaysUsed, groupIdState);
  if (rescuedEntries.length) {
    const rescuedSet = new Set(rescuedEntries);
    unscheduled = unscheduled.filter(u => !rescuedSet.has(u));
  }
  const rescuedStudentCount = rescuedEntries.length;
  const review = buildScheduleReview(scheduled, unscheduled, capacityWarnings, students);
  const logRows = flattenScheduleLog(scheduled);
  return { scheduled, unscheduled, capacityWarnings, rescuedStudentCount, review, logRows, sessionCount: scheduled.length };
}

function flattenScheduleLog(scheduled) {
  return scheduled.slice().sort((a, b) => {
    const aw = a.week === ALL_WEEKS_KEY ? 0 : a.week;
    const bw = b.week === ALL_WEEKS_KEY ? 0 : b.week;
    return aw - bw || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start;
  }).flatMap(s => s.members.map(m => ({
    studentId: m.id,
    name: m.firstName + ' ' + m.lastName,
    grade: m.grade,
    groupId: m.groupId || s.groupId || '',
    week: weekLabel(s.week),
    day: s.day,
    start: minutesToTimeStr(s.start),
    end: minutesToTimeStr(s.end),
    duration: s.end - s.start,
    teacher: m.teacher || '',
    locked: s.locked ? 'Yes' : '',
  })));
}

function buildScheduleReview(scheduled, unscheduled, capacityWarnings, students) {
  const scheduledByStudent = {};
  scheduled.forEach(s => {
    const minutes = s.end - s.start;
    s.members.forEach(m => { scheduledByStudent[m.id] = (scheduledByStudent[m.id] || 0) + minutes; });
  });
  const reasonsByStudent = {};
  unscheduled.forEach(u => u.session.members.forEach(m => {
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
    return { id: s.id, name: s.firstName + ' ' + s.lastName, grade: s.grade, freq: s.frequencyType, required, scheduled: scheduledMinutes, diff, pct, status, notes: (reasonsByStudent[s.id] || []).join(' | ') };
  }).sort((a, b) => a.pct - b.pct);
}


function applySettingsAliases(settings) { return settings; }

const _buildSettingsOrig = buildSettings;
buildSettings = function(raw) { return applySettingsAliases(_buildSettingsOrig(raw)); };

const _loadStudentsOrig = loadStudents;
loadStudents = function(rows) {
  return _loadStudentsOrig((rows || []).map(s => Object.assign({}, s, {
    firstName: s.firstName || s.firstName || '',
    lastName: s.lastName || s.lastName || '',
    serviceType: s.serviceType || s.serviceType || 'Individual',
    groupId: s.groupId || s.groupId || '',
    frequencyType: s.frequencyType || s.frequencyType || 'Weekly',
    minutesPerWeek: s.minutesPerWeek || s.minutesPerWeek || 0,
    preferredSessionLength: s.preferredSessionLength || s.preferredSessionLength || '',
    sessionsPerQuarter: s.sessionsPerQuarter || s.sessionsPerQuarter || '',
    quarterlySessionLength: s.quarterlySessionLength || s.quarterlySessionLength || '',
    teacher: s.teacher || s.teacher || '',
    fixedDay: s.fixedDay || s.fixedDay || '',
    fixedStart: s.fixedStart || s.fixedStart || '',
    notes: s.notes || '',
  })));
};


// ── Open slots, alternatives, calendar model ────────────────────────────────
function computeOpenSlots(input) {
  const settings = buildSettings(input.settings);
  const availByPattern = loadProviderAvailability(input.availability);
  const gradeBlackouts = loadGradeBlackouts(input.grades);
  const students = loadStudents(input.students);
  const gradeSet = {};
  students.forEach(s => { if (s.grade) gradeSet[s.grade] = true; });
  Object.keys(gradeBlackouts).forEach(g => { if (g) gradeSet[g] = true; });
  const grades = Object.keys(gradeSet).sort((a, b) => gradeSortValue(a) - gradeSortValue(b));
  let minStart = Infinity, maxEnd = -Infinity;
  ['ALL', 'A', 'B'].forEach(p => DAYS.forEach(d => (availByPattern[p][d] || []).forEach(w => {
    minStart = Math.min(minStart, w.start);
    maxEnd = Math.max(maxEnd, w.end);
  })));
  if (!isFinite(minStart)) return { error: 'Set availability first.', blocks: [], grades: [] };
  const hasAlternating = DAYS.some(d => (availByPattern.A[d] || []).length || (availByPattern.B[d] || []).length);
  const patternsToShow = hasAlternating ? ['A', 'B'] : ['ALL'];
  const inc = 15;
  const rowsCount = Math.max(1, Math.ceil((maxEnd - minStart) / inc));
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
      const cells = [];
      let openMinutes = 0;
      for (let i = 0; i < rowsCount; i++) {
        const t = minStart + i * inc;
        const row = { time: t, timeLabel: minutesToTimeStr(t), days: {} };
        DAYS.forEach(day => {
          const availWindow = (providerAvail[day] || []).find(w => t >= w.start && t < w.end);
          if (!availWindow) row.days[day] = { kind: 'off', label: '' };
          else {
            const blocked = (blackouts[day] || []).find(b => t >= b.start && t < b.end);
            if (blocked) row.days[day] = { kind: 'blocked', label: blocked.reason || 'Blocked' };
            else { row.days[day] = { kind: 'open', label: '' }; openMinutes += inc; }
          }
        });
        cells.push(row);
      }
      blocks.push({ grade, pattern, cells, openMinutes });
    });
  });
  blocks.sort((a, b) => a.openMinutes - b.openMinutes);
  return { blocks, grades, hasAlternating, minStart, maxEnd };
}

function findAlternativeSlots(input, logRow) {
  const settings = buildSettings(input.settings);
  const availByPattern = loadProviderAvailability(input.availability);
  const gradeBlackouts = loadGradeBlackouts(input.grades);
  const studentConstraints = loadStudentConstraints(input.constraints);
  const students = loadStudents(input.students);
  const student = students.find(s => s.id === logRow.studentId);
  if (!student) return { error: 'Student not found (may be inactive).', candidates: [] };
  const weekText = String(logRow.week || '').trim();
  const isAllWeeks = weekText === 'Every Week' || weekText === '';
  const weekNum = isAllWeeks ? ALL_WEEKS_KEY : Number(String(weekText).replace(/[^0-9]/g, ''));
  const providerBookingsByWeek = emptyBookingsByWeek(settings.weeksList);
  const memberBookingsByWeek = {};
  students.forEach(s => { memberBookingsByWeek[s.id] = emptyBookingsByWeek(settings.weeksList); });
  const excludeGroupId = student.groupId;
  (input.scheduleLog || []).forEach(r => {
    const rowStudentId = String(r.studentId).trim();
    const rowGroupId = String(r.groupId || '').trim();
    const isSameEntity = rowStudentId === student.id || (excludeGroupId && rowGroupId === excludeGroupId);
    if (isSameEntity) return;
    const rWeekText = String(r.week || '').trim();
    const rIsAll = rWeekText === 'Every Week';
    let start, end;
    try { start = timeStrToMinutes(r.start); end = timeStrToMinutes(r.end); } catch (e) { return; }
    const weeksHit = rIsAll ? settings.weeksList : [Number(String(rWeekText).replace(/[^0-9]/g, ''))];
    weeksHit.forEach(w => {
      if (!providerBookingsByWeek[w]) return;
      providerBookingsByWeek[w][r.day].push({ start, end });
      if (memberBookingsByWeek[rowStudentId] && memberBookingsByWeek[rowStudentId][w]) {
        memberBookingsByWeek[rowStudentId][w][r.day].push({ start, end });
      }
    });
  });
  const members = excludeGroupId ? students.filter(s => s.groupId === excludeGroupId) : [student];
  let sessionLength;
  try { sessionLength = timeStrToMinutes(logRow.end) - timeStrToMinutes(logRow.start); } catch (e) { sessionLength = settings.minSessionLength; }
  const session = { members, sessionLength, week: weekNum, reqId: student.id };
  const candidates = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, [], {});
  return { student, isAllWeeks, weekNum, candidates: candidates.slice(0, 24) };
}

function buildCalendarModel(logRows, settings, showAllWeeks) {
  settings = buildSettings(settings);
  const sessions = (logRows || []).map(r => ({
    grade: String(r.grade || '').trim(),
    groupId: r.groupId ? String(r.groupId).trim() : '',
    name: r.name,
    weekLabel: String(r.week || '').trim(),
    day: r.day,
    start: timeStrToMinutes(r.start),
    end: timeStrToMinutes(r.end),
    teacher: r.teacher ? String(r.teacher).trim() : '',
    studentId: r.studentId
  }));
  const entryMap = {};
  sessions.forEach(s => {
    const key = s.weekLabel + '|' + s.day + '|' + s.start + '|' + s.end + '|' + (s.groupId || s.name);
    if (!entryMap[key]) entryMap[key] = { weekLabel: s.weekLabel, day: s.day, start: s.start, end: s.end, grade: s.grade, names: [], teachers: [], studentIds: [] };
    entryMap[key].names.push(s.name);
    entryMap[key].studentIds.push(s.studentId);
    if (s.teacher && entryMap[key].teachers.indexOf(s.teacher) === -1) entryMap[key].teachers.push(s.teacher);
  });
  const entries = Object.values(entryMap);
  const distinctGrades = Array.from(new Set(entries.map(e => e.grade))).sort((a, b) => gradeSortValue(a) - gradeSortValue(b));
  const palette = [
    { bg: '#7C5CFC', text: '#FFFFFF' }, { bg: '#00BFA5', text: '#FFFFFF' },
    { bg: '#FF6B35', text: '#FFFFFF' }, { bg: '#EC4899', text: '#FFFFFF' },
    { bg: '#2E86F0', text: '#FFFFFF' }, { bg: '#F5A623', text: '#1A1200' },
    { bg: '#26C281', text: '#FFFFFF' }, { bg: '#EF4444', text: '#FFFFFF' }
  ];
  const gradeColors = {};
  distinctGrades.forEach((g, i) => { gradeColors[g] = palette[i % palette.length]; });
  const hasSpecificWeeks = entries.some(e => e.weekLabel !== 'Every Week');
  const weeksToShow = hasSpecificWeeks ? settings.weeksList.slice() : [1];
  const weekPairs = [];
  if (showAllWeeks && hasSpecificWeeks) {
    for (let i = 0; i < weeksToShow.length; i += 2) weekPairs.push(weeksToShow.slice(i, i + 2));
  } else {
    weekPairs.push(weeksToShow.slice(0, 2));
  }
  let minStart = Infinity, maxEnd = -Infinity;
  entries.forEach(e => { minStart = Math.min(minStart, e.start); maxEnd = Math.max(maxEnd, e.end); });
  if (!isFinite(minStart)) { minStart = timeStrToMinutes('8:00 AM'); maxEnd = timeStrToMinutes('3:00 PM'); }
  minStart = Math.floor(minStart / 15) * 15;
  maxEnd = Math.ceil(maxEnd / 15) * 15;
  const inc = 15;
  const rowsCount = Math.max(1, Math.ceil((maxEnd - minStart) / inc));
  return { entries, distinctGrades, gradeColors, hasSpecificWeeks, weekPairs, minStart, maxEnd, inc, rowsCount, settings };
}

function validateCaseload(state) {
  const settings = buildSettings(state.settings);
  const issues = [];
  const students = state.students || [];
  const gradeRows = state.grades || [];
  const gradesInUse = {};
  gradeRows.forEach(r => { gradesInUse[String(r.grade).trim()] = true; });
  const groupMembers = {};
  students.forEach(s => {
    if (String(s.status || 'Active').toLowerCase() !== 'active') return;
    const id = String(s.id || '').trim();
    const label = id || '(blank ID)';
    const freq = String(s.frequencyType || s.frequencyType || '').trim();
    if (freq !== 'Weekly' && freq !== 'Quarterly') issues.push(label + ': Frequency must be Weekly or Quarterly.');
    const service = String(s.serviceType || s.serviceType || '').trim();
    const gid = String(s.groupId || s.groupId || '').trim();
    if (service === 'Group') {
      if (!gid) issues.push(label + ': Group service needs a Group ID.');
      else {
        if (!groupMembers[gid]) groupMembers[gid] = [];
        groupMembers[gid].push({ id: label, freq, minutes: s.minutesPerWeek, sessionsQ: s.sessionsPerQuarter, lenQ: s.quarterlySessionLength });
      }
    }
    const grade = String(s.grade || '').trim();
    if (grade && !gradesInUse[grade]) issues.push(label + ': Grade "' + grade + '" has no grade-level blocks (lunch/specials will not apply).');
    if (freq === 'Weekly' && !(Number(s.minutesPerWeek) > 0)) issues.push(label + ': Weekly student needs minutes/week.');
    if (freq === 'Quarterly' && (!(Number(s.sessionsPerQuarter) > 0) || !(Number(s.quarterlySessionLength) > 0))) issues.push(label + ': Quarterly student needs sessions/quarter and length.');
  });
  Object.keys(groupMembers).forEach(gid => {
    const members = groupMembers[gid];
    if (members.length < 2) issues.push('Group "' + gid + '" has only 1 active member.');
  });
  if (!(state.availability || []).length) issues.push('Add at least one availability window.');
  if (settings.minSessionLength > settings.maxSessionLength) issues.push('Min session length is greater than max.');
  return issues;
}

// ── CSV / JSON workspace ────────────────────────────────────────────────────
const CSV_SCHEMAS = {
  students: ['id','firstName','lastName','grade','serviceType','groupId','frequencyType','minutesPerWeek','preferredSessionLength','sessionsPerQuarter','quarterlySessionLength','notes','status','teacher','fixedDay','fixedStart'],
  availability: ['day','start','end','pattern','notes'],
  grades: ['grade','day','start','end','reason'],
  constraints: ['studentId','day','start','end','reason'],
  schedule: ['studentId','name','grade','groupId','week','day','start','end','duration','teacher','locked']
};

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', i = 0, inQ = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  while (i < s.length) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i+1] === '"') { cell += '"'; i += 2; continue; } inQ = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n' || (ch === '\r' && s[i+1] === '\n')) { row.push(cell); rows.push(row); row = []; cell = ''; i += (ch === '\r' ? 2 : 1); continue; }
    if (ch === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function toCsv(rows) {
  return rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] != null ? r[i] : ''; });
    return o;
  });
}

function objectsToCsv(objs, columns) {
  const cols = columns || (objs[0] ? Object.keys(objs[0]) : []);
  return toCsv([cols].concat((objs || []).map(o => cols.map(c => o[c] != null ? o[c] : ''))));
}

function detectCsvKind(headers) {
  const h = headers.map(x => x.toLowerCase());
  if (h.includes('minutesperweek') || h.includes('frequencytype') || h.includes('firstname')) return 'students';
  if (h.includes('pattern') && h.includes('start')) return 'availability';
  if (h.includes('reason') && h.includes('grade')) return 'grades';
  if (h.includes('studentid') && h.includes('reason')) return 'constraints';
  if (h.includes('locked') || h.includes('duration')) return 'schedule';
  return null;
}

function normalizeImportedStudent(o) {
  const get = (...keys) => {
    for (let i = 0; i < keys.length; i++) {
      const k = Object.keys(o).find(x => x.toLowerCase().replace(/[\s_]/g,'') === keys[i].toLowerCase().replace(/[\s_]/g,''));
      if (k && o[k] !== undefined && o[k] !== '') return o[k];
    }
    return '';
  };
  return {
    id: get('id', 'studentId', 'Student ID'),
    firstName: get('firstName', 'First Name', 'first'),
    lastName: get('lastName', 'Last Name', 'last'),
    grade: get('grade'),
    serviceType: get('serviceType', 'Service Type') || 'Individual',
    groupId: get('groupId', 'Group ID'),
    frequencyType: get('frequencyType', 'Frequency Type') || 'Weekly',
    minutesPerWeek: get('minutesPerWeek', 'Minutes/Week'),
    preferredSessionLength: get('preferredSessionLength', 'Preferred Session Length'),
    sessionsPerQuarter: get('sessionsPerQuarter', 'Sessions Per Quarter'),
    quarterlySessionLength: get('quarterlySessionLength', 'Session Length (Quarterly)'),
    notes: get('notes'),
    status: get('status') || 'Active',
    teacher: get('teacher'),
    fixedDay: get('fixedDay', 'Fixed Day'),
    fixedStart: get('fixedStart', 'Fixed Start Time', 'fixedStartTime'),
  };
}

if (typeof window !== 'undefined') {
  window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  window.CSV_SCHEMAS = CSV_SCHEMAS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DAYS, DEFAULT_SETTINGS, buildSettings, runSchedulingEngine, validateCaseload,
    computeOpenSlots, findAlternativeSlots, buildCalendarModel,
    parseCsv, toCsv, csvToObjects, objectsToCsv, detectCsvKind, normalizeImportedStudent,
    CSV_SCHEMAS, loadStudents, minutesToTimeStr, timeStrToMinutes
  };
}
