import test from 'node:test';
import assert from 'node:assert/strict';
import {combinePresence,FriendPresenceManager,publicActivity,safePresence} from '../dist/presence.js';

const at='2026-09-05T12:00:00.000Z';
const payload=(status,extra={})=>({user_id:'friend-1',status,updated_at:at,...extra});

test('friend presence represents online, focusing, paused and offline states',()=>{
  assert.equal(combinePresence([payload('ONLINE')],'friend-1').status,'ONLINE');
  assert.deepEqual(combinePresence([payload('FOCUSING',{subject_line_name:'Anatomy',remaining_minutes:34})],'friend-1'),{status:'FOCUSING',subjectLine:'Anatomy',remainingMinutes:34,updatedAt:at});
  assert.equal(combinePresence([payload('PAUSED')],'friend-1').status,'PAUSED');
  assert.equal(combinePresence([],'friend-1').status,'OFFLINE');
});

test('privacy disabled broadcasts generic online state without detail',()=>{
  assert.deepEqual(publicActivity('me',{status:'FOCUSING',subjectLine:'Anatomy',remainingMinutes:34},false,Date.parse(at)),{user_id:'me',status:'ONLINE',updated_at:at});
  assert.deepEqual(publicActivity('me',{status:'PAUSED',subjectLine:'Anatomy',remainingMinutes:34},true,Date.parse(at)),{user_id:'me',status:'PAUSED',updated_at:at});
});

test('unsafe and mismatched presence payloads are ignored',()=>{
  assert.equal(safePresence({...payload('ONLINE'),email:'private@example.com'},'other'),null);
  assert.equal(safePresence(payload('UNKNOWN'),'friend-1'),null);
  assert.equal(safePresence(payload('FOCUSING',{remaining_minutes:999}),'friend-1')?.remaining_minutes,undefined);
});

class FakeChannel{
  constructor(topic,options){this.topic=topic;this.options=options;this.tracks=[];this.state={};this.sync=null;this.status=null;}
  on(_type,_filter,callback){this.sync=callback;return this;}
  subscribe(callback){this.status=callback;callback('SUBSCRIBED');return this;}
  async track(value){this.tracks.push(value);return 'ok';}
  presenceState(){return this.state;}
}
class FakeClient{
  constructor(){this.channels=[];this.removed=[];this.authRefreshes=0;this.realtime={setAuth:async()=>{this.authRefreshes++;}};}
  channel(topic,options){const channel=new FakeChannel(topic,options);this.channels.push(channel);return channel;}
  async removeChannel(channel){this.removed.push(channel.topic);return 'ok';}
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('manager subscribes only to supplied accepted-friend ids',async()=>{
  const client=new FakeClient(),manager=new FriendPresenceManager(client);
  await manager.enter('me');await manager.setFriends(['friend-1']);await settle();
  assert.deepEqual(client.channels.map(x=>x.topic),['study-metro:user:me','study-metro:user:friend-1']);
  assert.ok(client.channels.every(x=>x.options.config.private===true));
  assert.ok(!client.channels.some(x=>x.topic.includes('stranger')));
});

test('logout removes own and friend channels and clears visible state',async()=>{
  const client=new FakeClient(),manager=new FriendPresenceManager(client);
  await manager.enter('me');await manager.setFriends(['friend-1']);
  const friend=client.channels[1];friend.state={tab:[payload('ONLINE')]};friend.sync();
  assert.equal(manager.get('friend-1').status,'ONLINE');
  await manager.leave();
  assert.equal(manager.get('friend-1').status,'OFFLINE');
  assert.deepEqual(client.removed.sort(),['study-metro:user:friend-1','study-metro:user:me']);
});

test('reconnect publishes current activity again',async()=>{
  const client=new FakeClient(),manager=new FriendPresenceManager(client);
  await manager.enter('me');await settle();
  manager.setActivity({status:'FOCUSING',subjectLine:'Anatomy',remainingMinutes:20},true);await settle();
  const own=client.channels[0],before=own.tracks.length;
  own.status('SUBSCRIBED');await settle();
  assert.equal(own.tracks.length,before+1);
  assert.equal(own.tracks.at(-1).status,'FOCUSING');
});

test('multiple tabs resolve to the most active state',()=>{
  const result=combinePresence([payload('ONLINE'),payload('PAUSED',{remaining_minutes:18}),payload('FOCUSING',{subject_line_name:'Biology',remaining_minutes:12})],'friend-1');
  assert.equal(result.status,'FOCUSING');
  assert.equal(result.subjectLine,'Biology');
});
