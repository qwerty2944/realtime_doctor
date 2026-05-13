// One-off: upload the latest mac DMG / dmg.zip / Windows zip to the
// Supabase `downloads` bucket so the landing page can serve them.
//
// Usage: node scripts/upload-builds.mjs
//
// Requires the bucket's TEMP anon-insert policy to be active.
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

const VERSION = '0.4.5';

const files = [
  {
    local: `release/Realtime Doctor-${VERSION}-arm64.dmg`,
    remote: `mac/Realtime-Doctor-${VERSION}-arm64.dmg`,
    contentType: 'application/x-apple-diskimage'
  },
  {
    local: `release/Realtime-Doctor-${VERSION}-arm64-dmg.zip`,
    remote: `mac/Realtime-Doctor-${VERSION}-arm64-dmg.zip`,
    contentType: 'application/zip'
  },
  {
    local: `release/Realtime Doctor-${VERSION}-win.zip`,
    remote: `win/Realtime-Doctor-${VERSION}-win.zip`,
    contentType: 'application/zip'
  }
];

for (const f of files) {
  const path = join(root, f.local);
  const size = statSync(path).size;
  console.log(`uploading ${f.remote} (${(size / 1024 / 1024).toFixed(1)} MB)…`);
  const data = readFileSync(path);
  const { error } = await supabase.storage
    .from('downloads')
    .upload(f.remote, data, {
      contentType: f.contentType,
      upsert: true
    });
  if (error) {
    console.error('FAILED', f.remote, error);
    process.exit(1);
  }
  const publicUrl = supabase.storage.from('downloads').getPublicUrl(f.remote).data
    .publicUrl;
  console.log(`  -> ${publicUrl}`);
}
console.log('done');
