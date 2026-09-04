import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserProfile { user_id: string; username: string; display_name: string | null; bio: string; is_public: boolean; created_at: string; updated_at: string }
export interface PublicProfile { username: string; display_name: string | null; is_public: boolean; joined_at: string | null; focus_seconds: number | null; journeys: number | null; completed_stations: number | null; subject_lines: string[] | null }
export class DuplicateUsername extends Error {}
export const usernameError = (value: string): string | null => /^[a-z0-9_]{3,20}$/.test(value) ? null : "Use 3–20 lowercase letters, numbers, or underscores.";
export function profileInputError(displayName: string, bio: string): string | null {
  if (displayName.trim().length > 40) return "Display name must be 40 characters or fewer.";
  if (bio.trim().length > 240) return "Bio must be 240 characters or fewer.";
  return null;
}
const text = (value: string): string | null => value.trim() || null;
export function profileError(error: unknown): string {
  const value = error as { code?: string; status?: number } | null;
  if (value?.code === "23505") return "That username is already in service. Try another.";
  if (value?.code === "42501") return "Profile access was denied. Check the profile RLS policies.";
  if (value?.status === 429) return "Too many profile requests. Wait briefly and try again.";
  return "Profile service is unavailable. Your study network is unaffected; try again later.";
}

export class ProfileStore {
  constructor(private client: SupabaseClient) {}
  async own(userId: string): Promise<UserProfile | null> {
    const { data, error } = await this.client.from("profiles").select("user_id,username,display_name,bio,is_public,created_at,updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw error; return data as UserProfile | null;
  }
  async create(userId: string, username: string, displayName: string): Promise<UserProfile> {
    const invalid = usernameError(username) ?? profileInputError(displayName, ""); if (invalid) throw new Error(invalid);
    const { data, error } = await this.client.from("profiles").insert({ user_id: userId, username, display_name: text(displayName), bio: "", is_public: false }).select("user_id,username,display_name,bio,is_public,created_at,updated_at").single();
    if (error?.code === "23505") throw new DuplicateUsername(); if (error) throw error; return data;
  }
  async update(userId: string, displayName: string, bio: string, isPublic: boolean): Promise<UserProfile> {
    const invalid = profileInputError(displayName, bio); if (invalid) throw new Error(invalid);
    const { data, error } = await this.client.from("profiles").update({ display_name: text(displayName), bio: bio.trim(), is_public: isPublic }).eq("user_id", userId).select("user_id,username,display_name,bio,is_public,created_at,updated_at").single();
    if (error) throw error; return data as UserProfile;
  }
  async public(username: string): Promise<PublicProfile | null> {
    if (usernameError(username)) return null;
    const { data, error } = await this.client.rpc("get_study_metro_public_profile", { lookup_username: username }).maybeSingle();
    if (error) throw error; return normalizePublicProfile(data, username);
  }
}

export class ProfileController {
  profile: UserProfile | null = null; loading = false; busy = false; error = ""; userId: string | null = null;
  private version = 0; private listeners = new Set<() => void>();
  constructor(private store: ProfileStore) {}
  subscribe(fn:()=>void):()=>void { this.listeners.add(fn); return()=>this.listeners.delete(fn); }
  private notify(){this.listeners.forEach(fn=>fn());}
  leave(){this.version++;this.userId=null;this.profile=null;this.loading=false;this.busy=false;this.error="";this.notify();}
  async retry(){const id=this.userId;if(!id||this.loading||this.busy)return;this.leave();await this.enter(id);}
  async enter(userId:string){if(this.userId===userId)return;this.leave();this.userId=userId;const version=this.version;this.loading=true;this.notify();try{const profile=await this.store.own(userId);if(version===this.version)this.profile=profile;}catch(error){if(version===this.version)this.error=profileError(error);}finally{if(version===this.version){this.loading=false;this.notify();}}}
  async create(username:string,displayName:string):Promise<boolean>{if(!this.userId||this.busy)return false;this.error="";const invalid=usernameError(username)||profileInputError(displayName,"");if(invalid){this.error=invalid;this.notify();return false;}this.busy=true;this.notify();try{this.profile=await this.store.create(this.userId,username,displayName);return true;}catch(error){this.error=error instanceof DuplicateUsername?"That username is already in service. Try another.":profileError(error);return false;}finally{this.busy=false;this.notify();}}
  async update(displayName:string,bio:string,isPublic:boolean):Promise<boolean>{if(!this.userId||!this.profile||this.busy)return false;this.error="";const invalid=profileInputError(displayName,bio);if(invalid){this.error=invalid;this.notify();return false;}this.busy=true;this.notify();try{this.profile=await this.store.update(this.userId,displayName,bio,isPublic);return true;}catch(error){this.error=profileError(error);return false;}finally{this.busy=false;this.notify();}}
}

export function normalizePublicProfile(value: unknown, requested: string): PublicProfile | null {
  if (!value || typeof value !== "object") return null;
  const row=value as Record<string,unknown>;
  if (row.username!==requested || typeof row.is_public!=="boolean") throw new Error("Invalid public profile");
  if (!row.is_public) return {username:requested,display_name:null,is_public:false,joined_at:null,focus_seconds:null,journeys:null,completed_stations:null,subject_lines:null};
  const number=(input:unknown):number=>typeof input==="number"&&Number.isSafeInteger(input)&&input>=0?input:0;
  const lines=Array.isArray(row.subject_lines)?row.subject_lines.filter((x):x is string=>typeof x==="string"&&x.trim().length>0).slice(0,32).map(x=>x.slice(0,40)):[];
  return {username:requested,display_name:typeof row.display_name==="string"?row.display_name.slice(0,40):null,is_public:true,joined_at:typeof row.joined_at==="string"&&Number.isFinite(Date.parse(row.joined_at))?row.joined_at:null,focus_seconds:number(row.focus_seconds),journeys:number(row.journeys),completed_stations:number(row.completed_stations),subject_lines:lines};
}

export function profileUsernameFromPath(pathname: string): string | null {
  const match=/^\/u\/([^/]+)\/?$/.exec(pathname);if(!match)return null;
  try {const value=decodeURIComponent(match[1]);return usernameError(value)?null:value;} catch{return null;}
}
