import { copyFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { build } from 'esbuild';
import { readAuthEnv } from './auth-env.mjs';

// Bundle the npm SDK for the browser; only this explicit public env allowlist is exposed.
const auth = readAuthEnv();

// Remove stale compiled modules when a prototype-only source module is removed.
for (const file of readdirSync('dist')) {
  if (/\.js(?:\.map)?$/.test(file) && !existsSync(`src/${file.replace(/\.js(?:\.map)?$/, '.ts')}`)) unlinkSync(`dist/${file}`);
}
// Cached Cloudflare build output may still contain the retired Pages redirect file.
if (existsSync('dist/_redirects')) unlinkSync('dist/_redirects');

for (const file of ['index.html', 'styles.css', 'favicon.svg', 'study-metro-logo.png', '404.html', '.assetsignore']) {
  copyFileSync(`public/${file}`, `dist/${file}`);
}

await build({ entryPoints: ['src/app.ts'], outfile: 'dist/app.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', sourcemap: true,
  define: { __SUPABASE_URL__: JSON.stringify(auth.url), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(auth.key) } });
