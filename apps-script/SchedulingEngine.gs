/**
 * The actual scheduling algorithm: turns Students rows into session
 * requirements, finds candidate time slots, and runs the main
 * most-constrained-first placement loop (generateSchedule).
 */

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

  Object.keys(groups).forEach(gid => {
    requirements.push(buildRequirementSet(gid, groups[gid], settings, warnings));
  });

  return { requirements, warnings };
}

function buildRequirementSet(reqId, members, settings, warnings) {
  const primary = members[0];
  const hasFixedTime = !!(primary.fixedDay && primary.fixedStart !== null && primary.fixedStart !== undefined);

  if (primary.frequencyType === 'Quarterly') {
    const len = primary.quarterlySessionLength || settings.minSessionLength;
    const n = primary.sessionsPerQuarter || 0;
    const sessions = [];
    for (let i = 1; i <= n; i++) {
      const session = {
        reqId, members, sessionLength: len, week: ANY_WEEK_KEY,
        sessionIndex: i, totalSessions: n, scheduled: null
      };
      // Fixed time applies to every quarterly occurrence, since the point is
      // "always this exact day/time whenever this student is seen."
      if (hasFixedTime) { session.fixedDay = primary.fixedDay; session.fixedStart = primary.fixedStart; }
      sessions.push(session);
    }

    if (len < settings.minSessionLength || len > settings.maxSessionLength) {
      warnings.push({
        members, reqId,
        message: `Quarterly session length (${len} min) falls outside the configured Min/Max ` +
          `(${settings.minSessionLength}-${settings.maxSessionLength} min). Using the value as entered since it's fixed.`
      });
    }
    return sessions;
  }

  // Weekly (default)
  const plan = computeWeeklyPlan(primary.minutesPerWeek, settings, primary.preferredSessionLength);
  const sessions = plan.lengths.map((len, idx) => {
    const session = {
      reqId, members, sessionLength: len, week: ALL_WEEKS_KEY,
      sessionIndex: idx + 1, totalSessions: plan.lengths.length, scheduled: null
    };
    // For a student needing multiple sessions/week, only the FIRST is pinned to
    // the fixed day/time - the rest stay flexible and get scheduled normally.
    if (hasFixedTime && idx === 0) { session.fixedDay = primary.fixedDay; session.fixedStart = primary.fixedStart; }
    return session;
  });

  if (plan.shortfall > 0) {
    warnings.push({
      members, reqId,
      message: `Needs ${primary.minutesPerWeek} min/week but max deliverable is ${plan.deliveredTotal} min/week ` +
        `within one-session-per-day and a ${settings.maxSessionLength}-min cap across ${plan.lengths.length} available day(s). ` +
        `Consider raising Max Session Length or reviewing this student's plan.`
    });
  }
  return sessions;
}

