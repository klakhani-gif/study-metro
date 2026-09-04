import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { CloudSync, accountCacheKey, readCloudState } from '../dist/cloud-sync.js';
import { createCloudStore, SyncConflict } from '../dist/cloud-store.js';
import { createEmptyState } from '../dist/model.js';
import { createDemoState } from './fixtures.mjs';

const network = () => readCloudState(createDemoState());
const clone = value => structuredClone(value);
const idle = async () => { for(let i=0;i<15;i++)await Promise.resolve(); };
function memory(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
function server(initial=null){
  let row=clone(initial),version=0;const calls=[];
  return {calls,get row(){return clone(row);},set row(value){row=clone(value);},
    async read(user){calls.push(['read',user]);return row?.user_id===user?clone(row):null;},
    async write(user,state,base){calls.push(['write',user,base]);if((row?.updated_at??null)!==base)throw new SyncConflict();row={user_id:user,state:clone(state),updated_at:new Date(Date.UTC(2026,0,1)+ ++version).toISOString()};return clone(row);}
  };
}
const cloudRow = (state=network(),user='A') => ({user_id:user,state,updated_at:'2025-01-01T00:00:00.000123+00:00'});
function device(t,store,storage=memory(),extra={}){
  let visible;let connected=true;
  const sync=new CloudSync(store,{storage,apply:value=>{visible=value;},online:()=>connected,debounceMs:60000,...extra});
  t.after(()=>sync.leave());
  return {sync,storage,get visible(){return visible;},set online(value){connected=value;}};
}

test('guest mode makes no requests and keeps legacy localStorage byte-for-byte',async t=>{
  const store=server(),d=device(t,store);d.storage.setItem('study-metro:v2','original guest');
  await d.sync.check();await d.sync.flush();
  assert.deepEqual(store.calls,[]);assert.equal(d.storage.getItem('study-metro:v2'),'original guest');
});
test('existing cloud wins on first login without uploading the guest network',async t=>{
  const remote=network();remote.profile.studyArea='Cloud';const store=server(cloudRow(remote));const d=device(t,store);
  const guest=network();guest.profile.studyArea='Guest';d.storage.setItem('study-metro:v2',JSON.stringify(guest));
  await d.sync.enter('A',guest);
  assert.equal(d.visible.profile.studyArea,'Cloud');assert.equal(d.sync.status,'Synced');
  assert.deepEqual(store.calls,[['read','A']]);assert.equal(d.storage.getItem('study-metro:v2'),JSON.stringify(guest));
});
test('empty account asks before importing local data and respects explicit import',async t=>{
  const store=server(),d=device(t,store),guest=network();
  await d.sync.enter('A',guest);await d.sync.flush();assert.equal(d.sync.choice,'import');assert.equal(store.row,null);
  await d.sync.keepLocal();assert.equal(d.sync.status,'Synced');assert.deepEqual(store.row.state,guest);
});
test('declining import starts fresh while retaining both guest and local recovery copies',async t=>{
  const store=server(),d=device(t,store),guest=network();d.storage.setItem('study-metro:v2',JSON.stringify(guest));
  await d.sync.enter('A',guest);await d.sync.useCloud();
  assert.equal(d.visible.profile,null);assert.deepEqual(store.row.state,createEmptyState());
  assert.equal(d.storage.getItem('study-metro:v2'),JSON.stringify(guest));
  assert.ok([...d.storage.values.keys()].some(key=>key.includes(':recovery:')));
});
test('no local or cloud network starts fresh and inserts, never upserts',async t=>{
  const store=server(),d=device(t,store);await d.sync.enter('A',createEmptyState());await d.sync.flush();
  assert.equal(d.sync.choice,null);assert.equal(store.row.state.profile,null);assert.equal(store.calls[1][2],null);
});
test('all current network fields, history, settings and active timer snapshots round-trip',async t=>{
  const state=network();
  state.exams=[{id:'exam',lineId:'anatomy',name:'Final',examDate:'2027-01-01',targetCompletionDate:null}];
  state.stations[0].reviewCount=2;state.stations[0].firstCompletedAt=100;state.stations[0].lastReviewedAt=200;state.stations[0].nextReviewAt=300;
  state.history=[{id:'journey',stationId:'thorax',lineId:'anatomy',kind:'revision',startedAt:100,completedAt:200,focusedSeconds:1500}];
  state.departures=[{id:'departure',lineId:'anatomy',stationId:'thorax',scheduledAt:Date.now()+60000,durationMinutes:25,note:'My topic note',status:'scheduled',linkedJourneyId:null,createdAt:100}];
  state.preferredDuration=90;
  state.activeJourney={kind:'study',stationId:'pelvis',lineId:'anatomy',durationMinutes:25,previousStationStatus:'not_started',timer:{phase:'paused',startedAt:100,targetEndAt:1500100,pausedAt:200,totalPausedMs:0,durationMs:1500000}};
  const store=server(),a=device(t,store);await a.sync.enter('A',state);await a.sync.keepLocal();
  const b=device(t,store);await b.sync.enter('A',createEmptyState());assert.deepEqual(b.visible,state);
});
test('rapid edits debounce into one write; identical snapshots cause none',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const store=server(cloudRow()),d=device(t,store,undefined,{debounceMs:1200});await d.sync.enter('A',createEmptyState());
  for(let i=0;i<20;i++){const state=clone(d.visible);state.preferredDuration=25+i;d.sync.save(state);t.mock.timers.tick(100);}
  assert.equal(store.calls.filter(c=>c[0]==='write').length,0);
  t.mock.timers.tick(1200);await idle();assert.equal(store.calls.filter(c=>c[0]==='write').length,1);
  d.sync.save(store.row.state);t.mock.timers.tick(1200);await idle();assert.equal(store.calls.filter(c=>c[0]==='write').length,1);
});
test('offline edits survive reload and upload only against the known cloud version',async t=>{
  const store=server(cloudRow()),storage=memory(),a=device(t,store,storage);await a.sync.enter('A',createEmptyState());
  a.online=false;const changed=clone(a.visible);changed.preferredDuration=25;a.sync.save(changed);assert.equal(a.sync.status,'Offline');a.sync.leave();
  const b=device(t,store,storage);b.online=false;await b.sync.enter('A',createEmptyState());assert.equal(b.visible.preferredDuration,25);
  b.online=true;await b.sync.check();await b.sync.flush();assert.equal(store.row.state.preferredDuration,25);assert.equal(b.sync.status,'Synced');
});
test('two sessions cannot silently overwrite one another; cloud resolution preserves local recovery',async t=>{
  const store=server(cloudRow()),a=device(t,store),b=device(t,store);await a.sync.enter('A',createEmptyState());await b.sync.enter('A',createEmptyState());
  const x=clone(a.visible);x.preferredDuration=25;a.sync.save(x);await a.sync.flush();
  const y=clone(b.visible);y.preferredDuration=90;b.sync.save(y);await b.sync.flush();
  assert.equal(b.sync.choice,'conflict');assert.equal(store.row.state.preferredDuration,25);
  await b.sync.useCloud();assert.equal(b.visible.preferredDuration,25);assert.equal(b.sync.status,'Synced');
  assert.ok([...b.storage.values.values()].some(raw=>JSON.parse(raw)?.state?.preferredDuration===90));
});
test('explicit local resolution is still conditional if cloud changes again',async t=>{
  const store=server(cloudRow()),d=device(t,store);await d.sync.enter('A',createEmptyState());
  const local=clone(d.visible);local.preferredDuration=90;d.sync.save(local);
  const remote=network();remote.preferredDuration=25;await store.write('A',remote,store.row.updated_at);await d.sync.flush();assert.equal(d.sync.choice,'conflict');
  remote.preferredDuration=30;await store.write('A',remote,store.row.updated_at);
  await d.sync.keepLocal();assert.equal(d.sync.choice,'conflict');assert.equal(store.row.state.preferredDuration,30);
  await d.sync.keepLocal();assert.equal(store.row.state.preferredDuration,90);assert.equal(d.sync.status,'Synced');
});
test('initial read cannot erase edits made while loading',async t=>{
  const store=server(cloudRow());let release;store.read=()=>new Promise(resolve=>{release=resolve;});const d=device(t,store);
  const pending=d.sync.enter('A',network());const changed=clone(d.visible);changed.preferredDuration=25;d.sync.save(changed);
  release(cloudRow());await pending;assert.equal(d.sync.choice,'conflict');assert.equal(JSON.parse(d.storage.getItem(accountCacheKey('A'))).state.preferredDuration,25);
});
test('edits during an in-flight save are not lost or falsely marked synced',async t=>{
  const store=server(cloudRow()),realWrite=store.write;let release;store.write=(...args)=>new Promise(resolve=>{release=async()=>resolve(await realWrite(...args));});
  const d=device(t,store);await d.sync.enter('A',createEmptyState());const first=clone(d.visible);first.preferredDuration=25;d.sync.save(first);const saving=d.sync.flush();
  const later=clone(first);later.preferredDuration=90;d.sync.save(later);await d.sync.flush();assert.equal(store.calls.length,1);
  await release();await saving;assert.equal(d.sync.status,'Syncing');assert.equal(JSON.parse(d.storage.getItem(accountCacheKey('A'))).dirty,true);
  store.write=realWrite;await d.sync.flush();assert.equal(store.row.state.preferredDuration,90);
});
test('logout cancels debounce and late responses cannot change another account',async t=>{
  const store=server(cloudRow()),d=device(t,store);let release;
  store.read=()=>new Promise(resolve=>{release=resolve;});const pending=d.sync.enter('A',network());d.sync.leave();
  store.read=async()=>cloudRow({...network(),preferredDuration:90},'B');await d.sync.enter('B',createEmptyState());
  release(cloudRow());await pending;assert.equal(d.sync.userId,'B');assert.equal(d.visible.preferredDuration,90);
  assert.equal(JSON.parse(d.storage.getItem(accountCacheKey('A'))).state.preferredDuration,50);
});
test('unavailable backend preserves cache, makes no automatic retry loop, and supports explicit retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const store=server(cloudRow()),d=device(t,store);await d.sync.enter('A',createEmptyState());
  const write=store.write;let failures=0;store.write=async()=>{failures++;throw {code:'42501',message:'Permission denied'};};
  d.sync.save({...d.visible,preferredDuration:25});await d.sync.flush();assert.equal(d.sync.status,'Sync error');
  for(let i=0;i<3;i++){d.sync.save({...d.visible,preferredDuration:30+i});t.mock.timers.tick(60000);await idle();}
  assert.equal(failures,1);store.write=write;await d.sync.check();await d.sync.flush();assert.equal(store.row.state.preferredDuration,32);
});
test('invisible existing row or denied conditional update cannot cause a retry loop',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let writes=0;
  const store={read:async()=>null,write:async()=>{writes++;throw new SyncConflict();}};
  const d=device(t,store);await d.sync.enter('A',createEmptyState());await d.sync.flush();
  assert.equal(d.sync.choice,'conflict');t.mock.timers.tick(600000);await idle();assert.equal(writes,1);
});
test('lost acknowledgement reconciles identical cloud data without overwriting it',async t=>{
  const store=server(cloudRow()),write=store.write,d=device(t,store);await d.sync.enter('A',createEmptyState());
  store.write=async(...args)=>{await write(...args);throw new TypeError('Failed to fetch');};
  d.sync.save({...d.visible,preferredDuration:25});await d.sync.flush();assert.equal(d.sync.status,'Offline');
  await d.sync.check();assert.equal(d.sync.status,'Synced');assert.equal(store.calls.filter(c=>c[0]==='write').length,1);
});
test('future or malformed cloud saves never become replacement uploads',async t=>{
  for(const bad of [{...network(),schemaVersion:99},{...network(),stations:[{id:'bad'}]},'not a network']){
    const store=server(cloudRow(bad)),d=device(t,store);await d.sync.enter('A',network());
    assert.equal(d.sync.status,'Sync error');d.sync.save({...network(),preferredDuration:25});await d.sync.flush();assert.equal(store.calls.length,1);
  }
});
test('broken account cache is backed up and a failed cache write never uploads',async t=>{
  const storage=memory();storage.setItem(accountCacheKey('A'),'broken original');const store=server(cloudRow()),d=device(t,store,storage);
  await d.sync.enter('A',createEmptyState());assert.ok([...storage.values.entries()].some(([key,value])=>key.includes(':recovery:')&&value==='broken original'));
  storage.setItem=()=>{throw Error('Storage full');};assert.throws(()=>d.sync.save({...d.visible,preferredDuration:25}));await d.sync.flush();assert.equal(store.calls.length,1);
});
test('cloud adoption is deferred while an existing timer or editor is active',async t=>{
  const store=server(cloudRow()),d=device(t,store,undefined,{canReplace:()=>false});await d.sync.enter('A',createEmptyState());
  assert.equal(d.sync.choice,'conflict');assert.equal(d.visible.profile,null);assert.equal(store.calls.length,1);
});
test('Supabase adapter scopes reads/updates and uses insert-only plus exact timestamp conditions',async()=>{
  const requests=[];const version='2026-01-01T00:00:00.000123+00:00';
  const client=createClient('https://cloud.example.test','sb_publishable_test',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
    const url=new URL(String(input));requests.push({url,init});
    return new Response(JSON.stringify([{user_id:'A',state:createEmptyState(),updated_at:version}]),{status:200,headers:{'Content-Type':'application/json'}});
  }}});
  try {
    const store=createCloudStore(client),signal=new AbortController().signal;
    await store.read('A',signal);await store.write('A',createEmptyState(),null,signal);await store.write('A',createEmptyState(),version,signal);
    assert.equal(requests[0].url.searchParams.get('user_id'),'eq.A');assert.equal(requests[1].init.method,'POST');
    assert.equal(JSON.parse(requests[1].init.body).user_id,'A');assert.equal(requests[1].url.searchParams.has('on_conflict'),false);
    assert.equal(requests[2].init.method,'PATCH');assert.equal(requests[2].url.searchParams.get('user_id'),'eq.A');assert.equal(requests[2].url.searchParams.get('updated_at'),`eq.${version}`);
  } finally {await client.auth.dispose();}
});
