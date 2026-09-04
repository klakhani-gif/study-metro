import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {DuplicateUsername,ProfileController,ProfileStore,normalizePublicProfile,profileInputError,profileUsernameFromPath,usernameError} from '../dist/profiles.js';

const row={user_id:'11111111-1111-4111-8111-111111111111',username:'metro_user',display_name:'Metro User',bio:'Studying',is_public:false,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};
test('username validation permits only 3–20 lowercase letters, numbers and underscores',()=>{
  for(const value of ['abc','study_metro','u12','a'.repeat(20)])assert.equal(usernameError(value),null);
  for(const value of ['ab','a'.repeat(21),'Upper','has space','dash-name','éclair',''])assert.ok(usernameError(value));
  assert.equal(profileUsernameFromPath('/u/study_metro'),'study_metro');assert.equal(profileUsernameFromPath('/u/Upper'),null);assert.equal(profileUsernameFromPath('/elsewhere'),null);
});
test('display name and bio limits are validated',()=>{
  assert.equal(profileInputError('', ''),null);assert.ok(profileInputError('x'.repeat(41),''));assert.ok(profileInputError('','x'.repeat(241)));
});
test('profile creation succeeds once and duplicate usernames remain actionable',async()=>{
  let creates=0;const store={own:async()=>null,create:async(_id,username,display)=>{creates++;if(username==='already_used')throw new DuplicateUsername();return{...row,username,display_name:display||null};},update:async()=>row};
  const profile=new ProfileController(store);await profile.enter(row.user_id);assert.equal(profile.profile,null);
  assert.equal(await profile.create('Bad Name',''),false);assert.equal(creates,0);
  assert.equal(await profile.create('already_used',''),false);assert.match(profile.error,/already/);assert.equal(creates,1);
  assert.equal(await profile.create('new_user','New User'),true);assert.equal(profile.profile.username,'new_user');assert.equal(creates,2);
});
test('profile editing never passes a username change',async()=>{
  let updateArgs;const store={own:async()=>row,create:async()=>row,update:async(...args)=>{updateArgs=args;return{...row,display_name:'New',bio:'Short bio',is_public:true};}};
  const profile=new ProfileController(store);await profile.enter(row.user_id);assert.equal(await profile.update('New','Short bio',true),true);
  assert.deepEqual(updateArgs,[row.user_id,'New','Short bio',true]);assert.equal(profile.profile.username,'metro_user');assert.equal(profile.profile.is_public,true);
});
test('private public-route responses discard every optional field and statistic',()=>{
  const profile=normalizePublicProfile({...row,joined_at:row.created_at,email:'secret@example.test',focus_seconds:999,journeys:12,completed_stations:8,subject_lines:['Private Anatomy'],private_note:'secret'},'metro_user');
  assert.deepEqual(profile,{username:'metro_user',display_name:null,is_public:false,joined_at:null,focus_seconds:null,journeys:null,completed_stations:null,subject_lines:null});
  assert.doesNotMatch(JSON.stringify(profile),/secret|Anatomy|email/);
});
test('public route keeps only bounded selected aggregate statistics',()=>{
  const profile=normalizePublicProfile({username:'metro_user',display_name:'Metro User',is_public:true,joined_at:row.created_at,focus_seconds:7200,journeys:4,completed_stations:3,subject_lines:['Anatomy','Physiology'],email:'hidden@example.test',bio:'not public',exams:['Final'],notes:['hidden']},'metro_user');
  assert.deepEqual(profile,{username:'metro_user',display_name:'Metro User',is_public:true,joined_at:row.created_at,focus_seconds:7200,journeys:4,completed_stations:3,subject_lines:['Anatomy','Physiology']});
});
test('ProfileStore uses owner filters, omits username from edits, and calls only the public RPC for public pages',async()=>{
  const requests=[];const client=createClient('https://profiles.example.test','sb_publishable_test',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{const url=new URL(String(input));requests.push({url,init,body:init?.body?JSON.parse(init.body):null});const body=url.pathname.includes('/rpc/')?[{username:'metro_user',display_name:'Metro User',is_public:true,joined_at:row.created_at,focus_seconds:0,journeys:0,completed_stations:0,subject_lines:[]}]:[row];return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});}}});
  try{const store=new ProfileStore(client);await store.own(row.user_id);await store.create(row.user_id,'metro_user','Metro User');await store.update(row.user_id,'New','Bio',true);await store.public('metro_user');assert.equal(await store.public('Bad Name'),null);
    assert.equal(requests.length,4);assert.equal(requests[0].url.searchParams.get('user_id'),`eq.${row.user_id}`);assert.equal(requests[1].body.username,'metro_user');
    assert.equal(requests[2].url.searchParams.get('user_id'),`eq.${row.user_id}`);assert.equal('username' in requests[2].body,false);assert.equal(requests[3].url.pathname,'/rest/v1/rpc/get_study_metro_public_profile');assert.deepEqual(requests[3].body,{lookup_username:'metro_user'});
  }finally{await client.auth.dispose();}
});
