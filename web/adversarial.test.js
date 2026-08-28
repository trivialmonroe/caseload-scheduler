#!/usr/bin/env node
'use strict';

/**
 * Adversarial logic checks for import, calendar week labels, and session editing rules.
 * Run: node web/adversarial.test.js
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

function baseInput(overrides) {
  return Object.assign({
    settings: eng.buildSettings({}),
    students: [{
      id: 'solo', firstName: 'Solo', lastName: 'Kid', grade: '3', serviceType: 'Individual',
      noGroup: true, frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active'
    }, {
      id: 'peer', firstName: 'Peer', lastName: 'Kid', grade: '3', serviceType: 'Individual',
      noGroup: false, frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active'
    }],
    availability: [{ day: 'Mon', start: '8:00 AM', end: '3:00 PM', pattern: '' }],
    grades: [],
    constraints: [],
    scheduleLog: [{
      studentId: 'solo', name: 'Solo Kid', grade: '3', groupId: '', week: '', day: 'Mon',
      start: '9:00 AM', end: '9:30 AM', duration: 30, teacher: '', locked: ''
    }, {
      studentId: 'peer', name: 'Peer Kid', grade: '3', groupId: '', week: 'Week 1', day: 'Tue',
      start: '10:00 AM', end: '10:30 AM', duration: 30, teacher: '', locked: ''
    }]
  }, overrides || {});
}

console.log('\n=== Import / CSV ===');

assert(
  'Schedule_Review.csv is not schedule',
  eng.detectCsvKind(['Student ID', 'Name', 'Status'], 'Schedule_Review.csv') !== 'schedule',
  'got ' + eng.detectCsvKind(['Student ID', 'Name', 'Status'], 'Schedule_Review.csv')
);

assert(
  'Valid column does not steal Student ID',
  eng.normalizeImportedStudent({ 'Student ID': 'real', 'Valid': 'oops' }).id === 'real'
);

assert(
  'Blank imported week becomes Every Week',
  eng.importTableRows('schedule', [{ studentId: 'x', name: 'X', grade: '1', day: 'Mon', start: '9:00 AM', end: '9:30 AM', week: '' }])[0].week === 'Every Week'
);

assert(
  'Both pattern means every week',
  eng.importTableRows('availability', [{ day: 'Mon', start: '8:00', end: '3:00', pattern: 'Both' }])[0].pattern === ''
);

console.log('\n=== Calendar week labels ===');

const cal = eng.buildCalendarModel(
  [{ studentId: 'a', name: 'A', grade: '1', week: '', day: 'Mon', start: '9:00 AM', end: '9:30 AM' }],
  eng.buildSettings({}),
  false,
  [{ day: 'Mon', start: '8:00 AM', end: '3:00 PM' }]
);
assert(
  'Blank week shows on calendar as Every Week',
  cal.entries.some(e => e.weekLabel === 'Every Week' && e.day === 'Mon'),
  'entries: ' + JSON.stringify(cal.entries.map(e => e.weekLabel))
);

console.log('\n=== Move / alternative slot occupancy ===');

const input = baseInput();
const alt = eng.findAlternativeSlots(input, input.scheduleLog[0]);
assert(
  'findAlternativeSlots runs for blank-week session',
  !alt.error && Array.isArray(alt.candidates),
  alt.error || 'no candidates array'
);

console.log('\n=== Session editor rules ===');

const addBlock = eng.canAddStudentToSession(input, input.scheduleLog[0], 'peer');
assert(
  'Cannot add to No Group host session',
  !addBlock.ok && /No Group/i.test(addBlock.error),
  addBlock.error || 'unexpected ok'
);

const soloAdd = eng.canAddStudentToSession(input, input.scheduleLog[1], 'solo');
assert(
  'No Group student cannot be added elsewhere',
  !soloAdd.ok && /No Group/i.test(soloAdd.error)
);

console.log('\n=== Workbook merge ===');

const ws = { settings: eng.buildSettings({}), students: [{ id: 'old' }], availability: [], grades: [], constraints: [], scheduleLog: [] };
eng.applyWorkbookImports(ws, {
  students: [{ 'Student ID': 'new', 'First Name': 'N', 'Last Name': 'N', 'Grade': '1', 'Minutes/Week': '30' }]
}, { merge: false });
assert('Workbook replace students', ws.students.length === 1 && ws.students[0].id === 'new');

console.log('\n=== Validation ===');

assert(
  'Missing grade blocks is not a validation issue',
  !eng.validateCaseload({
    settings: {},
    students: [{ id: 'w1', firstName: 'Walk', lastName: 'In', grade: '4', serviceType: 'Walk in', frequencyType: 'Weekly', minutesPerWeek: 30, status: 'Active' }],
    availability: [{ day: 'Mon', start: '8:00 AM', end: '3:00 PM' }],
    grades: []
  }).some(i => /grade-level blocks/i.test(i))
);

console.log('\n=== Locked blank week ===');

const locked = eng.loadLockedSessions([{
  studentId: 'x', week: '', day: 'Mon', start: '9:00 AM', end: '9:30 AM', locked: 'Yes'
}]);
assert(
  'Locked blank week applies to ALL weeks key',
  locked.length === 1 && locked[0].week === eng.ALL_WEEKS_KEY || locked[0].week === 'ALL',
  JSON.stringify(locked)
);

console.log('\n--- ' + passed + ' passed, ' + failed + ' failed ---\n');
process.exit(failed ? 1 : 0);
