import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { AuthController, authInputError, authErrorMessage, oauthCallbackMessage } from '../dist/auth.js';
import { AUTH_STORAGE_KEY } from '../dist/supabase.js';
import { validatePublicAuthConfig } from '../scripts/auth-env.mjs';

const session = {access_token:'test-access',refresh_token:'test-refresh',user:{id:'user-1',email:'student@example.test'}};
function fakeApi(overrides={}) {
  let callback = () => {};
  return {
    getSession: async()=>({data:{session:null},error:null}),
    onAuthStateChange: cb=>{callback=cb;return {data:{subscription:{unsubscribe(){}}}};},
    emit:(event,value)=>callback(event,value),
    signInWithPassword:async()=>({data:{session},error:null}),
    signInWithOAuth:async()=>({data:{provider:'google',url:'https://accounts.google.test'},error:null}),
    signUp:async()=>({data:{session:null,user:{id:'new'}},error:null}),
    signOut:async()=>({error:null}), ...overrides
  };
}

test('auth form validates email/password without changing or trimming passwords',()=>{
  assert.ok(authInputError('', 'password', false));
  assert.ok(authInputError('bad@@example.test','password',false));
  assert.ok(authInputError('student@example.test','',false));
  assert.ok(authInputError('student@example.test','short',true));
  assert.equal(authInputError(' student@example.test ',' eight characters ',true),null);
  assert.equal(authInputError('student@example.test','old123',false),null);
});

test('known Supabase errors are actionable without leaking raw server responses',()=>{
  assert.match(authErrorMessage({code:'invalid_credentials'}),/incorrect/);
  assert.match(authErrorMessage({code:'user_already_exists'}),/already exists/);
  assert.match(authErrorMessage({code:'email_not_confirmed'}),/Confirm/);
  assert.match(authErrorMessage({status:429}),/Too many/);
  assert.match(authErrorMessage({status:503}),/temporarily unavailable/);
  assert.doesNotMatch(authErrorMessage({message:'secret password token'}),/secret password token/);
});

test('Google OAuth uses one provider request and the supplied current-origin callback',async()=>{
  let calls=0,input,release;
  const api=fakeApi({signInWithOAuth:value=>{calls++;input=value;return new Promise(resolve=>{release=resolve;});}});
  const auth=new AuthController(api);await auth.initialize();
  const pending=auth.signInWithGoogle('http://127.0.0.1:4173/login');
  assert.equal(auth.state.busy,true);
  await auth.signInWithGoogle('http://127.0.0.1:4173/login');
  assert.equal(calls,1);
  assert.deepEqual(input,{provider:'google',options:{redirectTo:'http://127.0.0.1:4173/login'}});
  release({data:{provider:'google',url:'https://accounts.google.test'},error:null});await pending;
  assert.equal(auth.state.busy,false);assert.match(auth.state.message,/Redirecting/);auth.dispose();
});

test('Google OAuth errors and cancellation callbacks are sanitized',async()=>{
  const auth=new AuthController(fakeApi({signInWithOAuth:async()=>({data:{provider:'google',url:null},error:{code:'provider_disabled',message:'secret provider details'}})}));await auth.initialize();
  await auth.signInWithGoogle('https://study.example/login');
  assert.match(auth.state.error,/not available/);assert.doesNotMatch(auth.state.error,/secret provider details/);
  assert.match(oauthCallbackMessage('?error=access_denied&error_description=private',''),/cancelled/);
  assert.match(oauthCallbackMessage('?error=server_error&error_description=private',''),/could not be completed/);
  assert.equal(oauthCallbackMessage('',''),null);auth.dispose();
});

test('guest/unconfigured access does not create sessions or require Supabase',async()=>{
  const auth=new AuthController(null);await auth.initialize();
  assert.equal(auth.state.configured,false);assert.equal(auth.state.loading,false);assert.equal(auth.state.session,null);
  await auth.submit('student@example.test','password',true,'https://example.test/');assert.equal(auth.state.session,null);
  await auth.signInWithGoogle('https://example.test/login');assert.equal(auth.state.session,null);
});

test('login restores a session and logout uses local scope only',async()=>{
  let submitted;let scope;
  const api=fakeApi({signInWithPassword:async input=>{submitted=input;return {data:{session},error:null};},signOut:async options=>{scope=options;return {error:null};}});
  const auth=new AuthController(api);await auth.initialize();
  await auth.submit(' student@example.test ',' password ',false,'https://example.test/');
  assert.deepEqual(submitted,{email:'student@example.test',password:' password '});
  assert.equal(auth.state.session,session);assert.equal(auth.state.busy,false);
  assert.equal(await auth.logOut(),true);assert.deepEqual(scope,{scope:'local'});assert.equal(auth.state.session,null);auth.dispose();
});

