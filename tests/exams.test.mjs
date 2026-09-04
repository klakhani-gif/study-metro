import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { examProgress, daysUntil, isCalendarDate, validateExam, normalizeExams, examCountdown } from '../dist/exams.js';
import { createDemoState } from './fixtures.mjs';

const now = new Date(2026, 8, 4, 23, 59).getTime();
const exam = { id: 'final', lineId: 'anatomy', name: 'Anatomy Final', examDate: '2026-09-21', targetCompletionDate: null };

test('exam totals count only the subject study stations and unfinished estimates', () => {
  const state = createDemoState();
  state.lines[0].stationIds.push('thorax'); // Defensive: repeated references do not count twice.
  const result = examProgress(state, exam, now);
  assert.deepEqual(result, { total: 5, completed: 2, remaining: 3, estimatedMinutes: 155, daysRemaining: 17, planningDays: 17, status: 'On track' });
  assert.equal(state.stations.find(s => s.id === 'pelvis').status, 'studying');
});

test('pace threshold is one day per unfinished station, target date takes precedence', () => {
  const state = createDemoState();
  assert.equal(examProgress(state, { ...exam, examDate: '2026-09-07' }, now).status, 'On track');
  assert.equal(examProgress(state, { ...exam, examDate: '2026-09-06' }, now).status, 'Attention needed');
  assert.equal(examProgress(state, { ...exam, targetCompletionDate: '2026-09-06' }, now).status, 'Attention needed');
  assert.equal(examProgress(state, { ...exam, examDate: '2026-09-04' }, now).status, 'Attention needed');
  assert.equal(examProgress(state, { ...exam, examDate: '2026-09-01' }, now).daysRemaining, -3);
});

test('completed and mastered count as complete, revision-due still needs study', () => {
  const state = createDemoState();
  state.stations.filter(s => s.lineId === 'anatomy').forEach(s => { s.status = 'mastered'; });
  const result = examProgress(state, { ...exam, examDate: '2026-09-01' }, now);
  assert.equal(result.status, 'Completed');
  assert.equal(result.remaining, 0);
  assert.equal(result.estimatedMinutes, 0);
  state.stations[0].status = 'revision_due';
  assert.equal(examProgress(state, exam, now).remaining, 1);
});

test('calendar validation rejects overflow dates and targets after the exam', () => {
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2028-02-29'), true);
  for (const value of ['', null, '2026-09-31', '2026-13-01', '2026-9-01', '2026-09-21T12:00:00Z']) assert.equal(isCalendarDate(value), false);
  assert.match(validateExam('Final', '2026-09-21', '2026-09-22'), /on or before/);
  assert.equal(validateExam('Final', '2026-09-21', '2026-09-21'), null);
  assert.equal(validateExam('Final', '2026-09-21', null), null);
  assert.match(validateExam('   ', '2026-09-21', null), /name/);
  assert.equal(examCountdown(0), 'EXAM TODAY');
  assert.equal(examCountdown(1), '1 DAY');
  assert.equal(examCountdown(-2), '2D SINCE EXAM');
  assert.equal(daysUntil('2026-09-21', now), 17);
});

test('calendar-day countdown survives DST and east/west timezone boundaries', () => {
  const moduleUrl = new URL('../dist/exams.js', import.meta.url).href;
  const cases = [
    ['America/New_York', '2026-03-07T23:30:00-05:00', '2026-03-09', 2],
    ['America/New_York', '2026-10-31T23:30:00-04:00', '2026-11-02', 2],
    ['Asia/Kolkata', '2026-09-04T00:15:00+05:30', '2026-09-21', 17],
    ['America/Los_Angeles', '2026-09-04T23:45:00-07:00', '2026-09-21', 17]
  ];
  for (const [tz, timestamp, date, expected] of cases) {
    const code = `import {daysUntil} from ${JSON.stringify(moduleUrl)}; process.stdout.write(String(daysUntil(${JSON.stringify(date)},Date.parse(${JSON.stringify(timestamp)}))));`;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(Number(result), expected, tz);
  }
});

test('normalization drops invalid/orphan/duplicate exams and repairs only invalid targets', () => {
  const normalized = normalizeExams([exam, { ...exam, id: 'duplicate' }, { ...exam, id: 'orphan', lineId: 'missing' }, { ...exam, id: 'bad', lineId: 'physiology', examDate: '2026-02-30' }, { ...exam, id: 'other', lineId: 'physiology', targetCompletionDate: '2026-10-01' }], new Set(['anatomy', 'physiology']));
  assert.equal(normalized.length, 2);
  assert.equal(normalized[1].targetCompletionDate, null);
  assert.deepEqual(normalizeExams(undefined, new Set()), []);
  assert.deepEqual(normalizeExams({}, new Set()), []);
});
