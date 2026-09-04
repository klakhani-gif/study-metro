import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function validatePublicAuthConfig(url, key) {
  if (!url && !key) return { url: '', key: '' };
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Set a valid VITE_SUPABASE_URL and public publishable key.'); }
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw new Error('VITE_SUPABASE_URL must be an HTTPS project origin (HTTP is allowed for local Supabase).');
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* Invalid or non-public JWT. */ }
  }
  if (!publicKey) throw new Error('Use a Supabase publishable key or legacy anon key. Secret/service-role keys must never be bundled.');
  return { url: parsed.origin, key };
}

export function readAuthEnv(environment = process.env, file = '.env.local') {
  const local = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  return validatePublicAuthConfig((environment.VITE_SUPABASE_URL ?? local.VITE_SUPABASE_URL ?? '').trim(), (environment.VITE_SUPABASE_PUBLISHABLE_KEY ?? local.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim());
}
