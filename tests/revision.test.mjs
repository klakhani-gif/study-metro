import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyRevisionInfo, completeStation, nextReviewDate, reviewIntervalDays, isMaintenanceDue } from '../dist/revision.js';
import { normalizeState } from '../dist/recovery.js';
import { examProgress } from '../dist/exams.js';
import { createDemoState } from './fixtures.mjs';

const DAY = 86400000;
const now = Date.UTC(2026, 8, 4, 12);
const station = () => ({...createDemoState().stations[0], ...emptyRevisionInfo(), status:'not_started'});

test('initial completion records first study and schedules maintenance in seven days', () => {
  const before = station();
  const done = completeStation(before, 'study', now);
  assert.equal(done.firstCompletedAt, now);
  assert.equal(done.lastReviewedAt, now);
  assert.equal(done.reviewCount, 0);
  assert.equal(done.nextReviewAt, now + 7 * DAY);
  assert.equal(done.status, 'completed');
  assert.equal(before.status, 'not_started');
});

test('successive revisions use 14, 30, then 45-day intervals and preserve first completion', () => {
  let reviewed = completeStation(station(), 'study', now);
  for (const [count, days] of [[1,14], [2,30], [3,45], [4,45], [5,45]]) {
    const arrival = reviewed.nextReviewAt + DAY;
    reviewed = completeStation(reviewed, 'revision', arrival);
    assert.equal(reviewed.firstCompletedAt, now);
    assert.equal(reviewed.lastReviewedAt, arrival);
    assert.equal(reviewed.reviewCount, count);
    assert.equal(reviewed.nextReviewAt, arrival + days * DAY);
    assert.equal(reviewed.status, 'completed');
    assert.equal(isMaintenanceDue(reviewed, arrival), false);
  }
});

test('maintenance changes at the deadline without altering persisted completion', () => {
  const done = completeStation(station(), 'study', now);
  assert.equal(isMaintenanceDue(done, done.nextReviewAt - 1), false);
  assert.equal(isMaintenanceDue(done, done.nextReviewAt), true);
  assert.equal(isMaintenanceDue(done, done.nextReviewAt + DAY), true);
  assert.equal(done.status, 'completed');
  assert.equal(isMaintenanceDue({...done, status:'not_started'}, now + 50 * DAY), false);
  assert.equal(isMaintenanceDue({...done, status:'studying'}, now + 50 * DAY), false);
  assert.equal(isMaintenanceDue({...done, status:'revision_due'}, now), true);
});

test('review intervals are elapsed days, independent of DST or month length', () => {
  const beforeDST = Date.parse('2026-03-07T12:00:00-05:00');
  assert.equal(nextReviewDate(beforeDST, 0) - beforeDST, 7 * DAY);
  assert.equal(reviewIntervalDays(999), 45);
});

test('old dated completions recover from history without inventing prior revisions', () => {
  const saved = createDemoState();
  saved.history = [
    {id:'first', stationId:'thorax',lineId:'anatomy',startedAt:now-DAY,completedAt:now,focusedSeconds:1500},
    {id:'later', stationId:'thorax',lineId:'anatomy',startedAt:now+DAY,completedAt:now+2*DAY,focusedSeconds:1500}
  ];
  const recovered = normalizeState(saved);
  const done = recovered.stations.find(s => s.id === 'thorax');
  assert.equal(done.firstCompletedAt, now);
  assert.equal(done.lastReviewedAt, now+2*DAY);
  assert.equal(done.reviewCount, 0);
  assert.equal(done.nextReviewAt, now+9*DAY);
  assert.equal(done.status, 'completed');
  assert.ok(recovered.history.every(journey => journey.kind === 'study'));
  assert.deepEqual(normalizeState(recovered), recovered);
});

test('undated legacy completion remains unknown and due; a baseline revision never fabricates its first-study date', () => {
  const recovered = normalizeState(createDemoState());
  const done = recovered.stations.find(s => s.id === 'thorax');
  assert.equal(done.firstCompletedAt, null);
  assert.equal(done.lastReviewedAt, null);
  assert.equal(done.nextReviewAt, null);
  assert.equal(isMaintenanceDue(done, now), true);
  const reviewed = completeStation(done, 'revision', now);
  assert.equal(reviewed.firstCompletedAt, null);
  assert.equal(reviewed.reviewCount, 1);
  assert.equal(reviewed.nextReviewAt, now + 14*DAY);
});

test('revision snapshot, history and metadata survive recovery without changing the timer', () => {
  const saved = normalizeState(createDemoState());
  const done = completeStation(saved.stations[0], 'revision', now);
  saved.stations[0] = done;
  saved.history = [{id:'review',kind:'revision',stationId:done.id,lineId:done.lineId,startedAt:now-1500000,completedAt:now,focusedSeconds:1500}];
  saved.activeJourney = {kind:'revision',stationId:done.id,lineId:done.lineId,durationMinutes:25,previousStationStatus:'completed',timer:{phase:'paused',startedAt:now,targetEndAt:now+1500000,pausedAt:now+60000,totalPausedMs:0,durationMs:1500000}};
  const recovered = normalizeState(saved);
  assert.deepEqual(recovered.activeJourney, saved.activeJourney);
  assert.deepEqual(recovered.history, saved.history);
  assert.equal(recovered.stations[0].reviewCount, 1);
  assert.equal(recovered.stations[0].nextReviewAt, done.nextReviewAt);
  assert.equal(recovered.stations[0].firstCompletedAt, null);
});

test('new maintenance state and revisions leave exam calculations unchanged', () => {
  const saved = normalizeState(createDemoState());
  saved.stations = saved.stations.map(s => ({...s,...emptyRevisionInfo(),status:'completed',nextReviewAt:now-DAY}));
  const exam = {id:'exam',lineId:'anatomy',name:'Final',examDate:'2026-09-21',targetCompletionDate:null};
  const before = examProgress(saved,exam,now);
  saved.stations = saved.stations.map(s => completeStation(s,'revision',now));
  assert.deepEqual(examProgress(saved,exam,now), before);
});

test('invalid revision metadata is repaired independently of saved study data', () => {
  const saved = createDemoState();
  Object.assign(saved.stations[0], {firstCompletedAt:NaN,lastReviewedAt:Infinity,reviewCount:-2,nextReviewAt:'tomorrow'});
  const recovered = normalizeState(saved);
  assert.equal(recovered.stations[0].status, 'completed');
  assert.equal(recovered.stations[0].reviewCount, 0);
  assert.equal(recovered.stations[0].nextReviewAt, null);
  assert.equal(recovered.lines.length, saved.lines.length);
});
