#!/usr/bin/env node
/**
 * Local verification harness for the Caseload Scheduler engine.
 *
 * The product itself only runs inside Google Apps Script (bound to a Google
 * Sheet, behind Google OAuth), so it can't be launched headlessly. But every
 * `.gs` file is plain V8 JavaScript sharing one global scope, so this harness
 * loads them unmodified, stubs the Google-only globals (SpreadsheetApp / etc.)
 * with a tiny in-memory fake spreadsheet, seeds a realistic sample caseload
 * (the examples from README.md), and runs the real `generateSchedule()`
 * entry point end to end -- then prints the generated Schedule_Log and
 * Schedule_Review so you can see the algorithm actually placed sessions.
 *
 * It does NOT modify any repository source; it only reads the .gs files.
 *
 * Usage:  node dev/run-engine.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Minimal in-memory fake of the Google Apps Script Spreadsheet service.
// Only the surface the engine touches is implemented; every other chained
// formatting call (setBackground, setBorder, merge, setColumnWidth, ...) is a
// no-op that returns `this` so method chains keep working.
// ---------------------------------------------------------------------------
function makeSheet(name) {
  const data = []; // data[rowIdx][colIdx], 0-indexed internally

  const get = (r, c) => (data[r] && data[r][c] !== undefined ? data[r][c] : '');
  const set = (r, c, v) => {
    if (!data[r]) data[r] = [];
    data[r][c] = v;
  };
  const nonEmpty = (v) => v !== '' && v !== null && v !== undefined;

  function makeRange(row, col, numRows, numCols) {
    const range = {
      getRow: () => row,
      getColumn: () => col,
      getNumRows: () => numRows,
      getLastRow: () => row + numRows - 1,
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const rowArr = [];
          for (let c = 0; c < numCols; c++) rowArr.push(get(row - 1 + r, col - 1 + c));
          out.push(rowArr);
        }
        return out;
      },
      getValue: () => get(row - 1, col - 1),
      setValues(vals) {
        for (let r = 0; r < vals.length; r++)
          for (let c = 0; c < vals[r].length; c++) set(row - 1 + r, col - 1 + c, vals[r][c]);
        return proxy;
      },
      setValue(v) {
        set(row - 1, col - 1, v);
        return proxy;
      },
      clearContent() {
        for (let r = 0; r < numRows; r++)
          for (let c = 0; c < numCols; c++) set(row - 1 + r, col - 1 + c, '');
        return proxy;
      },
    };
    const proxy = new Proxy(range, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => proxy; // chainable no-op for any formatting method
      },
    });
    return proxy;
  }

  const sheet = {
    getName: () => name,
    getLastRow() {
      let last = 0;
      for (let r = 0; r < data.length; r++) if (data[r] && data[r].some(nonEmpty)) last = r + 1;
      return last;
    },
    getLastColumn() {
      let last = 0;
      for (let r = 0; r < data.length; r++) {
        if (!data[r]) continue;
        for (let c = data[r].length - 1; c >= 0; c--) {
          if (nonEmpty(data[r][c])) {
            last = Math.max(last, c + 1);
            break;
          }
        }
      }
      return last;
    },
    getMaxRows: () => Math.max(data.length, 1000),
    getRange: (r, c, nr, nc) => makeRange(r, c, nr || 1, nc || 1),
    clear() {
      data.length = 0;
      return sheetProxy;
    },
    getRowHeight: () => 21,
    getColumnWidth: () => 100,
    getBandings: () => [],
  };
  const sheetProxy = new Proxy(sheet, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => sheetProxy; // chainable no-op
    },
  });
  return sheetProxy;
}

function makeSpreadsheet() {
  const byName = {};
  let active = null;
  const toasts = [];
  const ss = {
    _sheets: byName,
    _toasts: toasts,
    getSheetByName: (n) => byName[n] || null,
    insertSheet(n) {
      const s = makeSheet(n);
      byName[n] = s;
      if (!active) active = s;
      return s;
    },
    getActiveSheet: () => active,
    setActiveSheet(s) {
      active = s;
      return s;
    },
    moveActiveSheet() {},
    setFrozenRows() {},
    toast(msg, title) {
      toasts.push({ title: title || '', msg });
    },
    getId: () => 'fake-spreadsheet',
  };
  return new Proxy(ss, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => proxy;
    },
  });
}

function chainable() {
  const obj = {};
  const proxy = new Proxy(obj, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => proxy;
    },
  });
  return proxy;
}

function makeSpreadsheetApp(ss) {
  const ui = new Proxy(
    { ButtonSet: { OK: 'OK' } },
    { get: (t, p) => (p in t ? t[p] : () => ui) }
  );
  const app = {
    getActiveSpreadsheet: () => ss,
    getActiveSheet: () => ss.getActiveSheet(),
    getActiveRange: () => null,
    getUi: () => ui,
    newConditionalFormatRule: () => chainable(),
    newDataValidation: () => chainable(),
    BorderStyle: { SOLID: 'SOLID' },
    BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
  };
  return app;
}

// ---------------------------------------------------------------------------
// Sample caseload (mirrors the examples in README.md).
// ---------------------------------------------------------------------------
function seed(ss) {
  const put = (name, rows) => {
    const s = ss.insertSheet(name);
    if (rows.length) s.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    return s;
  };

  put('Settings', [
    ['Setting', 'Value'],
    ['Slot Increment (min)', 5],
    ['School Days', 'Mon,Tue,Wed,Thu,Fri'],
    ['Min Session Length (min)', 15],
    ['Max Session Length (min)', 60],
    ['Weeks Per Quarter', 9],
    ['Starting Week Pattern (A/B)', 'A'],
    ['Group Rescue Extra Minutes Allowed', 10],
    ['Max Students Per Auto-Group', 6],
    ['Prefer Consistent Weekly Pattern (Yes/No)', 'Yes'],
    ['Show Teacher on Schedule Outputs (Yes/No)', 'Yes'],
    ['Front-Load First Sessions Into Weeks 1-2 (Yes/No)', 'Yes'],
  ]);

  put('MyAvailability', [
    ['Day', 'Start Time', 'End Time', 'Week Pattern', 'Notes'],
    ['Mon-Fri', '8:00 AM', '11:00 AM', '', ''],
    ['Mon, Wed', '12:30 PM', '3:00 PM', '', ''],
    ['Tue, Thu, Fri', '12:30 PM', '2:30 PM', '', ''],
  ]);

  put('Grades', [
    ['Grade', 'Day', 'Start Time', 'End Time', 'Reason'],
    ['2', 'Mon-Fri', '11:30 AM', '12:15 PM', 'Lunch'],
    ['2', 'Tue', '1:00 PM', '1:45 PM', 'Specials'],
    ['K', 'Mon, Wed', '9:00 AM', '9:30 AM', 'Recess'],
    ['3', 'Mon-Fri', '11:00 AM', '11:45 AM', 'Lunch'],
  ]);

  put('Constraints', [
    ['Student ID', 'Day', 'Start Time', 'End Time', 'Reason'],
    ['SMITHJ01', 'Tue', '10:00 AM', '10:30 AM', 'OT'],
    ['JONESM02', 'Mon-Fri', '8:00 AM', '8:30 AM', 'Resource room'],
  ]);

  // Students columns (0..16): ID, First, Last, Grade, ServiceType, GroupID,
  // FrequencyType, Minutes/Week, PreferredLen, SessionsPerQuarter,
  // QuarterlyLen, Sessions/Week(auto), Notes, Status, Teacher, FixedDay, FixedStart
  const S = (id, first, last, grade, service, group, freq, minWk, prefLen, sq, qLen, teacher) => [
    id, first, last, grade, service, group, freq, minWk, prefLen, sq, qLen, '', '', 'Active', teacher, '', '',
  ];
  put('Students', [
    ['Student ID', 'First Name', 'Last Name', 'Grade', 'Service Type', 'Group ID', 'Frequency Type',
      'Minutes/Week Required', 'Preferred Session Length', 'Sessions Per Quarter', 'Session Length (Quarterly)',
      'Sessions/Week (auto)', 'Notes', 'Status', 'Teacher', 'Fixed Day', 'Fixed Start Time'],
    S('SMITHJ01', 'John', 'Smith', '2', 'Individual', '', 'Weekly', 60, '', '', '', 'Mrs. Lee - Rm 204'),
    S('JONESM02', 'Mary', 'Jones', '2', 'Individual', '', 'Weekly', 90, '', '', '', 'Mr. Kim - Rm 210'),
    S('DOEA03', 'Alex', 'Doe', 'K', 'Individual', '', 'Quarterly', '', '', 8, 30, 'Ms. Ray - Rm 101'),
    S('LEEB04', 'Bri', 'Lee', 'K', 'Individual', '', 'Weekly', 30, '', '', '', 'Ms. Ray - Rm 101'),
    S('PARKC05', 'Cam', 'Park', '3', 'Group', 'G1', 'Weekly', 45, '', '', '', 'Mr. Ade - Rm 305'),
    S('RIOSD06', 'Dana', 'Rios', '3', 'Group', 'G1', 'Weekly', 45, '', '', '', 'Mr. Ade - Rm 305'),
  ]);

  // Schedule_Log needs to exist (with its header) before Generate runs.
  put('Schedule_Log', [
    ['Student ID', 'Name', 'Grade', 'Group ID', 'Week', 'Day', 'Start Time', 'End Time',
      'Duration (min)', 'Teacher', 'Locked (Yes/No)'],
  ]);
}

// ---------------------------------------------------------------------------
// Load the unmodified .gs sources and expose the functions we need to drive.
// ---------------------------------------------------------------------------
function loadEngine(ss) {
  const files = ['Constants.gs', 'DataHelpers.gs', 'SchedulingEngine.gs', 'Outputs.gs', 'Setup.gs', 'Interactive.gs'];
  const src = files.map((f) => fs.readFileSync(path.join(REPO_ROOT, "apps-script", f), 'utf8')).join('\n\n');
  const body = src + '\nreturn { generateSchedule: generateSchedule };';
  const factory = new Function('SpreadsheetApp', 'HtmlService', 'Logger', body);
  const SpreadsheetApp = makeSpreadsheetApp(ss);
  const noop = chainable();
  return factory(SpreadsheetApp, noop, noop);
}

function readSheet(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
}

function printTable(title, rows) {
  console.log('\n=== ' + title + ' ===');
  if (!rows.length) {
    console.log('(empty)');
    return;
  }
  const widths = [];
  rows.forEach((r) => r.forEach((c, i) => {
    const len = String(c == null ? '' : c).length;
    widths[i] = Math.max(widths[i] || 0, len);
  }));
  rows.forEach((r) => {
    console.log(r.map((c, i) => String(c == null ? '' : c).padEnd(widths[i])).join(' | '));
  });
}

function main() {
  const ss = makeSpreadsheet();
  seed(ss);
  const engine = loadEngine(ss);

  console.log('Running generateSchedule() on the sample caseload...');
  engine.generateSchedule();

  const log = readSheet(ss, 'Schedule_Log');
  const review = readSheet(ss, 'Schedule_Review');

  printTable('Schedule_Log (generated sessions)', log);
  printTable('Schedule_Review (compliance)', review);

  const placedRows = Math.max(0, log.length - 1); // minus header
  if (ss._toasts.length) console.log('\nEngine status: ' + ss._toasts[ss._toasts.length - 1].msg);

  if (placedRows < 1) {
    console.error('\nFAIL: no sessions were placed.');
    process.exit(1);
  }
  console.log('\nOK: ' + placedRows + ' scheduled session row(s) written to Schedule_Log.');
}

main();
