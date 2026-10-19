import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const library = path.dirname(fileURLToPath(import.meta.resolve('@arinox/react')));
const destination = new URL('../electron/arinox/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const folder of ['styles', 'assets']) {
  await cp(path.join(library, folder), new URL(folder, destination), { recursive: true });
}
await cp(new URL('../src/styles/titlebar.css', import.meta.url), new URL('titlebar.css', destination));
for (const target of [new URL('LOCAL_PATCH.diff', destination), new URL('../public/licenses/arinox/LOCAL_PATCH.diff', import.meta.url)]) {
  await cp(new URL('../vendor/arinox-desktop.patch', import.meta.url), target);
}
console.log('Prepared offline Arinox startup styles, fonts and original asset notices');