test('signup supports confirmation and immediate sessions, including privacy-preserving duplicate responses',async()=>{
  let options;
  const api=fakeApi({signUp:async input=>{options=input.options;return {data:{session:null,user:{identities:[]}},error:null};}});
  const auth=new AuthController(api);await auth.initialize();
  await auth.submit('student@example.test','password1',true,'http://localhost:4173/');
  assert.equal(options.emailRedirectTo,'http://localhost:4173/');assert.match(auth.state.message,/confirmation link/);assert.match(auth.state.message,/already have an account/);assert.equal(auth.state.session,null);
  api.signUp=async()=>({data:{session},error:null});await auth.submit('student@example.test','password1',true,'http://localhost:4173/');assert.equal(auth.state.session,session);
  api.signUp=async()=>({data:{session:null},error:{code:'user_already_exists'}});await auth.submit('student@example.test','password1',true,'http://localhost:4173/');assert.match(auth.state.error,/already exists/);auth.dispose();
});

test('double-submit prevention and failure recovery clear the loading state',async()=>{
  let release;let calls=0;
  const api=fakeApi({signInWithPassword:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  const auth=new AuthController(api);await auth.initialize();
  const pending=auth.submit('student@example.test','password',false,'https://example.test/');
  assert.equal(auth.state.busy,true);
  await auth.submit('student@example.test','password',false,'https://example.test/');assert.equal(calls,1);
  release({data:{session:null},error:{code:'invalid_credentials'}});await pending;assert.equal(auth.state.busy,false);assert.match(auth.state.error,/incorrect/);
  api.signInWithPassword=async()=>{throw Error('Network failed');};await auth.submit('student@example.test','password',false,'https://example.test/');assert.equal(auth.state.busy,false);assert.match(auth.state.error,/connection/);auth.dispose();
});

test('repeated initialization and auth events do not repeat session reads or subscribe twice',async()=>{
  let reads=0;let subscriptions=0;let release;let callback;
  const api=fakeApi({
    getSession:()=>{reads++;return new Promise(resolve=>{release=resolve;});},
    onAuthStateChange:cb=>{subscriptions++;callback=cb;return {data:{subscription:{unsubscribe(){}}}};}
  });
  const auth=new AuthController(api);
  try {
    const pending=auth.initialize();
    await auth.initialize();await auth.initialize();
    assert.equal(reads,1);assert.equal(subscriptions,1);
    release({data:{session:null},error:null});await pending;
    for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','SIGNED_OUT'])callback(event,null);
    await auth.initialize();
    assert.equal(reads,1);assert.equal(subscriptions,1);
  } finally {auth.dispose();}
});

test('signup and logout reject bursts, including auth events while a request is pending',async()=>{
  let signups=0;let logins=0;let logouts=0;let release;
  const api=fakeApi({
    signUp:()=>{signups++;return new Promise(resolve=>{release=resolve;});},
    signInWithPassword:async()=>{logins++;return {data:{session},error:null};},
    signOut:()=>{logouts++;return new Promise(resolve=>{release=resolve;});}
  });
  const auth=new AuthController(api);await auth.initialize();
  try {
    const pending=auth.submit('student@example.test','password1',true,'https://example.test/');
    api.emit('SIGNED_IN',session);
    assert.equal(auth.state.busy,true);
    await Promise.all(Array.from({length:10},()=>auth.submit('student@example.test','password1',true,'https://example.test/')));
    await auth.submit('student@example.test','password1',false,'https://example.test/');
    assert.equal(await auth.logOut(),false);
    assert.deepEqual([signups,logins,logouts],[1,0,0]);
    release({data:{session},error:null});await pending;
    const logout=auth.logOut();api.emit('SIGNED_OUT',null);
    await Promise.all(Array.from({length:10},()=>auth.logOut()));
    await auth.submit('student@example.test','password1',true,'https://example.test/');
    assert.equal(auth.state.busy,true);assert.deepEqual([signups,logins,logouts],[1,0,1]);
    release({error:null});assert.equal(await logout,true);assert.equal(auth.state.busy,false);
  } finally {auth.dispose();}
});

test('real SDK sends one password/signup request per attempt without retrying failures',async()=>{
  let failure='server';const requests=[];
  const client=createClient('https://auth.example.test','sb_publishable_test',{
    auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false},
    global:{fetch:async input=>{
      requests.push(new URL(String(input)));
      if(failure==='network')throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({message:'Unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});
    }}
  });
  const auth=new AuthController(client.auth);
  try {
    await auth.initialize();assert.equal(requests.length,0);
    for(failure of ['server','network'])for(const signup of [false,true]) {
      const before=requests.length;
      await auth.submit('student@example.test','password1',signup,'https://example.test/');
      assert.equal(requests.length,before+1);assert.ok(auth.state.error);assert.equal(auth.state.busy,false);
      assert.equal(requests.at(-1).pathname,signup?'/auth/v1/signup':'/auth/v1/token');
      if(!signup)assert.equal(requests.at(-1).searchParams.get('grant_type'),'password');
    }
  } finally {auth.dispose();await client.auth.dispose();}
});

test('refresh restores auth and later sign-out events cannot be overwritten by stale session reads',async()=>{
  const auth=new AuthController(fakeApi({getSession:async()=>({data:{session},error:null})}));await auth.initialize();assert.equal(auth.state.session,session);auth.dispose();
  let release;const api=fakeApi({getSession:()=>new Promise(resolve=>{release=resolve;})});const racing=new AuthController(api);
  const pending=racing.initialize();api.emit('SIGNED_OUT',null);release({data:{session},error:null});await pending;assert.equal(racing.state.session,null);racing.dispose();
});

test('failed session recovery or logout preserves a truthful account state',async()=>{
  const broken=new AuthController(fakeApi({getSession:async()=>{throw Error('offline');}}));await broken.initialize();assert.equal(broken.state.loading,false);assert.ok(broken.state.error);broken.dispose();
  const auth=new AuthController(fakeApi({getSession:async()=>({data:{session},error:null}),signOut:async()=>({error:{status:503}})}));await auth.initialize();assert.equal(await auth.logOut(),false);assert.equal(auth.state.session,session);assert.equal(auth.state.busy,false);auth.dispose();
});

test('build accepts only public keys and origin URLs; secrets never enter the browser configuration',()=>{
  assert.deepEqual(validatePublicAuthConfig('',''),{url:'',key:''});
  assert.deepEqual(validatePublicAuthConfig('https://project.supabase.co/','sb_publishable_public'),{url:'https://project.supabase.co',key:'sb_publishable_public'});
  const token=role=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
  assert.ok(validatePublicAuthConfig('https://project.supabase.co',token('anon')));
  for(const key of ['sb_secret_unsafe',token('service_role'),'bad-key',''])assert.throws(()=>validatePublicAuthConfig('https://project.supabase.co',key));
  for(const url of ['http://remote.example','https://user:secret@example.com','https://example.com?key=secret'])assert.throws(()=>validatePublicAuthConfig(url,'sb_publishable_public'));
});

test('real SDK persists/restores authentication separately and never overwrites the existing study save',async()=>{
  const values=new Map([['study-metro:v2','{"network":"KEEP EXACTLY"}'],['study-metro:recovery','old study save']]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const originalStudy=values.get('study-metro:v2');const requests=[];
  const now=Math.floor(Date.now()/1000);const access='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'user-1',exp:now+3600})).toString('base64url')+'.signature';
  const fetch=async(input,init)=>{requests.push({url:String(input),method:init?.method});if(String(input).includes('/logout'))return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});return new Response(JSON.stringify({access_token:access,refresh_token:'refresh',expires_in:3600,token_type:'bearer',user:{id:'user-1',email:'student@example.test',aud:'authenticated'}}),{status:200,headers:{'Content-Type':'application/json'}});};
  const options={auth:{storage,storageKey:AUTH_STORAGE_KEY,autoRefreshToken:false,persistSession:true,detectSessionInUrl:false},global:{fetch}};
  const client=createClient('https://auth.example.test','sb_publishable_test',options);
  const signed=await client.auth.signInWithPassword({email:'student@example.test',password:'DO NOT STORE THIS'});assert.equal(signed.error,null);assert.ok(values.has(AUTH_STORAGE_KEY));assert.equal(values.get('study-metro:v2'),originalStudy);assert.doesNotMatch(values.get(AUTH_STORAGE_KEY),/DO NOT STORE THIS/);await client.auth.dispose();
  const restored=createClient('https://auth.example.test','sb_publishable_test',options);assert.equal((await restored.auth.getSession()).data.session.user.email,'student@example.test');
  assert.equal((await restored.auth.signOut({scope:'local'})).error,null);assert.equal(values.has(AUTH_STORAGE_KEY),false);assert.equal(values.get('study-metro:v2'),originalStudy);assert.equal(values.get('study-metro:recovery'),'old study save');assert.ok(requests.every(r=>new URL(r.url).pathname.startsWith('/auth/v1/')));await restored.auth.dispose();
});
