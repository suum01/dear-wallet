import { mkdir, readdir, readFile, copyFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
// Only public application assets enter the deployment artifact. Never copy the
// whole checkout: it can contain local exports, browser artifacts or .env files.
const sources = (await readdir(path.join(root, 'src'), { withFileTypes: true }))
  .filter(file => file.isFile() && /\.(js|css)$/.test(file.name))
  .map(file => `src/${file.name}`);
const files = ['index.html', 'favicon.svg', 'manifest.webmanifest', ...sources];
const html = await readFile(path.join(root, 'index.html'), 'utf8');
if (/\b(?:src|href)=["']\/(?!\/)/.test(html)) throw new Error('Use relative asset URLs for project-site hosting.');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'src'), { recursive: true });
for (const file of files) await copyFile(path.join(root, file), path.join(dist, file));
await writeFile(path.join(dist, '.nojekyll'), '');
console.log(`Built ${files.length} public files into dist/ (no dependencies required).`);
