#!/usr/bin/env node
'use strict';

/**
 * Schedule integrity / regression checks for erratic user-facing bugs.
 * Run: node web/invariants.test.js
 * Or via: node web/run-tests.js
 */
const eng = require('./engine.js');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  OK  ' + name);
  } else {
    failed++;
    console.error(' FAIL ' + name + (detail ? ': ' + detail : ''));
  }
}

function sampleCaseload() {
  return {
    settings: eng.buildSettings({}),
    students: [
      { id: 'SMITHJ01', firstName: 'John', lastName: 'Smith', grade: '2', serviceType: 'Individual',
        frequencyType: 'Weekly', minutesPerWeek: 60, status: 'Active', teacher: 'Mrs. Lee' },
      { id: 'JONESM02', firstName: 'Mary', lastName: 'Jones', grade: '2', serviceType: 'Individual',
        frequencyType: 'Weekly', minutesPerWeek: 90, status: 'Active', teacher: 'Mr. Kim' },
      { id: 'DOEA03', firstName: 'Alex', lastName: 'Doe', grade: 'K', serviceType: 'Individual',
        frequencyType: 'Quarterly', sessionsPerQuarter: 8, quarterlySessionLength: 30, status: 'Active' },
      { id: 'LEEB04', firstName: 'Bri', lastName: 'Lee', grade: 'K', serviceType: 'Individual',
        frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' },
      { id: 'PARKC05', firstName: 'Cam', lastName: 'Park', grade: '3', serviceType: 'Group', groupId: 'G1',
        frequencyType: 'Weekly', minutesPerWeek: 45, status: 'Active' },
      { id: 'RIOSD06', firstName: 'Dana', lastName: 'Rios', grade: '3', serviceType: 'Group', groupId: 'G1',
        frequencyType: 'Weekly', minutesPerWeek: 45, status: 'Active' }
    ],
    availability: [
      { day: 'Mon-Fri', start: '8:00 AM', end: '11:00 AM', pattern: '' },
      { day: 'Mon, Wed', start: '12:30 PM', end: '3:00 PM', pattern: '' },
      { day: 'Tue, Thu, Fri', start: '12:30 PM', end: '2:30 PM', pattern: '' }
    ],
    grades: [
      { grade: '2', day: 'Mon-Fri', start: '11:30 AM', end: '12:15 PM', reason: 'Lunch' },
      { grade: '3', day: 'Mon-Fri', start: '11:00 AM', end: '11:45 AM', reason: 'Lunch' },
      { grade: 'K', day: 'Mon, Wed', start: '9:00 AM', end: '9:30 AM', reason: 'Recess' }
    ],
    constraints: [
      { studentId: 'SMITHJ01', day: 'Tue', start: '10:00 AM', end: '10:30 AM', reason: 'OT' },
      { studentId: 'JONESM02', day: 'Mon-Fri', start: '8:00 AM', end: '8:30 AM', reason: 'Resource' }
    ],
    scheduleLog: []
  };
}

console.log('\n=== Time window / sanity guardrails ===');

assert('parseTimeWindow rejects end before start', !eng.parseTimeWindow('9:00 AM', '8:00 AM').ok);
assert('parseTimeWindow rejects end == start', !eng.parseTimeWindow('9:00 AM', '9:00 AM').ok);
assert('parseTimeWindow accepts normal window', eng.parseTimeWindow('8:00 AM', '3:00 PM').ok &&
  eng.parseTimeWindow('8:00 AM', '3:00 PM').span === 7 * 60);
assert('buildSettings caps maxSessionLength at 2 hours',
  eng.buildSettings({ maxSessionLength: 400 }).maxSessionLength === eng.SANITY_MAX_SESSION_MINUTES);

const amPmAvail = eng.validateCaseload({
  settings: eng.buildSettings({}),
  students: [{ id: 'a', firstName: 'A', lastName: 'A', grade: '1', serviceType: 'Individual',
    frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }],
  availability: [{ day: 'Mon', start: '8:00 AM', end: '8:00 PM', pattern: '' }],
  grades: [],
  constraints: []
});
assert('Very long availability window is flagged',
  amPmAvail.some(m => /hours/i.test(m) && /AM\/PM/i.test(m)),
  JSON.stringify(amPmAvail));

const badEnd = eng.validateCaseload({
  settings: eng.buildSettings({}),
  students: [{ id: 'a', firstName: 'A', lastName: 'A', grade: '1', serviceType: 'Individual',
    frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }],
  availability: [{ day: 'Mon', start: '2:00 PM', end: '9:00 AM', pattern: '' }],
  grades: [],
  constraints: []
});
assert('Availability end-before-start is flagged',
  badEnd.some(m => /End must be after start/i.test(m)),
  JSON.stringify(badEnd));

const longBlackout = eng.validateCaseload({
  settings: eng.buildSettings({}),
  students: [{ id: 'a', firstName: 'A', lastName: 'A', grade: '2', serviceType: 'Individual',
    frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }],
  availability: [{ day: 'Mon', start: '8:00 AM', end: '3:00 PM', pattern: '' }],
  grades: [{ grade: '2', day: 'Mon', start: '8:00 AM', end: '2:00 PM', reason: 'Oops' }],
  constraints: []
});
assert('Long grade blackout is flagged',
  longBlackout.some(m => /Grade block/i.test(m) && /hours/i.test(m)),
  JSON.stringify(longBlackout));

const hugePref = eng.validateCaseload({
  settings: eng.buildSettings({}),
  students: [{ id: 'a', firstName: 'A', lastName: 'A', grade: '1', serviceType: 'Individual',
    frequencyType: 'Weekly', minutesPerWeek: 30, preferredSessionLength: 180, status: 'Active' }],
  availability: [{ day: 'Mon', start: '8:00 AM', end: '3:00 PM', pattern: '' }],
  grades: [],
  constraints: []
});
assert('Preferred session > 2 hours is flagged',
  hugePref.some(m => /preferred session length/i.test(m)),
  JSON.stringify(hugePref));

const giantSession = eng.validateScheduleLog({
  students: [{ id: 'a', firstName: 'A', lastName: 'A', grade: '1', serviceType: 'Individual',
    frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }],
  scheduleLog: [{
    studentId: 'a', name: 'A A', week: 'Every Week', day: 'Mon',
    start: '8:00 AM', end: '11:00 AM', duration: 180, locked: ''
  }]
});
assert('Schedule session over 2 hours is an error',
  !giantSession.ok && giantSession.errors.some(e => /sanity limit/i.test(e)),
  JSON.stringify(giantSession.errors));

console.log('\n=== validateScheduleLog basics ===');

assert(
  'Empty log is healthy',
  eng.validateScheduleLog({ students: [], scheduleLog: [] }).ok
);

const brokenDur = eng.validateScheduleLog({
  students: [{ id: 'a', firstName: 'A', lastName: 'A', grade: '1', serviceType: 'Individual',
    frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }],
  scheduleLog: [{
    studentId: 'a', name: 'A A', grade: '1', week: 'Every Week', day: 'Mon',
    start: '9:00 AM', end: '9:30 AM', duration: 45, locked: ''
  }]
});
assert('Duration mismatch is an error', !brokenDur.ok && brokenDur.errors.some(e => /duration/i.test(e)),
  JSON.stringify(brokenDur.errors));

const studentClash = eng.validateScheduleLog({
  students: [{ id: 'a', firstName: 'A', lastName: 'A', grade: '1', serviceType: 'Individual',
    frequencyType: 'Weekly', minutesPerWeek: 60, status: 'Active' }],
  scheduleLog: [
    { studentId: 'a', name: 'A A', week: 'Every Week', day: 'Mon', start: '9:00 AM', end: '9:30 AM', duration: 30 },
    { studentId: 'a', name: 'A A', week: 'Week 1', day: 'Mon', start: '9:15 AM', end: '9:45 AM', duration: 30 }
  ]
});
assert('Same-student overlap is an error', !studentClash.ok && studentClash.errors.some(e => /same student/i.test(e)),
  JSON.stringify(studentClash.errors));

const providerClash = eng.validateScheduleLog({
  students: [
    { id: 'a', firstName: 'A', lastName: 'A', grade: '1', serviceType: 'Individual',
      frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' },
    { id: 'b', firstName: 'B', lastName: 'B', grade: '1', serviceType: 'Individual',
      frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }
  ],
  scheduleLog: [
    { studentId: 'a', name: 'A A', week: 'Every Week', day: 'Tue', start: '10:00 AM', end: '10:30 AM', duration: 30 },
    { studentId: 'b', name: 'B B', week: 'Every Week', day: 'Tue', start: '10:15 AM', end: '10:45 AM', duration: 30 }
  ]
});
assert('Provider double-book (different times) is an error',
  !providerClash.ok && providerClash.errors.some(e => /double-book/i.test(e)),
  JSON.stringify(providerClash.errors));

const sameSlotGroup = eng.validateScheduleLog({
  students: [
    { id: 'a', firstName: 'A', lastName: 'A', grade: '3', serviceType: 'Group', groupId: 'G1',
      frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' },
    { id: 'b', firstName: 'B', lastName: 'B', grade: '3', serviceType: 'Group', groupId: 'G1',
      frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }
  ],
  scheduleLog: [
    { studentId: 'a', name: 'A A', week: 'Every Week', day: 'Fri', start: '8:00 AM', end: '8:30 AM', duration: 30, groupId: 'G1' },
    { studentId: 'b', name: 'B B', week: 'Every Week', day: 'Fri', start: '8:00 AM', end: '8:30 AM', duration: 30, groupId: 'G1' }
  ]
});
assert('Same-slot group is allowed', sameSlotGroup.ok, JSON.stringify(sameSlotGroup.errors));

const orphan = eng.validateScheduleLog({
  students: [{ id: 'alive', firstName: 'A', lastName: 'Live', grade: '1', serviceType: 'Individual',
    frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }],
  scheduleLog: [{
    studentId: 'ghost', name: 'Ghost', week: 'Every Week', day: 'Mon',
    start: '9:00 AM', end: '9:30 AM', duration: 30
  }]
});
assert('Orphan student ID is a warning not hard error',
  orphan.ok && orphan.warnings.some(w => /not an active/i.test(w)),
  JSON.stringify(orphan));

console.log('\n=== Generate sample stays healthy ===');

const sample = sampleCaseload();
const caseloadIssues = eng.validateCaseload(sample);
assert('Sample caseload validates', caseloadIssues.length === 0, JSON.stringify(caseloadIssues));

const gen1 = eng.runSchedulingEngine(sample);
assert('Sample generate places sessions', (gen1.logRows || []).length > 0, 'sessionCount=' + gen1.sessionCount);
const health1 = eng.validateScheduleLog(Object.assign({}, sample, { scheduleLog: gen1.logRows }));
assert('Generated sample schedule is structurally healthy', health1.ok,
  JSON.stringify(health1.errors));

console.log('\n=== Locked sessions survive regenerate ===');

const lockedLog = (gen1.logRows || []).map((r, i) =>
  i === 0 ? Object.assign({}, r, { locked: 'Yes' }) : Object.assign({}, r)
);
const beforeLock = lockedLog.filter(r => String(r.locked).toLowerCase() === 'yes');
assert('Have at least one locked row to preserve', beforeLock.length >= 1);

const gen2 = eng.runSchedulingEngine(Object.assign({}, sample, { scheduleLog: lockedLog }));
const missing = eng.missingPreservedLocks(lockedLog, gen2.logRows);
assert('Locked placements survive regenerate', missing.length === 0, JSON.stringify(missing));
const health2 = eng.validateScheduleLog(Object.assign({}, sample, { scheduleLog: gen2.logRows }));
assert('Schedule after locked regenerate stays healthy', health2.ok, JSON.stringify(health2.errors));

console.log('\n=== Manual create integrity ===');

const manualBase = {
  settings: eng.buildSettings({}),
  students: sample.students.slice(0, 2),
  availability: [{ day: 'Mon, Wed', start: '8:00 AM', end: '12:00 PM', pattern: '' }],
  grades: [],
  constraints: [],
  scheduleLog: []
};
const placed = eng.createManualSession(manualBase, {
  studentId: 'SMITHJ01', day: 'Mon', start: '9:00 AM', duration: 30,
  week: 'Every Week', locked: true
});
assert('Manual create on available day works', placed.ok, placed.error || '');
const afterManual = Object.assign({}, manualBase, {
  scheduleLog: (manualBase.scheduleLog || []).concat([placed.row])
});
assert('Manual create log is healthy', eng.validateScheduleLog(afterManual).ok);

const clashCreate = eng.createManualSession(afterManual, {
  studentId: 'SMITHJ01', day: 'Mon', start: '9:00 AM', duration: 30,
  week: 'Every Week', locked: true
});
assert('Manual create blocks student self-overlap', !clashCreate.ok);

const offDay = eng.createManualSession(manualBase, {
  studentId: 'SMITHJ01', day: 'Fri', start: '9:00 AM', duration: 30,
  week: 'Every Week', locked: true
});
assert('Manual create off-day requires ignore flag', !offDay.ok && offDay.needsIgnoreAvailability);

console.log('\n=== EDIT-SOLO lock labels preserved ===');

const splitLog = [
  { studentId: 'PARKC05', name: 'Cam Park', grade: '3', groupId: 'EDIT-SOLO-PARKC05',
    week: 'Every Week', day: 'Fri', start: '8:00 AM', end: '8:45 AM', duration: 45, locked: 'Yes' },
  { studentId: 'RIOSD06', name: 'Dana Rios', grade: '3', groupId: 'EDIT-SOLO-RIOSD06',
    week: 'Every Week', day: 'Fri', start: '8:00 AM', end: '8:45 AM', duration: 45, locked: 'Yes' }
];
const splitInput = Object.assign({}, sample, { scheduleLog: splitLog });
assert('Co-located EDIT-SOLO pair is healthy (same slot allowed)', eng.validateScheduleLog(splitInput).ok);
const splitGen = eng.runSchedulingEngine(splitInput);
const cam = (splitGen.logRows || []).find(r => r.studentId === 'PARKC05');
const dana = (splitGen.logRows || []).find(r => r.studentId === 'RIOSD06');
assert('Cam EDIT-SOLO survives generate', cam && cam.groupId === 'EDIT-SOLO-PARKC05' && String(cam.locked).toLowerCase() === 'yes');
assert('Dana EDIT-SOLO survives generate', dana && dana.groupId === 'EDIT-SOLO-RIOSD06' && String(dana.locked).toLowerCase() === 'yes');
assert('Split mates stay independent',
  eng.sessionMateRows(splitGen.logRows, cam).length === 1);

console.log('\n=== Locked host blocks rescue (regression) ===');

const tight = {
  settings: eng.buildSettings({ minSessionLength: 30, preferredSessionLength: 30, maxSessionLength: 60 }),
  students: [
    { id: 'ann', firstName: 'Ann', lastName: 'A', grade: '3', serviceType: 'Individual',
      frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' },
    { id: 'bob', firstName: 'Bob', lastName: 'B', grade: '3', serviceType: 'Individual',
      frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }
  ],
  availability: [{ day: 'Mon', start: '9:00 AM', end: '9:30 AM', pattern: '' }],
  grades: [],
  constraints: [],
  scheduleLog: [{
    studentId: 'ann', name: 'Ann A', grade: '3', groupId: 'EDIT-GROUP-1', week: 'Every Week',
    day: 'Mon', start: '9:00 AM', end: '9:30 AM', duration: 30, locked: 'Yes'
  }]
};
const lockedHostRun = eng.runSchedulingEngine(tight);
const bobJoined = (lockedHostRun.scheduled || []).some(s =>
  s.members.some(m => m.id === 'ann') && s.members.some(m => m.id === 'bob')
);
assert('Bob does not join locked Ann', !bobJoined && (lockedHostRun.rescuedStudentCount || 0) === 0);

console.log('\n=== Coverage review arithmetic ===');

const covInput = Object.assign({}, sample, { scheduleLog: gen1.logRows });
const review = eng.reviewFromScheduleLog(covInput);
assert('Review has a row per active student', review.length === sample.students.length);
assert(
  'Review statuses are known values',
  review.every(r => ['Under', 'Met', 'Over'].indexOf(r.status) >= 0),
  JSON.stringify(review.map(r => r.status))
);
assert(
  'Scheduled minutes are non-negative integers',
  review.every(r => Number.isFinite(r.scheduled) && r.scheduled >= 0)
);

console.log('\n=== Calendar model sanity ===');

const cal = eng.buildCalendarModel(gen1.logRows, sample.settings, false, sample.availability);
assert('Calendar builds entries', (cal.entries || []).length > 0);
assert(
  'Calendar entries use normalized days',
  cal.entries.every(e => eng.DAYS.indexOf(e.day) >= 0)
);
assert(
  'Calendar entries have end after start',
  cal.entries.every(e => e.end > e.start)
);

console.log('\n--- invariants: ' + passed + ' passed, ' + failed + ' failed ---\n');
process.exit(failed ? 1 : 0);
