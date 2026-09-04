import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourneyTicket, renderTicketSvg, wrapTicketText, ticketDateTime, ticketFilename, canShareTicket, ticketPng } from '../dist/tickets.js';
import { normalizeState } from '../dist/recovery.js';
import { createDemoState } from './fixtures.mjs';
const completedAt = new Date(2026,8,4,18,50).getTime();
const record = overrides => ({id:'journey-1',kind:'study',stationId:'pelvis',lineId:'anatomy',startedAt:completedAt-50*60000,completedAt,focusedSeconds:3000,...overrides});
function fixture(overrides = {}) {
  const state = normalizeState(createDemoState());
  state.history = [record(overrides)];
  return state;
}

test('study ticket derives saved journey details without mutating network or history', () => {
  const state = fixture(); const before = structuredClone(state);
  const ticket = createJourneyTicket(state, 'journey-1');
  assert.deepEqual(ticket, {journeyId:'journey-1',journeyNumber:'0001',routeCode:'01',lineName:'ANATOMY',lineColor:'#E4572E',origin:'Abdomen',destination:'Pelvis',kind:'study',durationMinutes:50,completedAt,examDestination:null,scheduledAt:null});
  assert.deepEqual(state, before);
  const svg = renderTicketSvg(ticket);
  assert.match(svg, /width="1080" height="1350"/);
  assert.match(svg, /STUDY METRO/);
  assert.match(svg, /STUDY \/ FOCUS SERVICE/);
  assert.match(svg, /PELVIS/);
  assert.match(svg, /04 SEPT? 2026/);
  assert.match(svg, /JOURNEY #0001/);
  assert.equal(ticketFilename(ticket), 'study-metro-study-0001.png');
});

test('revision ticket clearly identifies maintenance while retaining normal duration and destination', () => {
  const ticket = createJourneyTicket(fixture({kind:'revision',focusedSeconds:1500}), 'journey-1');
  assert.equal(ticket.kind,'revision');
  assert.equal(ticket.origin,'Maintenance service');
  assert.equal(ticket.durationMinutes,25);
  assert.equal(ticket.destination,'Pelvis');
  assert.match(renderTicketSvg(ticket), /REVISION \/ MAINTENANCE SERVICE/);
  assert.equal(ticketFilename(ticket),'study-metro-revision-0001.png');
});

test('scheduled journey ticket includes only the matching departure time, never private notes or profile data', () => {
  const state = fixture();
  state.profile.studyArea = 'PRIVATE PROFILE';
  state.departures = [{id:'dep',lineId:'anatomy',stationId:'pelvis',scheduledAt:completedAt-60*60000,durationMinutes:50,note:'PRIVATE NOTE email@example.com',status:'completed',linkedJourneyId:'journey-1',createdAt:1}];
  state.exams = [{id:'exam',lineId:'anatomy',name:'Anatomy Final',examDate:'2026-09-21',targetCompletionDate:null}];
  const ticket = createJourneyTicket(state, 'journey-1');
  assert.equal(ticket.scheduledAt,state.departures[0].scheduledAt);
  assert.equal(ticket.examDestination,'Anatomy Final');
  assert.match(renderTicketSvg(ticket),/SCHEDULED DEPARTURE/);
  assert.match(renderTicketSvg(ticket),/Anatomy Final/);
  assert.doesNotMatch(JSON.stringify(ticket)+renderTicketSvg(ticket), /PRIVATE|email@example|createdAt|note/);
  state.departures[0].linkedJourneyId = 'unrelated';
  assert.equal(createJourneyTicket(state,'journey-1').scheduledAt,null);
});

test('long subject, origin, station and exam names wrap or truncate within reserved lines', () => {
  const state = fixture();
  state.lines[0].name = 'Advanced anatomy and clinical physiology';
  state.stations.find(s => s.id === 'pelvis').name = 'Developmental anatomy of the abdominal and pelvic organ systems';
  state.stations.find(s => s.id === 'abdomen').name = 'W'.repeat(64);
  state.exams = [{id:'exam',lineId:'anatomy',name:'Final assessment of the abdominal and pelvic organ systems',examDate:'2026-09-21',targetCompletionDate:null}];
  const ticket = createJourneyTicket(state,'journey-1');
  assert.equal(ticket.destination,state.stations.find(s => s.id === 'pelvis').name);
  const lines = wrapTicketText(ticket.destination.toUpperCase(),936,72,3);
  assert.ok(lines.length > 1 && lines.length <= 3);
  const unbroken = wrapTicketText('W'.repeat(64),936,72,3);
  assert.equal(unbroken.length,3); assert.ok(unbroken[2].endsWith('…'));
  assert.ok(wrapTicketText('解剖学'.repeat(30),936,72,3)[2].endsWith('…'));
  assert.deepEqual(wrapTicketText('Head & Neck',936,72,3),['Head & Neck']);
  assert.match(renderTicketSvg(ticket),/Developmental anatomy/); // full accessible description
});

test('missing optional fields and old history produce useful tickets without a migration', () => {
  const state = fixture();
  assert.equal(createJourneyTicket(state,'missing'),null);
  assert.equal(createJourneyTicket({...state,history:[]},'journey-1'),null);
  const minimal = createJourneyTicket({...state,lines:[],stations:[],exams:[],departures:[]},'journey-1');
  assert.equal(minimal.lineName,'Study line');
  assert.equal(minimal.destination,'Completed station');
  assert.equal(minimal.origin,'Line entrance');
  assert.equal(minimal.routeCode,'—');
  assert.equal(minimal.examDestination,null);
  assert.equal(minimal.scheduledAt,null);
  assert.doesNotMatch(renderTicketSvg(minimal),/SCHEDULED DEPARTURE|EXAM DESTINATION|undefined|NaN/);
  const old = fixture(); delete old.history[0].kind;
  assert.equal(createJourneyTicket(normalizeState(old),'journey-1').kind,'study');
  assert.equal(createJourneyTicket(fixture({completedAt:NaN}),'journey-1').completedAt,null);
  assert.equal(ticketDateTime(null).date,'DATE NOT RECORDED');
});

test('journey numbering stays chronological when later sessions are added', () => {
  const state = fixture();
  state.history.unshift(record({id:'journey-2',completedAt:completedAt+60000}));
  assert.equal(createJourneyTicket(state,'journey-1').journeyNumber,'0001');
  assert.equal(createJourneyTicket(state,'journey-2').journeyNumber,'0002');
});

test('SVG safely escapes study labels and never references external resources or fake codes', () => {
  const ticket = createJourneyTicket(fixture(),'journey-1');
  ticket.destination = '<script>alert("test")</script> & notes';
  ticket.lineName = '<image href="https://example.com" />';
  ticket.lineColor = 'red" onload="alert(1)';
  const svg = renderTicketSvg(ticket);
  assert.doesNotMatch(svg, /<script|<image|onload=|<foreignObject|<linearGradient/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /stroke="#9b9e9f"/);
});

function navigatorMock(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{value,configurable:true});
  t.after(() => original ? Object.defineProperty(globalThis,'navigator',original) : delete globalThis.navigator);
}
test('file sharing is offered only when supported for the actual PNG', t => {
  const file = new File(['png'],'ticket.png',{type:'image/png'});
  const api = {}; navigatorMock(t,api);
  assert.equal(canShareTicket(file),false);
  api.share = async () => {};
  api.canShare = () => false;
  assert.equal(canShareTicket(file),false);
  api.canShare = payload => payload.files[0] === file;
  assert.equal(canShareTicket(file),true);
  api.canShare = () => { throw Error('unsupported'); };
  assert.equal(canShareTicket(file),false);
});

test('failed SVG rasterization releases its object URL and can be retried', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis,'Image');
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class { set src(value) { queueMicrotask(() => this.onerror()); } }});
  t.after(() => original ? Object.defineProperty(globalThis,'Image',original) : delete globalThis.Image);
  const released = [];
  t.mock.method(URL,'createObjectURL',()=>'blob:test');
  t.mock.method(URL,'revokeObjectURL',url=>released.push(url));
  await assert.rejects(ticketPng('<svg/>'),/could not be rendered/);
  await assert.rejects(ticketPng('<svg/>'),/could not be rendered/);
  assert.deepEqual(released,['blob:test','blob:test']);
});
