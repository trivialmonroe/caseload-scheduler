#!/usr/bin/env node
'use strict';

/**
 * Single entry point for web regression suites (no package manager required).
 * Run from repo root: node web/run-tests.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  { name: 'adversarial', file: path.join(__dirname, 'adversarial.test.js') },
  { name: 'invariants', file: path.join(__dirname, 'invariants.test.js') }
];

let failedSuites = 0;
suites.forEach(suite => {
  console.log('\n######## ' + suite.name + ' ########');
  const res = spawnSync(process.execPath, [suite.file], { stdio: 'inherit' });
  if (res.status !== 0) failedSuites++;
});

console.log('\n========');
if (failedSuites) {
  console.error(failedSuites + ' suite(s) failed.');
  process.exit(1);
}
console.log('All ' + suites.length + ' suites passed.');
process.exit(0);
