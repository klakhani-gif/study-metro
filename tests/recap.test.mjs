import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createWeeklyRecap, weekBounds, recapDateKey, recapDuration, renderRecapSvg } from '../dist/recap.js';
import { normalizeState } from '../dist/recovery.js';
import { createDemoState } from './fixtures.mjs';

const monday = new Date(2026,7,31).getTime();
const nextMonday = new Date(2026,8,7).getTime();
const now = new Date(2026,8,7,12).getTime();
const at = (day,hour=12) => new Date(2026,7,31+day,hour).getTime();
const journey = (id,day,seconds=1500,stationId='pelvis',lineId='anatomy',kind='study') => ({id,stationId,lineId,kind,startedAt:at(day)-seconds*1000,completedAt:at(day),focusedSeconds:seconds});
const fixture = () => normalizeState(createDemoState());
const report = state => createWeeklyRecap(state,monday,now);

test('week boundaries include Monday midnight and all of Sunday, excluding the next Monday', () => {
  assert.deepEqual(weekBounds(at(6,23)),{start:monday,end:nextMonday});
  assert.equal(weekBounds(nextMonday).start,nextMonday);
  const state=fixture();
  state.history=[monday-1,monday,nextMonday-1,nextMonday].map((completedAt,i)=>({...journey(String(i),0),completedAt}));
  const recap=report(state);
  assert.equal(recap.journeys,2);
  assert.equal(recap.focusedSeconds,3000);
  assert.equal(recapDateKey(recap.start),'2026-08-31');
});

test('local weeks respect DST, year changes and calendar days across timezones', () => {
  const url=new URL('../dist/recap.js',import.meta.url).href;
  for(const zone of ['America/New_York','Europe/Berlin','Asia/Kolkata','Pacific/Auckland']) {
    const script=`import assert from 'node:assert/strict'; import {weekBounds,recapDateKey} from ${JSON.stringify(url)};
      const b=weekBounds(new Date(2026,2,8,23,59).getTime());
      assert.equal(new Date(b.start).getDay(),1);assert.equal(new Date(b.start).getHours(),0);
      assert.equal(recapDateKey(b.start),'2026-03-02');assert.equal(recapDateKey(b.end),'2026-03-09');
      const ny=${JSON.stringify(zone)}==='America/New_York';if(ny)assert.equal(b.end-b.start,167*3600000);
      const fall=weekBounds(new Date(2026,10,1,23).getTime());if(ny)assert.equal(fall.end-fall.start,169*3600000);
      assert.equal(recapDateKey(weekBounds(new Date(2027,0,1).getTime()).start),'2026-12-28');`;
    execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:zone}});
  }
});

test('journeys across days aggregate full focused time by completion, with distinct visited stations', () => {
  const state=fixture();
  state.history=[journey('a',0,1500),journey('b',1,3000),journey('c',3,5400,'renal','physiology')];
  state.history[0].startedAt=monday-1200000;
  const recap=report(state);
  assert.equal(recap.focusedSeconds,9900);assert.equal(recap.journeys,3);assert.equal(recap.stationsStudied,2);
  assert.equal(recapDuration(recap.focusedSeconds),'2h 45m');
  assert.equal(createWeeklyRecap(state,monday,at(1)-1).journeys,1);
});

test('busiest line uses total focus time, not journey count; ties have stable line-ID order', () => {
  const state=fixture();state.history=[journey('a',1,1500),journey('b',2,1500),journey('c',3,4500,'renal','physiology')];
  assert.deepEqual(report(state).busiestLine,{name:'PHYSIOLOGY',color:'#2E6F95',seconds:4500});
  state.history.push(journey('d',4,1500));
  assert.equal(report(state).busiestLine.name,'ANATOMY');
  state.history.reverse();assert.equal(report(state).busiestLine.name,'ANATOMY');
});

test('longest journey and most productive day use duration; tied days choose the earlier local day', () => {
  const state=fixture();state.history=[journey('a',1,6000),journey('b',3,4500,'renal','physiology'),journey('c',3,4500)];
  assert.deepEqual(report(state).longestJourney,{station:'Pelvis',seconds:6000});
  assert.deepEqual(report(state).mostProductiveDay,{date:'2026-09-03',name:'Thursday',seconds:9000});
  state.history.push(journey('d',1,3000));assert.equal(report(state).mostProductiveDay.date,'2026-09-01');
});

