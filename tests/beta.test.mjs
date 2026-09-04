import test from 'node:test';
import assert from 'node:assert/strict';
import { nameError, topicsError, validDuration } from '../dist/validation.js';
import { normalizeState } from '../dist/recovery.js';
import { createDemoState } from './fixtures.mjs';
import { JourneyTimer } from '../dist/timer.js';

test('names reject empty, duplicate, overlong and excess topic input', () => {
  assert.ok(nameError('   '));
  assert.ok(nameError(' anatomy ', ['ANATOMY'], 40));
  assert.ok(nameError('a'.repeat(41), [], 40));
  assert.equal(nameError('Renal', ['Cardio']), null);
  assert.ok(topicsError([]));
  assert.ok(topicsError(['Head  & Neck', 'head & neck']));
  assert.ok(topicsError(['a'.repeat(65)]));
  assert.ok(topicsError(Array.from({length:41}, (_,i) => `Topic ${i}`)));
});

test('durations reject nonfinite, fractional and out-of-range input', () => {
  for (const value of [NaN, Infinity, -1, 0, 4, 240.5, 241, 5.1]) assert.equal(validDuration(value), false);
  for (const value of [5, 25, 50, 90, 240]) assert.equal(validDuration(value), true);
});

test('recovery accepts arbitrary damaged roots and independently salvages usable records', () => {
  for (const input of [null, 1, 'text', [], {lines: {}, stations: 'bad', history: false}]) assert.doesNotThrow(() => normalizeState(input));
  const saved = createDemoState();
  saved.lines.push(null);
  saved.lines[0].stationIds = ['thorax', 'missing', 'thorax'];
  saved.stations.push(null, {id:'bad'});
  saved.stations[0].name = null;
  saved.stations[1].estimatedMinutes = Infinity;
  saved.history = [null, {id:'j',stationId:'thorax',lineId:'anatomy',startedAt:1,completedAt:2,focusedSeconds:1500}];
  saved.activeJourney = {timer:{phase:'focusing'}};
  const restored = normalizeState(saved);
  assert.equal(restored.lines.length, 3);
  assert.equal(restored.stations.length, 14);
  assert.equal(restored.lines[0].stationIds.length, 5);
  assert.equal(restored.stations[0].status, 'completed');
  assert.equal(restored.stations[1].estimatedMinutes, 50);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.activeJourney, null);
});

test('running refresh, sleep/wake and repeated ticks finish once without decrementing time', () => {
  const timer = new JourneyTimer();
  timer.restore({phase:'focusing',startedAt:1000,targetEndAt:301000,pausedAt:null,totalPausedMs:0,durationMs:300000});
  const restored = new JourneyTimer(); restored.restore(timer.export());
  assert.equal(restored.remainingMs(121000), 180000);
  restored.tick(9999999);
  assert.equal(restored.state.phase, 'complete');
  restored.tick(99999999);
  assert.equal(restored.progress(99999999), 1);
});

test('paused refresh and resume shift the deadline by the actual pause duration', t => {
  const original = Date.now; let now = 1000;
  Date.now = () => now; t.after(() => { Date.now = original; });
  const timer = new JourneyTimer(); timer.start(5);
  now = 61000; timer.pause();
  const restored = new JourneyTimer(); restored.restore(timer.export());
  now = 3601000;
  assert.equal(restored.remainingMs(), 240000);
  restored.resume();
  assert.equal(restored.remainingMs(), 240000);
  now += 240000; restored.tick();
  assert.equal(restored.state.phase, 'complete');
});
