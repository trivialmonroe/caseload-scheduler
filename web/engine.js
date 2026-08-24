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

function truthyFlag(v) {
  if (v === true || v === 1) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1';
}

function parseGroupIds(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v || '').trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  }
  return String(value == null ? '' : value)
    .split(/[,;|/]+/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

function loadStudents(rows) {
  return (rows || []).map(s => {
    let fixedStart = null;
    if (s.fixedStart) {
      try { fixedStart = timeStrToMinutes(s.fixedStart); } catch (e) { fixedStart = null; }
    }
    const serviceType = String(s.serviceType).trim();
    const noGroup = truthyFlag(s.noGroup) && serviceType.toLowerCase() !== 'group';
    const groupIds = noGroup ? [] : parseGroupIds(s.groupIds && s.groupIds.length ? s.groupIds : s.groupId);
    return {
      id: String(s.id).trim(),
      firstName: s.firstName,
      lastName: s.lastName,
      grade: String(s.grade).trim(),
      serviceType: serviceType,
      groupIds: groupIds,
      groupId: groupIds[0] || '',
      noGroup: noGroup,
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
  const groupedStudentIds = {};
  students.forEach(s => {
    const ids = (s.groupIds && s.groupIds.length) ? s.groupIds : (s.groupId ? [s.groupId] : []);
    if (s.serviceType.toLowerCase() === 'group' && ids.length) {
      ids.forEach(gid => {
        if (!groups[gid]) groups[gid] = [];
        if (!groups[gid].some(m => m.id === s.id)) groups[gid].push(s);
        groupedStudentIds[s.id] = true;
      });
      if (ids.length > 1) {
        warnings.push({
          members: [s],
          reqId: ids.join('+'),
          message: 'In groups ' + ids.join(', ') + ' — minutes from each group session all count toward this student.'
        });
      }
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
  if (student.noGroup) return null;
  const blackouts = getStudentBlackouts(student, gradeBlackouts, studentConstraints);
  const candidates = hostCandidates.filter(entry => {
    if (entry.members.some(m => m.id === student.id || m.noGroup)) return false;
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
    const hostCandidates = scheduled.filter(entry =>
      (entry.week === 1 || entry.week === 2) &&
      entry.members.every(m => !m.noGroup) &&
      entry.members.length < settings.maxGroupSize
    );
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
      const hostCandidates = scheduled.filter(entry =>
        entry.members.every(m => !m.noGroup) &&
        entry.members.length < settings.maxGroupSize
      );
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
  students.forEach(s => { if (s.serviceType.toLowerCase() === 'individual' && !s.noGroup) individualsById[s.id] = s; });
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


function scheduledEntriesFromLog(scheduleLog, students) {
  const studentsById = {};
  (students || []).forEach(s => { studentsById[s.id] = s; });
  const map = {};
  (scheduleLog || []).forEach(r => {
    const key = sessionKeyFromLogRow(r);
    if (!map[key]) {
      let start, end, week;
      try { start = timeStrToMinutes(r.start); end = timeStrToMinutes(r.end); } catch (e) { return; }
      const weekText = String(r.week || '').trim();
      week = (weekText === 'Every Week' || !weekText) ? ALL_WEEKS_KEY : (Number(String(weekText).replace(/[^0-9]/g, '')) || 1);
      map[key] = {
        reqId: String(r.groupId || r.studentId || ''),
        groupId: String(r.groupId || '').trim(),
        week, day: r.day, start, end,
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

function reviewFromScheduleLog(input) {
  const students = loadStudents(input.students);
  const scheduled = scheduledEntriesFromLog(input.scheduleLog, students);
  return buildScheduleReview(scheduled, [], [], students);
}

function studentMinuteImpact(input, studentId) {
  const review = reviewFromScheduleLog(input);
  return review.find(r => r.id === studentId) || null;
}

function canAddStudentToSession(input, logRow, studentId) {
  const settings = buildSettings(input.settings);
  const students = loadStudents(input.students);
  const student = students.find(s => s.id === studentId);
  if (!student) return { ok: false, error: 'Student not found or inactive.' };
  if (student.noGroup) return { ok: false, error: student.firstName + ' is marked No Group.' };
  const mates = sessionMateRows(input.scheduleLog, logRow);
  if (mates.some(r => String(r.studentId) === String(studentId))) {
    return { ok: false, error: 'Already in this session.' };
  }
  if (mates.length >= settings.maxGroupSize) {
    return { ok: false, error: 'Session is at max group size (' + settings.maxGroupSize + ').' };
  }
  let start, end;
  try { start = timeStrToMinutes(logRow.start); end = timeStrToMinutes(logRow.end); } catch (e) {
    return { ok: false, error: 'Bad session time.' };
  }
  const blackouts = getStudentBlackouts(student, loadGradeBlackouts(input.grades), loadStudentConstraints(input.constraints));
  if ((blackouts[logRow.day] || []).some(b => overlaps(start, end, b.start, b.end))) {
    return { ok: false, error: 'Conflicts with a grade or student blackout.' };
  }
  const weekText = String(logRow.week || '').trim();
  const weeksHit = (weekText === 'Every Week' || !weekText)
    ? buildSettings(input.settings).weeksList
    : [Number(String(weekText).replace(/[^0-9]/g, '')) || 1];
  const busy = (input.scheduleLog || []).some(r => {
    if (String(r.studentId) !== String(studentId)) return false;
    if (String(r.day) !== String(logRow.day)) return false;
    const rWeek = String(r.week || '').trim();
    const sameWeek = rWeek === weekText || rWeek === 'Every Week' || weekText === 'Every Week';
    if (!sameWeek) return false;
    try {
      return overlaps(start, end, timeStrToMinutes(r.start), timeStrToMinutes(r.end));
    } catch (e) { return false; }
  });
  if (busy) return { ok: false, error: 'Already booked at this time.' };
  // Preview coverage if added
  const previewLog = (input.scheduleLog || []).concat([{
    studentId: student.id,
    name: student.firstName + ' ' + student.lastName,
    grade: student.grade,
    groupId: logRow.groupId || '',
    week: logRow.week,
    day: logRow.day,
    start: logRow.start,
    end: logRow.end,
    duration: end - start,
    teacher: student.teacher || '',
    locked: logRow.locked || ''
  }]);
  const after = reviewFromScheduleLog(Object.assign({}, input, { scheduleLog: previewLog })).find(r => r.id === student.id);
  const before = reviewFromScheduleLog(input).find(r => r.id === student.id);
  return {
    ok: true,
    before: before,
    after: after,
    warning: after && after.status === 'Over'
      ? (student.firstName + ' would be over minutes (' + after.scheduled + '/' + after.required + ').')
      : (after && after.status === 'Under'
        ? (student.firstName + ' would still be under minutes (' + after.scheduled + '/' + after.required + ').')
        : '')
  };
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
    noGroup: s.noGroup,
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

function sessionKeyFromLogRow(r) {
  return [String(r.week || '').trim(), String(r.day || '').trim(), String(r.start || '').trim(), String(r.end || '').trim(), String(r.groupId || '').trim()].join('|');
}

function sessionMateRows(scheduleLog, logRow) {
  const key = sessionKeyFromLogRow(logRow);
  const gid = String(logRow.groupId || '').trim();
  return (scheduleLog || []).filter(r => {
    if (sessionKeyFromLogRow(r) === key) return true;
    if (!gid) return false;
    return String(r.groupId || '').trim() === gid
      && String(r.week || '').trim() === String(logRow.week || '').trim()
      && String(r.day || '').trim() === String(logRow.day || '').trim()
      && String(r.start || '').trim() === String(logRow.start || '').trim();
  });
}

function findAlternativeSlots(input, logRow) {
  const settings = buildSettings(input.settings);
  const availByPattern = loadProviderAvailability(input.availability);
  const gradeBlackouts = loadGradeBlackouts(input.grades);
  const studentConstraints = loadStudentConstraints(input.constraints);
  const students = loadStudents(input.students);
  const studentsById = {};
  students.forEach(s => { studentsById[s.id] = s; });
  const mateRows = sessionMateRows(input.scheduleLog, logRow);
  const mateIds = mateRows.map(r => String(r.studentId).trim());
  const members = mateIds.map(id => studentsById[id]).filter(Boolean);
  if (!members.length) {
    const student = studentsById[logRow.studentId];
    if (!student) return { error: 'Student not found (may be inactive).', candidates: [] };
    members.push(student);
  }
  const weekText = String(logRow.week || '').trim();
  const isAllWeeks = weekText === 'Every Week' || weekText === '';
  const weekNum = isAllWeeks ? ALL_WEEKS_KEY : Number(String(weekText).replace(/[^0-9]/g, ''));
  const providerBookingsByWeek = emptyBookingsByWeek(settings.weeksList);
  const memberBookingsByWeek = {};
  students.forEach(s => { memberBookingsByWeek[s.id] = emptyBookingsByWeek(settings.weeksList); });
  const movingKeys = {};
  mateRows.forEach(r => { movingKeys[sessionKeyFromLogRow(r) + '|' + String(r.studentId).trim()] = true; });
  (input.scheduleLog || []).forEach(r => {
    const rowStudentId = String(r.studentId).trim();
    if (movingKeys[sessionKeyFromLogRow(r) + '|' + rowStudentId]) return;
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
  let sessionLength;
  try { sessionLength = timeStrToMinutes(logRow.end) - timeStrToMinutes(logRow.start); } catch (e) { sessionLength = settings.minSessionLength; }
  const session = { members, sessionLength, week: weekNum, reqId: String(logRow.groupId || members[0].id) };
  const candidates = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, [], {});
  // Prefer 15-min-aligned starts (week calendar rows) and spread across days so
  // drag-drop targets light up across the week, not only Mon morning.
  return {
    student: members[0],
    members,
    mateIds,
    isAllWeeks,
    weekNum,
    candidates: pickDiverseCandidates(candidates, 80),
  };
}

/** Spread candidates across days/weeks; prefer times that land on the calendar grid. */
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
  const weekText = String(logRow.week || '').trim();
  const isAllWeeks = weekText === 'Every Week' || weekText === '';
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
    out.push({ row: r, index: i, key });
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
    const rWeekText = String(r.week || '').trim();
    const rIsAll = rWeekText === 'Every Week' || rWeekText === '';
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
  return { providerBookingsByWeek, memberBookingsByWeek };
}

/** True if session can sit at day/start with its own duration (bookings already exclude vacated groups). */
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

/**
 * Suggest mutual trades: A takes B's start, B takes A's start (each keeps its duration).
 * Useful when the calendar is full and empty alternate slots are scarce.
 */
function findSwapCandidates(input, logRow) {
  const settings = buildSettings(input.settings);
  const availByPattern = loadProviderAvailability(input.availability);
  const gradeBlackouts = loadGradeBlackouts(input.grades);
  const studentConstraints = loadStudentConstraints(input.constraints);
  const students = loadStudents(input.students);
  const studentsById = {};
  students.forEach(s => { studentsById[s.id] = s; });

  const a = resolveSessionMembers(input.scheduleLog, logRow, studentsById);
  if (!a.members.length) return { error: 'Student not found (may be inactive).', swaps: [] };
  const aWeek = weekNumFromLogRow(logRow);
  let aStart, aEnd, aLen;
  try {
    aStart = timeStrToMinutes(logRow.start);
    aEnd = timeStrToMinutes(logRow.end);
    aLen = aEnd - aStart;
  } catch (e) {
    return { error: 'Bad session time.', swaps: [] };
  }
  const aDay = logRow.day;
  const aKey = sessionKeyFromLogRow(logRow);
  const aSession = {
    members: a.members,
    sessionLength: aLen,
    week: aWeek.weekNum,
    reqId: String(logRow.groupId || a.members[0].id)
  };

  const swaps = [];
  uniqueSessionRepresentatives(input.scheduleLog).forEach(rep => {
    if (rep.key === aKey) return;
    const other = rep.row;
    if (String(other.locked).toLowerCase() === 'yes') return;
    if (String(logRow.locked).toLowerCase() === 'yes') return;
    const bWeek = weekNumFromLogRow(other);
    // Only swap like-with-like weeks (Every↔Every or same Week N).
    if (aWeek.isAllWeeks !== bWeek.isAllWeeks) return;
    if (!aWeek.isAllWeeks && Number(aWeek.weekNum) !== Number(bWeek.weekNum)) return;

    const b = resolveSessionMembers(input.scheduleLog, other, studentsById);
    if (!b.members.length) return;
    // Shared student cannot be in two places — skip overlapping membership.
    if (a.mateIds.some(id => b.mateIds.indexOf(id) >= 0)) return;

    let bStart, bEnd, bLen;
    try {
      bStart = timeStrToMinutes(other.start);
      bEnd = timeStrToMinutes(other.end);
      bLen = bEnd - bStart;
    } catch (e) { return; }
    if (other.day === aDay && bStart === aStart) return;

    const exclude = {};
    a.mateRows.forEach(r => { exclude[sessionKeyFromLogRow(r) + '|' + String(r.studentId).trim()] = true; });
    b.mateRows.forEach(r => { exclude[sessionKeyFromLogRow(r) + '|' + String(r.studentId).trim()] = true; });
    const { providerBookingsByWeek, memberBookingsByWeek } = fillBookingsExcluding(
      input.scheduleLog, settings, students, exclude
    );

    const bSession = {
      members: b.members,
      sessionLength: bLen,
      week: bWeek.weekNum,
      reqId: String(other.groupId || b.members[0].id)
    };

    const aFitsAtB = canPlaceSessionAt(
      aSession, other.day, bStart,
      availByPattern, gradeBlackouts, studentConstraints,
      providerBookingsByWeek, memberBookingsByWeek, settings
    );
    const bFitsAtA = canPlaceSessionAt(
      bSession, aDay, aStart,
      availByPattern, gradeBlackouts, studentConstraints,
      providerBookingsByWeek, memberBookingsByWeek, settings
    );
    if (!aFitsAtB || !bFitsAtA) return;

    const names = Array.from(new Set(b.mateRows.map(r => r.name).filter(Boolean)));
    swaps.push({
      otherIndex: rep.index,
      otherKey: rep.key,
      otherNames: names,
      otherLabel: names.join(' + ') || other.name,
      otherDay: other.day,
      otherStart: bStart,
      otherEnd: bEnd,
      otherWeek: other.week,
      otherGroupId: other.groupId || '',
      otherDuration: bLen,
      aGoesTo: { day: other.day, start: bStart, end: bStart + aLen, week: aWeek.weekNum },
      bGoesTo: { day: aDay, start: aStart, end: aStart + bLen, week: bWeek.weekNum }
    });
  });

  // Prefer nearer swaps (same day first, then closer start times).
  swaps.sort((x, y) => {
    const sameDayX = x.otherDay === aDay ? 0 : 1;
    const sameDayY = y.otherDay === aDay ? 0 : 1;
    if (sameDayX !== sameDayY) return sameDayX - sameDayY;
    return Math.abs(x.otherStart - aStart) - Math.abs(y.otherStart - aStart);
  });

  return {
    members: a.members,
    mateIds: a.mateIds,
    isAllWeeks: aWeek.isAllWeeks,
    weekNum: aWeek.weekNum,
    swaps: swaps.slice(0, 24)
  };
}

function buildCalendarModel(logRows, settings, showAllWeeks, availability) {
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
    if (!entryMap[key]) entryMap[key] = { weekLabel: s.weekLabel, day: s.day, start: s.start, end: s.end, grade: s.grade, groupId: s.groupId || '', names: [], teachers: [], studentIds: [] };
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
  // Expand to provider hours so empty cells exist for drag-and-drop across the day.
  (availability || []).forEach(a => {
    try {
      minStart = Math.min(minStart, timeStrToMinutes(a.start));
      maxEnd = Math.max(maxEnd, timeStrToMinutes(a.end));
    } catch (e) {}
  });
  if (!isFinite(minStart)) { minStart = timeStrToMinutes('8:00 AM'); maxEnd = timeStrToMinutes('3:00 PM'); }
  else {
    minStart = Math.min(minStart, timeStrToMinutes('8:00 AM'));
    maxEnd = Math.max(maxEnd, timeStrToMinutes('3:00 PM'));
  }
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
    const gids = parseGroupIds(s.groupIds && s.groupIds.length ? s.groupIds : (s.groupId || s.groupId || ''));
    const gid = gids[0] || '';
    if (service === 'Group') {
      if (!gids.length) issues.push(label + ': Group service needs a Group ID (comma-separate multiple).');
      else {
        gids.forEach(g => {
          if (!groupMembers[g]) groupMembers[g] = [];
          groupMembers[g].push({ id: label, freq, minutes: s.minutesPerWeek, sessionsQ: s.sessionsPerQuarter, lenQ: s.quarterlySessionLength });
        });
      }
      if (truthyFlag(s.noGroup)) issues.push(label + ': No Group cannot be set on a Group student.');
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
  students: ['id','firstName','lastName','grade','serviceType','groupId','noGroup','frequencyType','minutesPerWeek','preferredSessionLength','sessionsPerQuarter','quarterlySessionLength','notes','status','teacher','fixedDay','fixedStart'],
  availability: ['day','start','end','pattern','notes'],
  grades: ['grade','day','start','end','reason'],
  constraints: ['studentId','day','start','end','reason'],
  schedule: ['studentId','name','grade','groupId','week','day','start','end','duration','teacher','locked'],
  settings: ['setting','value']
};

/** Normalize sheet/CSV header for fuzzy matching (Apps Script labels included). */
function normalizeHeaderKey(h) {
  return String(h || '').trim().toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s_./-]+/g, '');
}

function csvRowGet(o, ...aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const want = normalizeHeaderKey(aliases[i]);
    const k = Object.keys(o || {}).find(x => normalizeHeaderKey(x) === want || normalizeHeaderKey(x).includes(want));
    if (k != null && o[k] !== undefined && o[k] !== '') return o[k];
  }
  return '';
}

function normalizeImportedTime(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) return minutesToTimeStr(val.getHours() * 60 + val.getMinutes());
  if (typeof val === 'number' && val >= 0 && val < 1) {
    return minutesToTimeStr(Math.round(val * 24 * 60));
  }
  return String(val).trim();
}

/** Apps Script Week Pattern: blank = every week, or A / B only. */
function normalizeImportedPattern(val) {
  const raw = String(val || '').trim().toUpperCase();
  if (!raw || raw === 'ALL' || raw === 'BOTH' || raw.indexOf('BOTH') >= 0) return '';
  if (raw === 'A' || raw === 'B') return raw;
  return '';
}

const SHEET_KIND_ALIASES = {
  students: ['students'],
  availability: ['myavailability', 'availability', 'hours'],
  grades: ['grades'],
  constraints: ['constraints', 'studentblocks', 'blocks'],
  settings: ['settings'],
  schedule: ['schedulelog', 'log']
};

function sheetNameToKind(sheetName) {
  const n = normalizeHeaderKey(sheetName);
  if (!n || n === 'readme' || n.includes('printable') || n.includes('openslots') || n.includes('review')) return null;
  const keys = Object.keys(SHEET_KIND_ALIASES);
  for (let i = 0; i < keys.length; i++) {
    const kind = keys[i];
    if (SHEET_KIND_ALIASES[kind].some(a => n === a || n.includes(a))) return kind;
  }
  return null;
}

function detectCsvKind(headers, filename) {
  const fn = normalizeHeaderKey(String(filename || '').replace(/\.[^.]+$/, ''));
  if (fn.includes('student') && !fn.includes('constraint')) return 'students';
  if (fn === 'myavailability' || fn === 'availability' || fn === 'hours') return 'availability';
  if (fn === 'grades') return 'grades';
  if (fn === 'constraints' || fn === 'blocks') return 'constraints';
  if (fn === 'settings') return 'settings';
  if (fn.includes('schedule') || fn === 'log') return 'schedule';

  const keys = (headers || []).map(normalizeHeaderKey);
  const has = (needle) => keys.some(k => k === needle || k.includes(needle));
  if (has('setting') && has('value') && keys.length <= 4) return 'settings';
  if (has('studentid') && (has('firstname') || has('lastname'))) return 'students';
  if ((has('locked') || has('duration')) && has('studentid') && has('week')) return 'schedule';
  if (has('studentid') && has('reason') && !has('grade')) return 'constraints';
  if (has('grade') && has('reason') && !has('studentid')) return 'grades';
  if ((has('pattern') || has('weekpattern')) && (has('start') || has('starttime'))) return 'availability';
  if (has('minutesperweek') || has('frequencytype')) return 'students';
  return null;
}

function finalizeImportedStudent(s) {
  const serviceType = String(s.serviceType || 'Individual').trim();
  const noGroup = truthyFlag(s.noGroup) && serviceType.toLowerCase() !== 'group';
  const gids = noGroup ? [] : parseGroupIds(s.groupIds || s.groupId || '');
  return Object.assign({}, s, {
    groupIds: gids,
    groupId: gids[0] || '',
    noGroup,
    serviceType: serviceType || 'Individual',
    frequencyType: String(s.frequencyType || 'Weekly').toLowerCase() === 'quarterly' ? 'Quarterly' : 'Weekly',
    minutesPerWeek: Number(s.minutesPerWeek) || 0,
    preferredSessionLength: s.preferredSessionLength ? Number(s.preferredSessionLength) : '',
    sessionsPerQuarter: Number(s.sessionsPerQuarter) || 0,
    quarterlySessionLength: Number(s.quarterlySessionLength) || 0,
    status: String(s.status || 'Active').trim() || 'Active',
    notes: s.notes || '',
    teacher: s.teacher || '',
    fixedDay: s.fixedDay || '',
    fixedStart: s.fixedStart || '',
  });
}

function normalizeImportedStudent(o) {
  const get = (...keys) => csvRowGet(o, ...keys);
  return finalizeImportedStudent({
    id: get('id', 'studentId', 'Student ID'),
    firstName: get('firstName', 'First Name', 'first'),
    lastName: get('lastName', 'Last Name', 'last'),
    grade: get('grade', 'Grade'),
    serviceType: get('serviceType', 'Service Type') || 'Individual',
    groupId: get('groupId', 'Group ID', 'groupIds', 'Group IDs'),
    groupIds: get('groupIds', 'Group IDs', 'groupId', 'Group ID'),
    noGroup: get('noGroup', 'No Group', 'NoGroup'),
    frequencyType: get('frequencyType', 'Frequency Type') || 'Weekly',
    minutesPerWeek: get('minutesPerWeek', 'Minutes/Week', 'Minutes/Week Required'),
    preferredSessionLength: get('preferredSessionLength', 'Preferred Session Length'),
    sessionsPerQuarter: get('sessionsPerQuarter', 'Sessions Per Quarter'),
    quarterlySessionLength: get('quarterlySessionLength', 'Session Length', 'Session Length (Quarterly)'),
    notes: get('notes', 'Notes'),
    status: get('status', 'Status') || 'Active',
    teacher: get('teacher', 'Teacher'),
    fixedDay: get('fixedDay', 'Fixed Day'),
    fixedStart: get('fixedStart', 'Fixed Start Time', 'fixedStartTime'),
  });
}

function normalizeImportedAvailability(o) {
  return {
    day: csvRowGet(o, 'day', 'Day'),
    start: normalizeImportedTime(csvRowGet(o, 'start', 'Start Time', 'Start')),
    end: normalizeImportedTime(csvRowGet(o, 'end', 'End Time', 'End')),
    pattern: normalizeImportedPattern(csvRowGet(o, 'pattern', 'Week Pattern', 'Pattern')),
    notes: csvRowGet(o, 'notes', 'Notes') || '',
  };
}

function normalizeImportedGrade(o) {
  return {
    grade: csvRowGet(o, 'grade', 'Grade'),
    day: csvRowGet(o, 'day', 'Day'),
    start: normalizeImportedTime(csvRowGet(o, 'start', 'Start Time', 'Start')),
    end: normalizeImportedTime(csvRowGet(o, 'end', 'End Time', 'End')),
    reason: csvRowGet(o, 'reason', 'Reason') || '',
  };
}

function normalizeImportedConstraint(o) {
  return {
    studentId: csvRowGet(o, 'studentId', 'Student ID'),
    day: csvRowGet(o, 'day', 'Day'),
    start: normalizeImportedTime(csvRowGet(o, 'start', 'Start Time', 'Start')),
    end: normalizeImportedTime(csvRowGet(o, 'end', 'End Time', 'End')),
    reason: csvRowGet(o, 'reason', 'Reason') || '',
  };
}

function normalizeImportedScheduleRow(o) {
  const dur = csvRowGet(o, 'duration', 'Duration');
  return {
    studentId: csvRowGet(o, 'studentId', 'Student ID'),
    name: csvRowGet(o, 'name', 'Name'),
    grade: csvRowGet(o, 'grade', 'Grade'),
    groupId: csvRowGet(o, 'groupId', 'Group ID'),
    week: csvRowGet(o, 'week', 'Week'),
    day: csvRowGet(o, 'day', 'Day'),
    start: normalizeImportedTime(csvRowGet(o, 'start', 'Start Time', 'Start')),
    end: normalizeImportedTime(csvRowGet(o, 'end', 'End Time', 'End')),
    duration: dur !== '' ? Number(dur) : Number(csvRowGet(o, 'Duration (min)', 'Duration (minutes)')) || '',
    teacher: csvRowGet(o, 'teacher', 'Teacher') || '',
    locked: csvRowGet(o, 'locked', 'Locked') || '',
  };
}

function settingsFromImportRows(rows) {
  const patch = {};
  (rows || []).forEach(r => {
    const key = String(csvRowGet(r, 'setting', 'Setting') || '').trim();
    const val = csvRowGet(r, 'value', 'Value');
    if (!key) return;
    if (key.indexOf('Slot Increment') >= 0) patch.slotIncrement = Number(val) || 5;
    else if (key === 'School Days') patch.schoolDays = String(val).split(',').map(d => d.trim());
    else if (key.indexOf('Min Session Length') >= 0) patch.minSessionLength = Number(val) || 15;
    else if (key.indexOf('Max Session Length') >= 0) patch.maxSessionLength = Number(val) || 60;
    else if (key.indexOf('Weeks Per Quarter') >= 0) patch.weeksPerQuarter = Math.max(1, Number(val) || 9);
    else if (key.indexOf('Starting Week Pattern') >= 0) patch.startingWeekPattern = String(val).trim().toUpperCase() === 'B' ? 'B' : 'A';
    else if (key.indexOf('Group Rescue Extra Minutes') >= 0) patch.groupRescueExtraMinutes = Math.max(0, Number(val) || 0);
    else if (key.indexOf('Max Students Per Auto-Group') >= 0) patch.maxGroupSize = Math.max(2, Number(val) || 2);
    else if (key.indexOf('Prefer Consistent Weekly Pattern') >= 0) patch.preferConsistentPattern = String(val).trim().toLowerCase() !== 'no';
    else if (key.indexOf('Show Teacher on Schedule') >= 0) patch.showTeacherInfo = String(val).trim().toLowerCase() !== 'no';
    else if (key.indexOf('Front-Load First Sessions') >= 0) patch.frontLoadFirstSessions = String(val).trim().toLowerCase() !== 'no';
  });
  return patch;
}

/** Normalize raw sheet/CSV rows for one table kind. */
function importTableRows(kind, rawRows) {
  const rows = rawRows || [];
  if (kind === 'students') return rows.map(normalizeImportedStudent);
  if (kind === 'availability') return rows.map(normalizeImportedAvailability).filter(r => r.day && r.start && r.end);
  if (kind === 'grades') return rows.map(normalizeImportedGrade).filter(r => r.grade && r.day);
  if (kind === 'constraints') return rows.map(normalizeImportedConstraint).filter(r => r.studentId && r.day);
  if (kind === 'schedule') return rows.map(normalizeImportedScheduleRow).filter(r => r.studentId && r.day);
  if (kind === 'settings') return settingsFromImportRows(rows);
  return rows;
}

/**
 * Merge imported tables (from workbook or multi-CSV) into a workspace object.
 * imports: { students?: [], availability?: [], ... settings?: [] }
 */
function applyWorkbookImports(workspace, imports, opts) {
  opts = opts || {};
  const merge = !!opts.merge;
  const w = workspace || { settings: {}, students: [], availability: [], grades: [], constraints: [], scheduleLog: [] };

  if (imports.students && imports.students.length) {
    const incoming = importTableRows('students', imports.students);
    w.students = merge ? mergeImportBy(w.students, incoming, r => r.id) : incoming;
  }
  if (imports.availability && imports.availability.length) {
    const incoming = importTableRows('availability', imports.availability);
    w.availability = merge ? mergeImportBy(w.availability, incoming, r => [r.day, r.start, r.end, r.pattern].join('|')) : incoming;
  }
  if (imports.grades && imports.grades.length) {
    const incoming = importTableRows('grades', imports.grades);
    w.grades = merge ? mergeImportBy(w.grades, incoming, r => [r.grade, r.day, r.start, r.end].join('|')) : incoming;
  }
  if (imports.constraints && imports.constraints.length) {
    const incoming = importTableRows('constraints', imports.constraints);
    w.constraints = merge ? mergeImportBy(w.constraints, incoming, r => [r.studentId, r.day, r.start, r.end].join('|')) : incoming;
  }
  if (imports.schedule && imports.schedule.length) {
    w.scheduleLog = importTableRows('schedule', imports.schedule);
    w.lastRun = w.lastRun || { at: new Date().toISOString() };
  }
  if (imports.settings && imports.settings.length) {
    const patch = importTableRows('settings', imports.settings);
    w.settings = buildSettings(Object.assign({}, w.settings || {}, patch));
  }
  return w;
}

function mergeImportBy(existing, incoming, keyFn) {
  const map = {};
  (existing || []).forEach(r => { map[keyFn(r)] = r; });
  (incoming || []).forEach(r => { map[keyFn(r)] = Object.assign({}, map[keyFn(r)] || {}, r); });
  return Object.values(map);
}

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

if (typeof window !== 'undefined') {
  window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  window.CSV_SCHEMAS = CSV_SCHEMAS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DAYS, DEFAULT_SETTINGS, buildSettings, runSchedulingEngine, validateCaseload,
    computeOpenSlots, findAlternativeSlots, findSwapCandidates, pickDiverseCandidates, buildCalendarModel,
    parseCsv, toCsv, csvToObjects, objectsToCsv, detectCsvKind, normalizeImportedStudent,
    normalizeHeaderKey, csvRowGet, sheetNameToKind, importTableRows, applyWorkbookImports,
    mergeImportBy, settingsFromImportRows, normalizeImportedScheduleRow,
    CSV_SCHEMAS, loadStudents, minutesToTimeStr, timeStrToMinutes, parseGroupIds,
    sessionMateRows, sessionKeyFromLogRow, reviewFromScheduleLog,
    scheduledEntriesFromLog, canAddStudentToSession, studentMinuteImpact, buildScheduleReview
  };
}
