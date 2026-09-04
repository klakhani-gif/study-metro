import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppState } from "./model.js";

export interface CloudRow { user_id: string; state: unknown; updated_at: string }
export interface CloudStore {
  read(userId: string, signal: AbortSignal): Promise<CloudRow | null>;
  write(userId: string, state: AppState, version: string | null, signal: AbortSignal): Promise<CloudRow>;
}
export class SyncConflict extends Error {}

/** RLS is the authorization boundary. Filters additionally scope every operation to the session user. */
export function createCloudStore(client: SupabaseClient): CloudStore {
  return {
    async read(userId, signal) {
      const { data, error } = await client.from("user_state").select("user_id,state,updated_at").eq("user_id", userId).abortSignal(signal).maybeSingle();
      if (error) throw error;
      return data;
    },
    async write(userId, state, version, signal) {
      // Change the token even if two saves land within one millisecond. Preserve server-returned precision on the WHERE filter.
      const updated_at = new Date(Math.max(Date.now(), version ? Date.parse(version) + 1 : 0)).toISOString();
      const query = version === null
        ? client.from("user_state").insert({ user_id: userId, state, updated_at })
        : client.from("user_state").update({ state, updated_at }).eq("user_id", userId).eq("updated_at", version);
      const { data, error } = await query.select("user_id,state,updated_at").abortSignal(signal).maybeSingle();
      if (error?.code === "23505" || (!error && !data)) throw new SyncConflict("The cloud copy changed.");
      if (error) throw error;
      return data!;
    }
  };
}
