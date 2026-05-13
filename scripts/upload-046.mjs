// Upload v__OLDVER__ DMG + NSIS exe to Supabase `downloads` bucket
// and delete the older v__OLDVER__ artifacts.
//
// Requires the bucket's TEMP anon-insert/delete policy to be active
// (see downloads_anon_write_temp).
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

const OLD = '0.4.8';
const NEW = '0.4.9';

const toDelete = [
  `mac/Realtime-Doctor-${OLD}-arm64.dmg`,
  `win/Realtime-Doctor-Setup-${OLD}.exe`
];
for (const path of toDelete) {
  const { error } = await supabase.storage.from('downloads').remove([path]);
  if (error) console.warn('delete failed', path, error.message);
  else console.log('deleted', path);
}

const uploads = [
  {
    local: `release/Realtime Doctor-${NEW}-arm64.dmg`,
    remote: `mac/Realtime-Doctor-${NEW}-arm64.dmg`,
    contentType: 'application/x-apple-diskimage'
  },
  {
    local: `release/Realtime Doctor Setup ${NEW}.exe`,
    remote: `win/Realtime-Doctor-Setup-${NEW}.exe`,
    contentType: 'application/vnd.microsoft.portable-executable'
  }
];

for (const f of uploads) {
  const path = join(root, f.local);
  const size = statSync(path).size;
  console.log(`uploading ${f.remote} (${(size / 1024 / 1024).toFixed(1)} MB)…`);
  const buf = readFileSync(path);
  const { error } = await supabase.storage
    .from('downloads')
    .upload(f.remote, buf, { contentType: f.contentType, upsert: true });
  if (error) {
    console.error('FAILED', f.remote, error.message);
    process.exit(1);
  }
  const publicUrl = supabase.storage
    .from('downloads')
    .getPublicUrl(f.remote).data.publicUrl;
  console.log(`  -> ${publicUrl}`);
}
console.log('done');
