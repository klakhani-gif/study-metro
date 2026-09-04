import { existsSync, readFileSync } from 'node:fs';

function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}

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
  const local = existsSync(file) ? parseEnvFile(readFileSync(file, 'utf8')) : {};
  return validatePublicAuthConfig((environment.VITE_SUPABASE_URL ?? local.VITE_SUPABASE_URL ?? '').trim(), (environment.VITE_SUPABASE_PUBLISHABLE_KEY ?? local.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim());
}
