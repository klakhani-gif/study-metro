import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState } from './fixtures.mjs';
import { loadState, saveState } from '../dist/storage.js';

function storage(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  const api = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { value: api, configurable: true });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  return api;
}

test('v2 networks without exams migrate without changing active sessions or progress', t => {
  const db = storage(t);
  const saved = createDemoState();
  saved.schemaVersion = 2;
  delete saved.exams;
  delete saved.selectedExamId;
  saved.activeJourney = { stationId: 'renal', lineId: 'physiology', durationMinutes: 50, previousStationStatus: 'not_started', timer: { phase: 'paused', startedAt: 100, targetEndAt: 3000100, pausedAt: 200100, totalPausedMs: 10, durationMs: 3000000 } };
  saved.history = [{ id: 'journey', stationId: 'thorax', lineId: 'anatomy', startedAt: 1, completedAt: 2, focusedSeconds: 1500 }];
  db.setItem('study-metro:v2', JSON.stringify(saved));
  const state = loadState();
  assert.equal(state.schemaVersion, 3);
  assert.deepEqual(state.exams, []);
  assert.equal(state.selectedExamId, null);
  assert.deepEqual(state.activeJourney, saved.activeJourney);
  assert.deepEqual(state.history, saved.history);
  assert.deepEqual(state.lines, saved.lines);
  assert.deepEqual(state.stations.map(s => [s.id, s.status, s.estimatedMinutes]), saved.stations.map(s => [s.id, s.status, s.estimatedMinutes]));
  assert.equal(state.selectedStationId, saved.selectedStationId);
  assert.equal(state.preferredDuration, saved.preferredDuration);
});

test('legacy v1 still migrates through the existing storage key', t => {
  const db = storage(t);
  const saved = createDemoState();
  delete saved.exams; delete saved.selectedExamId; delete saved.profile;
  saved.schemaVersion = 1;
  db.setItem('study-metro:v1', JSON.stringify(saved));
  const migrated = loadState();
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.exams, []);
  assert.ok(migrated.profile);
  assert.equal(JSON.parse(db.getItem('study-metro:v2')).schemaVersion, 3);
});

test('exam and selection survive save/reload; removing only the exam preserves study data', t => {
  storage(t);
  const state = createDemoState();
  state.exams = [{ id: 'exam', lineId: 'anatomy', name: 'Final', examDate: '2026-09-21', targetCompletionDate: '2026-09-18' }];
  state.selectedExamId = 'exam';
  saveState(state);
  const restored = loadState();
  assert.deepEqual(restored.exams, state.exams);
  assert.equal(restored.selectedExamId, 'exam');
  saveState({ ...restored, exams: [], selectedExamId: null });
  const removed = loadState();
  assert.deepEqual(removed.lines, restored.lines);
  assert.deepEqual(removed.stations, restored.stations);
  assert.deepEqual(removed.history, restored.history);
  assert.deepEqual(removed.exams, []);
});

test('orphaned exam selection and malformed exam records do not erase the network', t => {
  const db = storage(t);
  const state = createDemoState();
  state.exams = [null, { id: 'gone', lineId: 'missing', name: 'Gone', examDate: '2026-09-21' }];
  state.selectedExamId = 'gone';
  db.setItem('study-metro:v2', JSON.stringify(state));
  const result = loadState();
  assert.equal(result.selectedExamId, null);
  assert.equal(result.lines.length, 3);
  assert.deepEqual(result.exams, []);
});

test('broken JSON is preserved before a replacement network is saved', t => {
  const db = storage(t);
  const raw = '{"lines":broken';
  db.setItem('study-metro:v2', raw);
  const state = loadState();
  assert.deepEqual(state.lines, []);
  assert.equal(db.getItem('study-metro:v2'), raw);
  saveState(state);
  assert.equal(db.getItem('study-metro:recovery'), raw);
});

test('future versions cannot be overwritten by this beta', t => {
  const db = storage(t);
  const saved = {...createDemoState(), schemaVersion:99};
  const raw = JSON.stringify(saved); db.setItem('study-metro:v2', raw);
  const state = loadState();
  assert.throws(() => saveState(state));
  assert.equal(db.getItem('study-metro:v2'), raw);
});

test('failed recovery backup leaves the original saved network intact', t => {
  const db = storage(t); db.setItem('study-metro:v2', '{broken');
  const state = loadState();
  db.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.throws(() => saveState(state));
  assert.equal(db.getItem('study-metro:v2'), '{broken');
});
