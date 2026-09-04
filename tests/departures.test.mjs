import test from 'node:test';
import assert from 'node:assert/strict';
import { departureStatus, nextDeparture, departureGroup, parseDepartureTime, localDepartureFields, departureError, rescheduleDeparture, boardDeparture, completeDeparture } from '../dist/departures.js';
import { normalizeState } from '../dist/recovery.js';
import { JourneyTimer } from '../dist/timer.js';
import { completeStation } from '../dist/revision.js';
import { createDemoState } from './fixtures.mjs';

const MIN = 60_000;
const now = new Date(2026, 8, 4, 12).getTime();
const network = () => normalizeState(createDemoState());
const departure = (overrides = {}) => ({id:'dep',lineId:'anatomy',stationId:'thorax',scheduledAt:now,durationMinutes:25,note:'Read chapters 1–3',status:'scheduled',linkedJourneyId:null,createdAt:now-MIN,...overrides});

test('scheduled more than fifteen minutes before departure', () => {
  assert.equal(departureStatus(departure(), now - 15*MIN - 1), 'Scheduled');
});
test('boarding soon includes fifteen-minute boundary, but not the start', () => {
  assert.equal(departureStatus(departure(), now - 15*MIN), 'Boarding soon');
  assert.equal(departureStatus(departure(), now - 1), 'Boarding soon');
});
test('ready from the scheduled instant through thirty minutes late', () => {
  assert.equal(departureStatus(departure(), now), 'Ready');
  assert.equal(departureStatus(departure(), now + 30*MIN), 'Ready');
});
test('missed after thirty minutes; ending statuses override the clock', () => {
  assert.equal(departureStatus(departure(), now + 30*MIN + 1), 'Missed');
  assert.equal(departureStatus(departure({status:'completed'}), now + 60*MIN), 'Completed');
  assert.equal(departureStatus(departure({status:'cancelled'}), now - 60*MIN), 'Cancelled');
});
test('rescheduling a missed departure changes station and duration without changing identity', () => {
  const before = departure({scheduledAt:now-60*MIN});
  const details = {lineId:'physiology',stationId:'renal',scheduledAt:now+60*MIN,durationMinutes:90,note:'  New note  '};
  const after = rescheduleDeparture(before, details, network().stations, now);
  assert.equal(after.id, before.id);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.stationId, 'renal');
  assert.equal(after.durationMinutes, 90);
  assert.equal(after.note, 'New note');
  assert.equal(departureStatus(after, now), 'Scheduled');
  assert.equal(departureStatus(before, now), 'Missed');
  assert.throws(() => rescheduleDeparture({...before,status:'completed'}, details, network().stations, now));
  assert.throws(() => rescheduleDeparture({...before,linkedJourneyId:'j'}, details, network().stations, now));
});
test('departure validation rejects invalid dates, station relations, durations and overlong notes', () => {
  assert.equal(parseDepartureTime('2026-02-30','12:00'), null);
  assert.equal(parseDepartureTime('2026-09-04','25:00'), null);
  assert.equal(parseDepartureTime('',''), null);
  const stamp = parseDepartureTime('2026-12-01','18:35');
  assert.deepEqual(localDepartureFields(stamp), {date:'2026-12-01',time:'18:35'});
  const valid = departure({scheduledAt:now+MIN});
  assert.equal(departureError(valid,network().stations,now), null);
  for (const changes of [{scheduledAt:now},{scheduledAt:NaN},{stationId:'renal'}, {durationMinutes:0}, {durationMinutes:241}, {durationMinutes:25.5}, {note:'x'.repeat(281)}]) {
    assert.ok(departureError({...valid,...changes},network().stations,now));
  }
});
test('calendar grouping uses local midnight rather than elapsed 24-hour periods', () => {
  const today = new Date(2026, 8, 4, 23, 59).getTime();
  assert.equal(departureGroup(new Date(2026,8,3,23,59).getTime(),today), 'EARLIER');
  assert.equal(departureGroup(new Date(2026,8,4,0).getTime(),today), 'TODAY');
  assert.equal(departureGroup(new Date(2026,8,5,0).getTime(),today), 'TOMORROW');
  assert.equal(departureGroup(new Date(2026,8,6,0).getTime(),today), 'UPCOMING');
});
test('next departure is chronological and excludes missed, boarded, completed and cancelled journeys', () => {
  const soon = departure({id:'soon',scheduledAt:now+MIN});
  const later = departure({id:'later',scheduledAt:now+60*MIN});
  const entries = [later, departure({scheduledAt:now-31*MIN}), departure({status:'completed'}), departure({status:'cancelled'}), departure({linkedJourneyId:'active'}), soon];
  assert.equal(nextDeparture(entries,now), soon);
  assert.equal(entries[0], later);
  assert.equal(nextDeparture([],now), null);
});
test('boarded departure uses existing timer and survives refresh while running or paused', () => {
  for (const phase of ['focusing','paused']) {
    const saved = network();
    saved.departures = [boardDeparture(departure(), 'journey-1')];
    saved.activeJourney = {departureId:'dep',journeyId:'journey-1',kind:'revision',stationId:'thorax',lineId:'anatomy',durationMinutes:25,previousStationStatus:'completed',timer:{phase,startedAt:now,targetEndAt:now+25*MIN,durationMs:25*MIN,totalPausedMs:0,pausedAt:phase === 'paused' ? now+MIN : null}};
    const restored = normalizeState(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored.activeJourney, saved.activeJourney);
    assert.deepEqual(restored.departures, saved.departures);
    const timer = new JourneyTimer(); timer.restore(restored.activeJourney.timer);
    assert.equal(timer.remainingMs(now+2*MIN), (phase === 'paused' ? 24 : 23)*MIN);
    assert.throws(() => boardDeparture(restored.departures[0], 'journey-2'));
    assert.equal(departureStatus(restored.departures[0],now+60*MIN), 'Ready');
  }
});
test('completing a linked journey updates its departure once and preserves revision completion behavior', () => {
  const saved = network();
  const boarded = boardDeparture(departure(), 'journey-1');
  const timer = new JourneyTimer();
  timer.restore({phase:'focusing',startedAt:now,targetEndAt:now+25*MIN,durationMs:25*MIN,totalPausedMs:0,pausedAt:null});
  timer.tick(now+40*MIN);
  assert.equal(timer.state.phase, 'complete');
  const record = {id:'journey-1',kind:'revision',stationId:'thorax',lineId:'anatomy',startedAt:now,completedAt:timer.state.targetEndAt,focusedSeconds:1500};
  const after = completeDeparture(boarded,record);
  assert.equal(after.status,'completed');
  assert.deepEqual(completeDeparture(after,record),after);
  assert.equal(completeDeparture(boarded,{...record,id:'different'}),boarded);
  assert.equal(completeDeparture(boarded,{...record,stationId:'renal'}),boarded);
  const station = saved.stations.find(s => s.id === 'thorax');
  const done = completeStation(station,record.kind,record.completedAt);
  assert.equal(done.status,'completed');
  assert.equal(done.reviewCount,station.reviewCount+1);
  saved.history = [record]; saved.departures = [after];
  assert.deepEqual(normalizeState(saved).departures,[after]);
});
test('old schema four data gains an empty timetable without changing revision, exams or active sessions', () => {
  const old = network(); old.schemaVersion = 4; delete old.departures;
  const recovered = normalizeState(old);
  assert.equal(recovered.schemaVersion,5);
  assert.deepEqual(recovered.departures,[]);
  for (const key of ['stations','lines','history','exams','activeJourney']) assert.deepEqual(recovered[key],old[key]);
  assert.deepEqual(normalizeState(recovered), recovered);
});
test('malformed departures recover independently and stale journey links are released', () => {
  const saved = network();
  saved.departures = [departure({linkedJourneyId:'lost'}), departure({id:'bad-duration',durationMinutes:0}),departure({id:'wrong-line',lineId:'physiology'}), departure({id:'missing',stationId:'deleted'}),departure({id:'dep'}), null];
  const recovered = normalizeState(saved);
  assert.deepEqual(recovered.departures,[departure()]);
  assert.deepEqual(recovered.stations,saved.stations);
  saved.history = [{id:'lost',kind:'study',stationId:'thorax',lineId:'anatomy',startedAt:now,completedAt:now+25*MIN,focusedSeconds:1500}];
  assert.equal(normalizeState(saved).departures[0].status,'completed');
});
