import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppState } from "./model.js";
import { isCompletedStation } from "./revision.js";

export interface FriendRelation { peer_user_id:string; username:string; display_name:string|null; relationship_status:string; relationship_direction:string; created_at:string; updated_at:string }
export interface ProfileSearchResult { username:string; display_name:string|null; is_public:boolean; relationship_status:string|null; relationship_direction:string }
export interface UserStats { user_id:string; week_start:string; focus_minutes_this_week:number; journeys_this_week:number; total_focus_minutes:number; total_journeys:number; completed_stations:number; updated_at:string }
export interface LeaderboardIdentity { userId:string; username:string; displayName:string|null; current:boolean }
export interface LeaderboardEntry extends LeaderboardIdentity { rank:number; focusMinutes:number; journeys:number }

export function localWeekStart(now=Date.now()):string { const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
export function aggregateUserStats(state:AppState,userId:string,now=Date.now()):Omit<UserStats,"updated_at"> {const start=new Date(`${localWeekStart(now)}T00:00:00`).getTime(),end=new Date(start);end.setDate(end.getDate()+7);const weekly=state.history.filter(j=>j.completedAt>=start&&j.completedAt<+end);return{user_id:userId,week_start:localWeekStart(now),focus_minutes_this_week:Math.floor(weekly.reduce((n,j)=>n+j.focusedSeconds,0)/60),journeys_this_week:weekly.length,total_focus_minutes:Math.floor(state.history.reduce((n,j)=>n+j.focusedSeconds,0)/60),total_journeys:state.history.length,completed_stations:state.stations.filter(isCompletedStation).length};}
const safeNumber=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:0;
export function normalizeStats(value:unknown):UserStats|null{if(!value||typeof value!=="object")return null;const r=value as Record<string,unknown>;if(typeof r.user_id!=="string"||typeof r.week_start!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.week_start))return null;return{user_id:r.user_id,week_start:r.week_start,focus_minutes_this_week:safeNumber(r.focus_minutes_this_week),journeys_this_week:safeNumber(r.journeys_this_week),total_focus_minutes:safeNumber(r.total_focus_minutes),total_journeys:safeNumber(r.total_journeys),completed_stations:safeNumber(r.completed_stations),updated_at:typeof r.updated_at==="string"?r.updated_at:""};}
export function createLeaderboard(stats:UserStats[],identities:LeaderboardIdentity[],weekStart:string):LeaderboardEntry[]{const byId=new Map(stats.map(row=>[row.user_id,row]));return identities.map(identity=>{const row=byId.get(identity.userId),current=row?.week_start===weekStart;return{...identity,rank:0,focusMinutes:current?row.focus_minutes_this_week:0,journeys:current?row.journeys_this_week:0};}).sort((a,b)=>b.focusMinutes-a.focusMinutes||b.journeys-a.journeys||a.username.localeCompare(b.username)).map((entry,index)=>({...entry,rank:index+1}));}
export function normalizeRelations(value:unknown):FriendRelation[]{if(!Array.isArray(value))return[];const priority=(r:FriendRelation)=>r.relationship_status==="accepted"?3:r.relationship_direction==="incoming"?2:1,map=new Map<string,FriendRelation>();for(const item of value){if(!item||typeof item!=="object")continue;const r=item as FriendRelation;if(typeof r.peer_user_id!=="string"||typeof r.username!=="string"||!["pending","accepted"].includes(r.relationship_status)||!["incoming","outgoing","accepted"].includes(r.relationship_direction))continue;const old=map.get(r.peer_user_id);if(!old||priority(r)>priority(old))map.set(r.peer_user_id,r);}return[...map.values()];}
export function partitionRelations(relations:FriendRelation[]){return{accepted:relations.filter(r=>r.relationship_status==="accepted"),incoming:relations.filter(r=>r.relationship_direction==="incoming"),outgoing:relations.filter(r=>r.relationship_direction==="outgoing")};}
export function friendSearchError(query:string,ownUsername:string):string|null{return query===ownUsername?"That is your own route identity.":/^[a-z0-9_]{3,20}$/.test(query)?null:"Use 3–20 lowercase letters, numbers, or underscores.";}
export function friendError(error:unknown):string{const e=error as {code?:string;status?:number;message?:string}|null;if(e?.code==="42501")return"Friend access was denied. Check the social RLS and RPC grants.";if(e?.code==="23505")return"That connection already exists. Refreshing the service board may resolve it.";if(e?.status===429)return"Too many requests. Wait briefly and try again.";return"Friend services are temporarily unavailable. Your private study data is unaffected.";}

export class FriendStore{
  constructor(private client:SupabaseClient){}
  async relations():Promise<FriendRelation[]>{const{data,error}=await this.client.rpc("list_study_metro_friendships");if(error)throw error;return normalizeRelations(data);}
  async search(lookup:string):Promise<ProfileSearchResult[]>{const{data,error}=await this.client.rpc("search_study_metro_profiles",{lookup,result_limit:12});if(error)throw error;return Array.isArray(data)?data.filter((r):r is ProfileSearchResult=>!!r&&typeof r.username==="string"&&typeof r.is_public==="boolean").slice(0,12):[];}
  async stats():Promise<UserStats[]>{const{data,error}=await this.client.from("user_stats").select("user_id,week_start,focus_minutes_this_week,journeys_this_week,total_focus_minutes,total_journeys,completed_stations,updated_at");if(error)throw error;return Array.isArray(data)?data.map(normalizeStats).filter((x):x is UserStats=>!!x):[];}
  async saveStats(row:Omit<UserStats,"updated_at">):Promise<void>{const{error}=await this.client.from("user_stats").upsert({...row,updated_at:new Date().toISOString()},{onConflict:"user_id"});if(error)throw error;}
  async send(username:string){return this.mutate("send_friend_request",{target_username:username});}
  async accept(id:string){return this.mutate("accept_friend_request",{other_user_id:id});}
  async decline(id:string){return this.mutate("decline_friend_request",{other_user_id:id});}
  async cancel(id:string){return this.mutate("cancel_friend_request",{other_user_id:id});}
  async remove(id:string){return this.mutate("remove_friend",{other_user_id:id});}
  private async mutate(name:string,args:Record<string,string>):Promise<void>{const{error}=await this.client.rpc(name,args);if(error)throw error;}
}

export class StatsSync{
  error="";private userId:string|null=null;private timer:ReturnType<typeof setTimeout>|null=null;private busy=false;private pending:Omit<UserStats,"updated_at">|null=null;private last="";private epoch=0;
  constructor(private store:Pick<FriendStore,"saveStats">,private delay=1200){}
  enter(userId:string){if(this.userId===userId)return;this.leave();this.userId=userId;}
  leave(){this.epoch++;if(this.timer)clearTimeout(this.timer);this.timer=null;this.userId=null;this.pending=null;this.busy=false;this.last="";this.error="";}
  schedule(state:AppState,now=Date.now()){if(!this.userId)return;this.pending=aggregateUserStats(state,this.userId,now);const value=JSON.stringify(this.pending);if(value===this.last)return;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.delay);}
  async flush(){if(!this.userId||!this.pending||this.busy)return;const snapshot=this.pending,serialized=JSON.stringify(snapshot),epoch=this.epoch;this.busy=true;this.error="";try{await this.store.saveStats(snapshot);if(epoch===this.epoch)this.last=serialized;}catch(error){if(epoch===this.epoch){this.error=friendError(error);this.pending=null;}}finally{if(epoch===this.epoch){this.busy=false;if(this.pending&&JSON.stringify(this.pending)!==this.last){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.delay);}}}}
}
