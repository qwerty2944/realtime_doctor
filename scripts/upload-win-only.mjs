// Win-only upload: push the new VERSION exe + blockmap to Supabase `downloads/win`,
// clean stale win files, and leave the `mac/` folder untouched.
// Usage: node scripts/upload-win-only.mjs <version>
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
  console.error('Usage: node scripts/upload-win-only.mjs <version>');
  process.exit(1);
}

const uploads = [
  {
    local: `release/Realtime Doctor Setup ${VERSION}.exe`,
    remote: `win/Realtime-Doctor-Setup-${VERSION}.exe`,
    contentType: 'application/x-msdownload'
  },
  {
    local: `release/Realtime Doctor Setup ${VERSION}.exe.blockmap`,
    remote: `win/Realtime-Doctor-Setup-${VERSION}.exe.blockmap`,
    contentType: 'application/octet-stream'
  }
];
const keep = new Set(uploads.map((u) => u.remote.replace('win/', '')));

// clean stale win files (keep only the new version's files)
const { data: list, error: listErr } = await supabase.storage
  .from('downloads')
  .list('win', { limit: 500 });
if (listErr) {
  console.error('list win failed:', listErr.message);
  process.exit(1);
}
const stale = (list ?? []).map((f) => f.name).filter((n) => !keep.has(n));
if (stale.length) {
  const targets = stale.map((n) => `win/${n}`);
  console.log(`[win] deleting ${targets.length}: ${stale.join(', ')}`);
  const { error: delErr } = await supabase.storage
    .from('downloads')
    .remove(targets);
  if (delErr) console.error('delete failed:', delErr.message);
} else {
  console.log('[win] nothing stale to delete');
}

for (const f of uploads) {
  const path = join(root, f.local);
  const size = statSync(path).size;
  console.log(`uploading ${f.remote} (${(size / 1024 / 1024).toFixed(1)} MB)…`);
  const { error } = await supabase.storage
    .from('downloads')
    .upload(f.remote, readFileSync(path), {
      contentType: f.contentType,
      upsert: true
    });
  if (error) {
    console.error('FAILED', f.remote, error.message);
    process.exit(1);
  }
  const publicUrl = supabase.storage.from('downloads').getPublicUrl(f.remote).data
    .publicUrl;
  console.log(`  -> ${publicUrl}`);
}
console.log('done (mac/ untouched)');
