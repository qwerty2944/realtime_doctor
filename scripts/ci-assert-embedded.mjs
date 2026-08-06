#!/usr/bin/env node
// CI-only guard. Runs on the build machine AFTER `electron-vite build` and
// BEFORE electron-builder packages the NSIS installer.
//
// Why: the .exe is LZMA-compressed, so grepping the installer proves nothing.
// The only place the baked configuration is inspectable is out/main/index.js,
// where electron.vite.config.ts inlined it via `define`.
//
// [HARD] This script never prints a secret value. It prints key NAMES, a
// PASS/MISSING marker, and counts only.
import { readFileSync, existsSync } from 'node:fs';

// Must stay in sync with EMBEDDED_ENV_KEYS in electron.vite.config.ts.
// DEVICE_FUNCTION_URL / AI_PROXY_URL are intentionally optional: src/main
// derives both from SUPABASE_URL when unset.
const REQUIRED_KEYS = [
  'GEMINI_TRANSCRIBE_MODEL',
  'GEMINI_DIARIZER_MODEL',
  'GEMINI_ANALYZER_MODEL',
  'GEMINI_SUMMARIZER_MODEL',
  'GEMINI_DICTATOR_MODEL',
  'CLOVA_API_KEY_ID',
  'CLOVA_API_KEY',
  'CLOVA_SPEECH_SECRET',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'ENTITLEMENT_PUBLIC_KEY',
  'ENTITLEMENT_URL',
  'BILLING_PORTAL_URL'
];
const OPTIONAL_KEYS = ['DEVICE_FUNCTION_URL', 'AI_PROXY_URL'];

// [HARD] Keys that A1 moved to Edge Function secrets. Asserting their ABSENCE
// is the whole point of that migration, and it has to be checked here rather
// than by eye: `define` inlines silently, so a key re-added to EMBEDDED_ENV_KEYS
// by a future edit would ship without anyone noticing.
//
// Checked two ways, because either alone is weak:
//   * the literal VALUE from .env must not appear in the bundle (catches the
//     value arriving through any path, not just `define`);
//   * the key NAME must not appear either (catches `process.env.OPENAI_API_KEY`
//     surviving in code, which would be a runtime undefined -- a silent
//     feature outage rather than a build failure).
const FORBIDDEN_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY'];

// Non-secret substrings that must appear in the bundle. Safe to print.
const REQUIRED_SUBSTRINGS = ['yhwvwojjwwlcrvpfxgag'];

const BUNDLE = 'out/main/index.js';
const ENV_FILE = '.env';

function fail(msg) {
  console.error(`ASSERTION FAILED: ${msg}`);
  process.exit(1);
}

if (!existsSync(BUNDLE)) fail(`${BUNDLE} not found — did electron-vite build run?`);
if (!existsSync(ENV_FILE)) fail(`${ENV_FILE} not found — the secret-writing step did not run.`);

const bundle = readFileSync(BUNDLE, 'utf8');

const env = new Map();
for (const rawLine of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 1) continue;
  env.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
}

// `define` inlines JSON.stringify(value); search for the escaped form so that
// multi-line values (e.g. a PEM public key) still match.
const needleOf = (value) => JSON.stringify(value).slice(1, -1);

let embedded = 0;
const missing = [];

for (const key of REQUIRED_KEYS) {
  const value = env.get(key);
  if (!value) {
    console.log(`  ${key.padEnd(26)} MISSING FROM .env`);
    missing.push(key);
    continue;
  }
  if (bundle.includes(needleOf(value))) {
    embedded += 1;
    console.log(`  ${key.padEnd(26)} EMBEDDED`);
  } else {
    console.log(`  ${key.padEnd(26)} NOT EMBEDDED`);
    missing.push(key);
  }
}

for (const key of OPTIONAL_KEYS) {
  const value = env.get(key);
  if (!value) {
    console.log(`  ${key.padEnd(26)} absent (optional, derived at runtime)`);
  } else if (bundle.includes(needleOf(value))) {
    embedded += 1;
    console.log(`  ${key.padEnd(26)} EMBEDDED (optional)`);
  } else {
    console.log(`  ${key.padEnd(26)} NOT EMBEDDED (optional)`);
  }
}

console.log(`\nEmbedded keys: ${embedded} (required: ${REQUIRED_KEYS.length})`);

// [HARD] A1: provider keys must not reach the client bundle.
console.log('\nForbidden (moved to Edge Function secrets in A1):');
for (const key of FORBIDDEN_KEYS) {
  const value = env.get(key);
  if (value && bundle.includes(needleOf(value))) {
    fail(`${key} VALUE is embedded in ${BUNDLE} — it must live only in Edge Function secrets.`);
  }
  if (bundle.includes(key)) {
    fail(`${key} is referenced by name in ${BUNDLE} — the client must not read this key.`);
  }
  console.log(`  ${key.padEnd(26)} ABSENT (value and name)`);
}

for (const s of REQUIRED_SUBSTRINGS) {
  const ok = bundle.includes(s);
  console.log(`Required substring "${s}": ${ok ? 'PRESENT' : 'ABSENT'}`);
  if (!ok) fail(`expected substring "${s}" not found in ${BUNDLE}`);
}

// [HARD] A private signing key must never reach the client bundle.
if (env.has('ENTITLEMENT_PRIVATE_KEY')) {
  fail('ENTITLEMENT_PRIVATE_KEY is present in .env — it must never be available to the build.');
}
if (/ENTITLEMENT_PRIVATE_KEY/.test(bundle)) {
  fail(`ENTITLEMENT_PRIVATE_KEY referenced in ${BUNDLE}`);
}
console.log('ENTITLEMENT_PRIVATE_KEY: absent from .env and bundle (as required)');

if (missing.length > 0) {
  fail(`${missing.length} required key(s) not embedded: ${missing.join(', ')}`);
}

if (embedded < REQUIRED_KEYS.length) {
  fail(`embedded key count ${embedded} < required ${REQUIRED_KEYS.length}`);
}

console.log('\nAll embedding assertions passed.');
