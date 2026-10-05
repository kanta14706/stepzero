// Copy the importer's station graphs and map polygons into public/data/ so the dev server and
// the build can serve them. public/data is git-ignored. Missing data is not an error: the app
// shows "data not built" instead.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, '../../data/build');
const target = resolve(root, 'public/data');

if (!existsSync(resolve(source, 'graphs/index.json'))) {
  console.warn(
    `sync-data: ${source}/graphs/index.json not found; run the importer first. Skipping.`,
  );
  process.exit(0);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const dir of ['graphs', 'maps']) {
  if (existsSync(resolve(source, dir)))
    cpSync(resolve(source, dir), resolve(target, dir), { recursive: true });
}
console.log('sync-data: copied graphs and maps to public/data');
