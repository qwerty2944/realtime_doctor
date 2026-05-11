import toIco from 'to-ico';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const iconset = join(root, 'build/icon.iconset');

const sizes = ['16x16', '32x32', '64x64', '128x128', '256x256'];
const pngs = sizes.map((s) => readFileSync(join(iconset, `icon_${s}.png`)));

const ico = await toIco(pngs);
const out = join(root, 'build/icon.ico');
writeFileSync(out, ico);
console.log(`[gen-ico] wrote ${out} (${ico.length} bytes)`);
