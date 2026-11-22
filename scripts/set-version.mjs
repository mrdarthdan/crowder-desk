// Sets the app version everywhere it's written down, or checks they all agree.
//   npm run set-version 1.3.0        update all four files
//   node scripts/set-version.mjs --check 1.3.0   fail unless every file says 1.3.0 (used by CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const version = args.find((a) => !a.startsWith('--'));

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: npm run set-version <major.minor.patch>   (add --check to only compare)');
  process.exit(1);
}

// Each entry finds the version in one file and can swap it out.
const files = [
  { path: 'package.json', re: /("version":\s*")([^"]+)(")/ },
  { path: 'src-tauri/tauri.conf.json', re: /("version":\s*")([^"]+)(")/ },
  { path: 'src-tauri/Cargo.toml', re: /(\[package\][^[]*?\nversion = ")([^"]+)(")/ },
  { path: 'src-tauri/Cargo.lock', re: /(\nname = "crowder-desk"\nversion = ")([^"]+)(")/ },
];

let bad = 0;
for (const f of files) {
  const full = join(root, f.path);
  const text = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(f.re);
  if (!m) { console.error(`${f.path}: version not found`); bad++; continue; }
  if (check) {
    if (m[2] !== version) { console.error(`${f.path}: ${m[2]} (expected ${version})`); bad++; }
    else console.log(`${f.path}: ${m[2]}`);
  } else if (m[2] !== version) {
    writeFileSync(full, text.replace(f.re, `$1${version}$3`));
    console.log(`${f.path}: ${m[2]} -> ${version}`);
  } else {
    console.log(`${f.path}: already ${version}`);
  }
}
process.exit(bad ? 1 : 0);
