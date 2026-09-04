import test from 'node:test';
import assert from 'node:assert/strict';
import { relayoutStations, MAP_LEFT, MAP_RIGHT, MAP_TOP, LINE_GAP } from '../dist/layout.js';
import { JourneyTimer, formatRemaining } from '../dist/timer.js';

function fixture() {
  return {
    schemaVersion: 2,
    profile: { studyArea: 'Medicine', periodName: 'Semester 4', createdAt: 0 },
    lines: [
      { id: 'a', name: 'Anatomy', color: '#000000', stationIds: ['a1', 'a2', 'a3'] },
      { id: 'p', name: 'Physiology', color: '#111111', stationIds: ['p1', 'p2'] }
    ],
    stations: [
      { id: 'a1', lineId: 'a', name: 'One', x: 0, y: 0, status: 'not_started', estimatedMinutes: 50 },
      { id: 'a2', lineId: 'a', name: 'Two', x: 0, y: 0, status: 'not_started', estimatedMinutes: 50 },
      { id: 'a3', lineId: 'a', name: 'Three', x: 0, y: 0, status: 'not_started', estimatedMinutes: 50 },
      { id: 'p1', lineId: 'p', name: 'One', x: 0, y: 0, status: 'not_started', estimatedMinutes: 50 },
      { id: 'p2', lineId: 'p', name: 'Two', x: 0, y: 0, status: 'not_started', estimatedMinutes: 50 }
    ],
    history: [], selectedStationId: 'a1', preferredDuration: 50, activeJourney: null,
    premiumUntil: null, isPaidPremium: false
  };
}

test('metro layout respects line and station order', () => {
  const state = relayoutStations(fixture());
  const byId = Object.fromEntries(state.stations.map((s) => [s.id, s]));
  assert.equal(byId.a1.x, MAP_LEFT);
  assert.equal(byId.a3.x, MAP_RIGHT);
  assert.equal(byId.a1.y, MAP_TOP);
  assert.equal(byId.p1.y, MAP_TOP + LINE_GAP);
  assert.ok(byId.a1.x < byId.a2.x && byId.a2.x < byId.a3.x);
});

test('restored timer uses timestamps rather than interval ticks', () => {
  const timer = new JourneyTimer();
  timer.restore({
    phase: 'focusing', startedAt: 1_000, targetEndAt: 61_000,
    pausedAt: null, totalPausedMs: 0, durationMs: 60_000
  });
  assert.equal(timer.remainingMs(31_000), 30_000);
  assert.equal(timer.progress(31_000), 0.5);
  timer.tick(61_000);
  assert.equal(timer.state.phase, 'complete');
});

test('paused restored timer freezes remaining time', () => {
  const timer = new JourneyTimer();
  timer.restore({
    phase: 'paused', startedAt: 1_000, targetEndAt: 61_000,
    pausedAt: 21_000, totalPausedMs: 0, durationMs: 60_000
  });
  assert.equal(timer.remainingMs(999_000), 40_000);
});

test('timer display formatting is stable', () => {
  assert.equal(formatRemaining(90_000), '01:30');
  assert.equal(formatRemaining(0), '00:00');
});