function emptyBookingsByWeek(weeksList) {
  const obj = {};
  weeksList.forEach(w => { obj[w] = {}; DAYS.forEach(d => obj[w][d] = []); });
  return obj;
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
      const windows = providerAvail[day] || [];
      windows.forEach(win => {
        for (let start = win.start; start + duration <= win.end; start += settings.slotIncrement) {
          const end = start + duration;

          const providerBusy = weeksToCheck.some(w => (providerBookingsByWeek[w][day] || []).some(b => overlaps(start, end, b.start, b.end)));
          if (providerBusy) continue;

          const memberConflict = session.members.some((m, idx) => {
            const blackout = (memberBlackouts[idx][day] || []).some(b => overlaps(start, end, b.start, b.end));
            if (blackout) return true;
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
  const raw = candidatesForWeekSet(weeksToCheck, excludeDays || []);
  return raw.map(c => Object.assign({ week: session.week }, c));
}

/**
 * Tries to join `student` into one of `hostCandidates` (already-scheduled
 * compatible sessions) - closest grade first, respecting the group size cap
 * and duration tolerance. On success, mutates the winning host's members/
 * groupId in place, updates memberBookingsByWeek/reqDaysUsed for the joining
 * student, and returns the host entry. Returns null if nothing works. Shared
 * by both the front-load pass and the general group rescue pass below, so
 * AUTO-GROUP numbering stays consistent across both (groupIdState is a
 * shared {counter} object both passes increment).
 */
/**
 * Whether any member of `session` already appears in ANY scheduled entry -
 * checking by student membership, not by matching reqId. This matters
 * because joining someone else's session via group rescue books a student
 * under the HOST's original reqId, not their own - a plain reqId match would
 * incorrectly think that student still has nothing scheduled at all.
 */
function isReqIdRepresented(scheduled, session) {
  return session.members.some(sm => scheduled.some(s => s.members.some(m => m.id === sm.id)));
}

function tryJoinCompatibleHost(student, sessionLength, needsEveryWeek, hostCandidates, settings, gradeBlackouts, studentConstraints, memberBookingsByWeek, reqDaysUsed, groupIdState) {
  if (student.noGroup) return null;
  const blackouts = getStudentBlackouts(student, gradeBlackouts, studentConstraints);

  const candidates = hostCandidates.filter(entry => {
    if (entry.members.some(m => m.id === student.id || m.noGroup)) return false;     // not already in it / host opted out of grouping
    if (entry.members.length >= settings.maxGroupSize) return false;    // already at the configured headcount cap
    const hostIsEveryWeek = entry.week === ALL_WEEKS_KEY;
    if (needsEveryWeek !== hostIsEveryWeek) return false;               // must match weekly-recurring vs. single-week shape
    const extra = (entry.end - entry.start) - sessionLength;
    return extra >= 0 && extra <= settings.groupRescueExtraMinutes;
  });
  candidates.sort((a, b) => {
    const da = Math.min.apply(null, a.members.map(m => Math.abs(gradeSortValue(m.grade) - gradeSortValue(student.grade))));
    const db = Math.min.apply(null, b.members.map(m => Math.abs(gradeSortValue(m.grade) - gradeSortValue(student.grade))));
    if (da !== db) return da - db;
    const extraA = (a.end - a.start) - sessionLength;
    const extraB = (b.end - b.start) - sessionLength;
    return extraA - extraB;
  });

  for (let i = 0; i < candidates.length; i++) {
    const host = candidates[i];
    const weeksToCheck = weeksForEntry(host.week, settings);

    const blockedByGrade = (blackouts[host.day] || []).some(b => overlaps(host.start, host.end, b.start, b.end));
    if (blockedByGrade) continue;

    const weekKeyForHost = String(host.week);
    const daysAlreadyUsed = (reqDaysUsed[student.id] && reqDaysUsed[student.id][weekKeyForHost]) || [];
    if (daysAlreadyUsed.indexOf(host.day) !== -1) continue; // one-session-per-day still applies to the joining student

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

/**
 * Runs BEFORE the main placement loop: for each Quarterly reqId with nothing
 * scheduled yet (no lock, no fixed time), tries to land ONE of their sessions
 * (the longest, for consistency with "longer sessions get priority"
 * elsewhere) in Week 1 or 2 specifically - first as an individual slot, then
 * by joining an already-scheduled Week 1-2 session via the exact same
 * compatibility rules as the general group rescue pass (duration tolerance +
 * group size cap). Only if BOTH fail does that reqId fall through to the
 * normal, unrestricted pass. This is what makes "start in Week 1-2" as close
 * to a hard requirement as the grouping rules genuinely allow, without ever
 * leaving someone unscheduled purely to enforce it - real manually-created
 * groups can't use the join fallback (they're never split across sessions),
 * so they only get the individual-slot attempt here before falling through.
 */
function frontLoadFirstSessionsIntoEarlyWeeks(pending, scheduled, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, reqDaysUsed, individualsById, groupIdState) {
  if (!settings.frontLoadFirstSessions) return;

  const byReqId = {};
  pending.forEach(session => {
    if (session.week !== ANY_WEEK_KEY) return;
    if (isReqIdRepresented(scheduled, session)) return; // already represented (locked/fixed-time)
    if (!byReqId[session.reqId] || session.sessionLength > byReqId[session.reqId].sessionLength) {
      byReqId[session.reqId] = session;
    }
  });
  const candidateSessions = Object.values(byReqId).sort((a, b) => b.sessionLength - a.sessionLength);

  candidateSessions.forEach(session => {
    // Step 1: try an individual slot, hard-restricted to Week 1 or 2.
    const allCandidates = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, [], reqDaysUsed);
    const earlyOnly = allCandidates
      .filter(c => c.week <= 2)
      .sort((a, b) => a.week - b.week || DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start);

    if (earlyOnly.length) {
      const pick = earlyOnly[0];
      providerBookingsByWeek[pick.week][pick.day].push({ start: pick.start, end: pick.end });
      session.members.forEach(m => memberBookingsByWeek[m.id][pick.week][pick.day].push({ start: pick.start, end: pick.end }));
      const weekKey = String(pick.week);
      if (!reqDaysUsed[session.reqId]) reqDaysUsed[session.reqId] = {};
      if (!reqDaysUsed[session.reqId][weekKey]) reqDaysUsed[session.reqId][weekKey] = [];
      reqDaysUsed[session.reqId][weekKey].push(pick.day);
      scheduled.push({
        reqId: session.reqId, members: session.members, week: pick.week, day: pick.day, start: pick.start, end: pick.end,
        sessionIndex: session.sessionIndex, totalSessions: session.totalSessions
      });
      const idx = pending.indexOf(session);
      if (idx !== -1) pending.splice(idx, 1);
      return;
    }

    // Step 2: no individual slot in Week 1-2 - lean on grouping instead, but
    // only for Individual-service-type students (never split a real manual group).
    const primary = session.members[0];
    if (session.members.length !== 1 || !individualsById[primary.id]) return;

    const hostCandidates = scheduled.filter(entry =>
      (entry.week === 1 || entry.week === 2) && entry.members.every(m => individualsById[m.id])
    );
    const host = tryJoinCompatibleHost(primary, session.sessionLength, false, hostCandidates, settings, gradeBlackouts, studentConstraints, memberBookingsByWeek, reqDaysUsed, groupIdState);
    if (host) {
      const idx = pending.indexOf(session);
      if (idx !== -1) pending.splice(idx, 1);
    }
    // else: left in `pending` unchanged - falls through to the normal pass, which still has the soft early-week preference as a second chance.
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

      if (host) {
        rescuedUnscheduledEntries.push(u);
        progress = true;
        continue;
      }

      stillRemaining.push(u);
    }

    remaining = stillRemaining;
  }

  return rescuedUnscheduledEntries;
}

function generateSchedule() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = loadSettings();
  const availByPattern = loadProviderAvailability();
  const gradeBlackouts = loadGradeBlackouts();
  const studentConstraints = loadStudentConstraints();
  const students = loadStudents();

  if (!students.length) {
    ss.toast('No active students found in the Students sheet.', 'Nothing to schedule', 6);
    return;
  }

  // Must read locked sessions from the PREVIOUS run's Schedule_Log before
  // anything below clears/rewrites it.
  const lockedSessions = loadLockedSessions();
  const studentsById = {};
  students.forEach(s => { studentsById[s.id] = s; });
  const individualsById = {};
  students.forEach(s => { if (s.serviceType.toLowerCase() === 'individual' && !s.noGroup) individualsById[s.id] = s; });
  const groupIdState = { counter: 0 }; // shared AUTO-GROUP numbering across the front-load pass and the general rescue pass

  const { requirements: requirementSets, warnings: capacityWarnings } = buildRequirements(students, settings);
  let pending = [].concat(...requirementSets);

  const providerBookingsByWeek = emptyBookingsByWeek(settings.weeksList);
  const memberBookingsByWeek = {};
  students.forEach(s => { memberBookingsByWeek[s.id] = emptyBookingsByWeek(settings.weeksList); });

  // reqDaysUsed[reqId][weekKey] = [days already used] - weekKey is ALL_WEEKS_KEY or a week number as string
  const reqDaysUsed = {};

  const scheduled = [];
  let unscheduled = [];

  // --- Priority 1: honor whatever was locked from the previous run. ---
  // Each locked session gets booked at EXACTLY its prior placement, and one
  // matching (by reqId + closest session length) slot gets removed from
  // `pending` so the normal pass doesn't try to schedule it again from
  // scratch. A locked session's "natural" reqId is its Group ID for a real
  // manually-created group, or the student's own ID otherwise - this matters
  // for a locked AUTO-GROUP row, since auto-group IDs are regenerated fresh
  // every run and won't exist in this run's `pending` at all; each member of
  // an auto-group is fundamentally an Individual, so each gets their own slot
  // decremented independently.
  lockedSessions.forEach(ls => {
    const members = ls.studentIds.map(id => studentsById[id]).filter(Boolean);
    if (!members.length) return; // student no longer active/exists since this was locked

    const naturalReqIds = new Set();
    members.forEach(m => {
      const natural = (m.serviceType.toLowerCase() === 'group' && m.groupId) ? m.groupId : m.id;
      naturalReqIds.add(natural);
    });
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

    const weeksToBook = weeksForEntry(ls.week, settings);
    weeksToBook.forEach(w => {
      providerBookingsByWeek[w][ls.day].push({ start: ls.start, end: ls.end });
      members.forEach(m => memberBookingsByWeek[m.id][w][ls.day].push({ start: ls.start, end: ls.end }));
    });
    const weekKey = String(ls.week);
    if (!reqDaysUsed[ls.reqId]) reqDaysUsed[ls.reqId] = {};
    if (!reqDaysUsed[ls.reqId][weekKey]) reqDaysUsed[ls.reqId][weekKey] = [];
    reqDaysUsed[ls.reqId][weekKey].push(ls.day);

    scheduled.push({
      reqId: ls.reqId, members, week: ls.week, day: ls.day, start: ls.start, end: ls.end,
      sessionIndex: 0, totalSessions: 0, locked: true
    });
  });

  // --- Priority 2: sessions with a Fixed Day/Time (Students sheet) get their
  // exact required slot next, before the flexible algorithm runs for anyone
  // else. If that exact slot isn't available (conflicts with availability,
  // blackouts, or a locked booking above), it's reported as unscheduled with
  // a specific reason rather than silently placed somewhere else. ---
  const fixedPending = pending.filter(s => s.fixedDay && s.fixedStart !== null && s.fixedStart !== undefined);
  pending = pending.filter(s => !(s.fixedDay && s.fixedStart !== null && s.fixedStart !== undefined));

  fixedPending.forEach(session => {
    const weekKey = String(session.week);
    const excludeDays = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][weekKey]) || [];
    const allCandidates = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, excludeDays, reqDaysUsed);
    const matches = allCandidates.filter(c => c.day === session.fixedDay && c.start === session.fixedStart);

    if (!matches.length) {
      unscheduled.push({
        session,
        reason: `Fixed time (${session.fixedDay} ${minutesToTimeStr(session.fixedStart)}) is unavailable - conflicts with availability, a grade/student blackout, or another booking`
      });
      return;
    }

    // Among weeks where the fixed slot is open, still prefer one this reqId hasn't used yet.
    matches.sort((a, b) => {
      const usedA = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][String(a.week)]) || [];
      const usedB = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][String(b.week)]) || [];
      if (usedA.length !== usedB.length) return usedA.length - usedB.length;
      const wa = a.week === ALL_WEEKS_KEY ? 0 : a.week, wb = b.week === ALL_WEEKS_KEY ? 0 : b.week;
      return wa - wb;
    });
    const match = matches[0];

    const weeksToBook = weeksForEntry(match.week, settings);
    weeksToBook.forEach(w => {
      providerBookingsByWeek[w][match.day].push({ start: match.start, end: match.end });
      session.members.forEach(m => memberBookingsByWeek[m.id][w][match.day].push({ start: match.start, end: match.end }));
    });
    const wk = String(match.week);
    if (!reqDaysUsed[session.reqId]) reqDaysUsed[session.reqId] = {};
    if (!reqDaysUsed[session.reqId][wk]) reqDaysUsed[session.reqId][wk] = [];
    reqDaysUsed[session.reqId][wk].push(match.day);

    scheduled.push({
      reqId: session.reqId, members: session.members, week: match.week,
      day: match.day, start: match.start, end: match.end,
      sessionIndex: session.sessionIndex, totalSessions: session.totalSessions
    });
  });

  // --- Priority 3: for Quarterly reqIds with nothing scheduled yet, hard-lean
  // on grouping to get a first session into Week 1-2 (see docblock above the
  // function for exactly what "hard" means here). ---
  frontLoadFirstSessionsIntoEarlyWeeks(pending, scheduled, availByPattern, gradeBlackouts, studentConstraints,
    providerBookingsByWeek, memberBookingsByWeek, settings, reqDaysUsed, individualsById, groupIdState);

  while (pending.length > 0) {
    let bestIdx = -1;
    let bestCandidates = null;
    let bestCount = Infinity;
    let bestIsFirstOcc = false;

    pending.forEach((session, idx) => {
      const weekKey = String(session.week);
      const excludeDays = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][weekKey]) || [];
      const cands = findCandidateSlots(session, availByPattern, gradeBlackouts, studentConstraints, providerBookingsByWeek, memberBookingsByWeek, settings, excludeDays, reqDaysUsed);

      const isFirstOcc = settings.frontLoadFirstSessions && session.week === ANY_WEEK_KEY && !isReqIdRepresented(scheduled, session);

      // Most-constrained-first is the primary driver (maximizes overall placement
      // success). Among ties, if "Front-Load First Sessions" is on, prefer
      // whichever session is someone's VERY FIRST occurrence over someone
      // else's 2nd/3rd/etc - otherwise one student's entire quarter can get
      // fully scheduled before a different student's first session ever gets
      // a turn, which can push that student's real start date deep into the
      // quarter even though weeks 1-2 still had room when THEY were finally
      // considered. Final tiebreak: longer session first, so a short session
      // can't grab a slot that only a longer one really needed.
      const better = cands.length < bestCount ||
        (cands.length === bestCount && isFirstOcc && !bestIsFirstOcc) ||
        (cands.length === bestCount && isFirstOcc === bestIsFirstOcc && bestIdx !== -1 && session.sessionLength > pending[bestIdx].sessionLength);

      if (better) {
        bestCount = cands.length;
        bestIdx = idx;
        bestCandidates = cands;
        bestIsFirstOcc = isFirstOcc;
      }
    });

    const session = pending[bestIdx];

    if (bestCandidates.length === 0) {
      unscheduled.push({ session, reason: 'No slot satisfies provider availability + grade/student blackouts + one-session-per-day limit across the quarter' });
      pending.splice(bestIdx, 1);
      continue;
    }

    // Selection order:
    //  1. For quarterly (ANY_WEEK) sessions, prefer a week this student/group hasn't
    //     used yet - spreads sessions one-per-week like a normal recurring visit
    //     before ever doubling up in an already-used week.
    //  2. If "Front-Load First Sessions" is on, a student/group's VERY FIRST
    //     session prefers Week 1 or 2 specifically - this is what makes the
    //     2-week Printable_Schedule view actually show everyone (not just
    //     whoever happened to get placed early) and gives every quarterly
    //     student's therapy a genuine start date near the top of the quarter,
    //     rather than trickling in throughout. This is a soft preference, not
    //     a hard requirement - if weeks 1-2 truly have no room, the session
    //     still gets placed later rather than going unscheduled over it.
    //  3. If "Prefer Consistent Weekly Pattern" is on, prefer whichever day/time
    //     this same student/group has already landed on in an earlier week - so
    //     a quarterly student settles into "always Tuesday at 9am" rather than a
    //     different day/time every occurrence, which is easier for the provider,
    //     teachers, and the student to get used to.
    //  4. Whichever day is least booked so far, so everyone doesn't pile onto Monday.
    //  5. Earliest week, then earliest day, then earliest time.
    const reqWeekLoad = (c) => {
      if (session.week !== ANY_WEEK_KEY) return 0;
      const used = (reqDaysUsed[session.reqId] && reqDaysUsed[session.reqId][String(c.week)]) || [];
      return used.length;
    };
    const isFirstOccurrence = !isReqIdRepresented(scheduled, session);
    const earlyStartBonus = (c) => {
      if (!settings.frontLoadFirstSessions || session.week !== ANY_WEEK_KEY || !isFirstOccurrence) return 0;
      const wk = c.week === ALL_WEEKS_KEY ? 0 : c.week;
      return wk <= 2 ? 0 : 1; // 0 sorts first - Week 1 or 2
    };
    const matchesEstablishedPattern = (c) => {
      if (!settings.preferConsistentPattern || session.week !== ANY_WEEK_KEY) return 0;
      const alreadyUsesThisSlot = scheduled.some(s => s.reqId === session.reqId && s.day === c.day && s.start === c.start);
      return alreadyUsesThisSlot ? 0 : 1; // 0 sorts first - matches this student's established day/time
    };
    const weeksForCandidate = (c) => weeksForEntry(c.week, settings);
    const dayLoad = (c) => weeksForCandidate(c).reduce((sum, w) => sum + ((providerBookingsByWeek[w][c.day] || []).length), 0);

    bestCandidates.sort((a, b) => {
      const weekLoadDiff = reqWeekLoad(a) - reqWeekLoad(b);
      if (weekLoadDiff !== 0) return weekLoadDiff;
      const earlyDiff = earlyStartBonus(a) - earlyStartBonus(b);
      if (earlyDiff !== 0) return earlyDiff;
      const patternDiff = matchesEstablishedPattern(a) - matchesEstablishedPattern(b);
      if (patternDiff !== 0) return patternDiff;
      const dayLoadDiff = dayLoad(a) - dayLoad(b);
      if (dayLoadDiff !== 0) return dayLoadDiff;
      const wa = a.week === ALL_WEEKS_KEY ? 0 : a.week;
      const wb = b.week === ALL_WEEKS_KEY ? 0 : b.week;
      if (wa !== wb) return wa - wb;
      return DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start;
    });
    const pick = bestCandidates[0];
    const weeksToBook = weeksForEntry(pick.week, settings);

    weeksToBook.forEach(w => {
      providerBookingsByWeek[w][pick.day].push({ start: pick.start, end: pick.end });
      session.members.forEach(m => memberBookingsByWeek[m.id][w][pick.day].push({ start: pick.start, end: pick.end }));
    });

    const weekKey = String(pick.week);
    if (!reqDaysUsed[session.reqId]) reqDaysUsed[session.reqId] = {};
    if (!reqDaysUsed[session.reqId][weekKey]) reqDaysUsed[session.reqId][weekKey] = [];
    reqDaysUsed[session.reqId][weekKey].push(pick.day);

    scheduled.push({
      reqId: session.reqId, members: session.members, week: pick.week,
      day: pick.day, start: pick.start, end: pick.end,
      sessionIndex: session.sessionIndex, totalSessions: session.totalSessions
    });

    pending.splice(bestIdx, 1);
  }

  // Rescue pass: individual students still unscheduled get a shot at joining
  // an already-scheduled, compatible bucket-mate's session - existing manual
  // groups are never touched, and nothing here changes the Students sheet.
  const rescuedEntries = attemptGroupRescue(unscheduled, scheduled, individualsById, settings,
    gradeBlackouts, studentConstraints, memberBookingsByWeek, reqDaysUsed, groupIdState);

  if (rescuedEntries.length) {
    const rescuedSet = new Set(rescuedEntries);
    unscheduled = unscheduled.filter(u => !rescuedSet.has(u));
  }
  const rescuedStudentCount = rescuedEntries.length;
  const rescuedGroupCount = new Set(
    scheduled.filter(e => e.groupId && String(e.groupId).indexOf('AUTO-GROUP-') === 0).map(e => e.groupId)
  ).size;

  writeScheduleLog(scheduled);
  writeScheduleReview(scheduled, unscheduled, capacityWarnings);
  writeOpenSlotsGrid();
  updateReadMeStatus(scheduled.length, unscheduled.length, rescuedStudentCount);

  const warnMsg = capacityWarnings.length ? ` ${capacityWarnings.length} student(s)/group(s) flagged with warnings.` : '';
  const rescueMsg = rescuedGroupCount
    ? ` ${rescuedStudentCount} student(s) rescued into ${rescuedGroupCount} auto-formed group(s) (Group ID starts "AUTO-" - review for clinical fit).`
    : '';
  ss.toast(`Scheduled ${scheduled.length} sessions. ${unscheduled.length} session(s) could not be placed.${warnMsg}${rescueMsg} See Schedule_Review tab.`, 'Done', 8);
}
