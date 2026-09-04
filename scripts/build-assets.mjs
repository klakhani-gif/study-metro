import { copyFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';

// Remove stale compiled modules when a prototype-only source module is removed.
for (const file of readdirSync('dist')) {
  if (/\.js(?:\.map)?$/.test(file) && !existsSync(`src/${file.replace(/\.js(?:\.map)?$/, '.ts')}`)) unlinkSync(`dist/${file}`);
}

for (const file of ['index.html', 'styles.css', 'favicon.svg', '404.html']) {
  copyFileSync(`public/${file}`, `dist/${file}`);
}
