import { cpSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const www = resolve(root, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

const copy = ['index.html', 'css', 'js', 'lib'];
for (const entry of copy) {
    cpSync(resolve(root, entry), resolve(www, entry), { recursive: true });
}

console.log('www/ generado para Capacitor');