test('zero activity has zero totals and absent highlights, without manufacturing data', () => {
  const state=fixture();state.history=[journey('older',-1)];
  const recap=report(state);
  for(const key of ['journeys','focusedSeconds','stationsStudied','stationsCompleted','revisionSessions'])assert.equal(recap[key],0);
  assert.equal(recap.busiestLine,null);assert.equal(recap.longestJourney,null);assert.equal(recap.mostProductiveDay,null);
  assert.equal(recap.scheduled.completionRate,null);
  assert.match(renderRecapSvg(recap),/No services recorded/);
});

test('revision count is separate from first completions; revisiting stations never adds new completions', () => {
  const state=fixture();state.history=[journey('initial',0),journey('review',1,1500,'pelvis','anatomy','revision'),journey('review2',3,1500,'thorax','anatomy','revision')];
  state.stations.find(s=>s.id==='pelvis').firstCompletedAt=at(0);
  state.stations.find(s=>s.id==='thorax').firstCompletedAt=monday-1;
  state.stations.find(s=>s.id==='abdomen').firstCompletedAt=null;
  const recap=report(state);
  assert.equal(recap.stationsCompleted,1);assert.equal(recap.stationsStudied,2);assert.equal(recap.revisionSessions,2);
});

test('scheduled completion rate excludes pending/cancelled and respects the scheduled-week cohort', () => {
  const state=fixture();
  const dep=(id,scheduledAt,status='scheduled',linkedJourneyId=null)=>({id,lineId:'anatomy',stationId:'pelvis',scheduledAt,durationMinutes:25,note:'PRIVATE NOTE',status,linkedJourneyId,createdAt:at(-2)});
  state.departures=[dep('done',at(2),'completed','j'),dep('missed',at(3)),dep('cancelled',at(4),'cancelled'),dep('boarded',at(6),'scheduled','active'),dep('outside',nextMonday,'completed','other')];
  assert.deepEqual(report(state).scheduled,{completed:1,missed:1,cancelled:1,pending:1,completionRate:50});
  state.departures.push(dep('second',at(1),'completed','later-completion'));
  assert.equal(report(state).scheduled.completionRate,67);
  const current=createWeeklyRecap({...state,departures:[dep('future',at(6))]},monday,at(2));
  assert.deepEqual(current.scheduled,{completed:0,missed:0,cancelled:0,pending:1,completionRate:null});
});

test('maintenance and nearest exam are current snapshots, even for past-week reports', () => {
  const state=fixture();state.stations.forEach(s=>{s.status='not_started';s.nextReviewAt=null;});
  state.stations[0].status='completed';state.stations[0].nextReviewAt=now-1;
  state.exams=[{id:'past',lineId:'anatomy',name:'Past',examDate:'2026-09-01'}, {id:'future',lineId:'anatomy',name:'Final',examDate:'2026-09-21'}, {id:'nearest',lineId:'physiology',name:'Physiology Final',examDate:'2026-09-08'}];
  assert.equal(report(state).maintenanceDue,1);
  assert.deepEqual(report(state).nearestExam,{name:'Physiology Final',daysRemaining:1});
  state.exams[2].examDate='2026-09-07';assert.equal(report(state).nearestExam.daysRemaining,0);
  state.exams=[];assert.equal(report(state).nearestExam,null);
});

test('recap generation is read-only and its portrait SVG excludes notes/profile data and escapes labels', () => {
  const state=fixture();state.history=[journey('a',2)];state.profile.studyArea='PRIVATE PROFILE';
  state.lines[0].name='<script>private & label</script>';
  const before=structuredClone(state);const recap=report(state);const svg=renderRecapSvg(recap);
  assert.deepEqual(state,before);assert.equal(svg.includes('PRIVATE PROFILE'),false);
  assert.match(svg,/width="1080" height="1350"/);assert.match(svg,/&lt;script&gt;/);
  assert.doesNotMatch(svg,/<script|<image|<foreignObject|<linearGradient/);
  state.lines[0].name='W'.repeat(64);assert.match(renderRecapSvg(report(state)),/…/);
});
