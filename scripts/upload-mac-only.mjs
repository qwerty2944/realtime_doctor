// Mac-only upload: push the new VERSION dmg to Supabase `downloads/mac`,
// clean stale mac dmgs, and leave the `win/` folder untouched.
// Usage: node scripts/upload-mac-only.mjs <version>
import { createClient } from '@supabase/supabase-js';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const URL = 'https://yqdzxitlmtawznzwpkra.supabase.co';
const KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxZHp4aXRsbXRhd3puendwa3JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDcwNTMsImV4cCI6MjA5NDA4MzA1M30.lORYz6ejjy-NkI0___JinbyGRYpumBr8LbHoYMQzvkM';

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const VERSION = process.argv[2];
if (!VERSION || !/^\d+\.\d+\.\d+$/.test(VERSION)) {
  console.error('Usage: node scripts/upload-mac-only.mjs <version>');
  process.exit(1);
}

const newDmg = `Realtime-Doctor-${VERSION}-arm64.dmg`;

// clean stale mac files (keep only the new dmg)
const { data: list, error: listErr } = await supabase.storage
  .from('downloads')
  .list('mac', { limit: 500 });
if (listErr) {
  console.error('list mac failed:', listErr.message);
  process.exit(1);
}
const stale = (list ?? []).map((f) => f.name).filter((n) => n !== newDmg);
if (stale.length) {
  const targets = stale.map((n) => `mac/${n}`);
  console.log(`[mac] deleting ${targets.length}: ${stale.join(', ')}`);
  const { error: delErr } = await supabase.storage
    .from('downloads')
    .remove(targets);
  if (delErr) console.error('delete failed:', delErr.message);
} else {
  console.log('[mac] nothing stale to delete');
}

const local = join(root, `release/Realtime Doctor-${VERSION}-arm64.dmg`);
const size = statSync(local).size;
console.log(`uploading mac/${newDmg} (${(size / 1024 / 1024).toFixed(1)} MB)…`);
const { error } = await supabase.storage
  .from('downloads')
  .upload(`mac/${newDmg}`, readFileSync(local), {
    contentType: 'application/x-apple-diskimage',
    upsert: true
  });
if (error) {
  console.error('FAILED', error.message);
  process.exit(1);
}
const publicUrl = supabase.storage.from('downloads').getPublicUrl(`mac/${newDmg}`)
  .data.publicUrl;
console.log(`  -> ${publicUrl}`);
console.log('done (win/ untouched)');
