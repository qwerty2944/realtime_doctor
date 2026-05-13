// Delete the old zips and upload the new NSIS .exe.
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

// delete old files
const toDelete = [
  `mac/Realtime-Doctor-${VERSION}-arm64-dmg.zip`,
  `win/Realtime-Doctor-${VERSION}-win.zip`
];
for (const path of toDelete) {
  const { error } = await supabase.storage.from('downloads').remove([path]);
  if (error) console.warn('delete failed', path, error);
  else console.log('deleted', path);
}

// upload nsis exe
const exePath = join(root, `release/Realtime Doctor Setup ${VERSION}.exe`);
const size = statSync(exePath).size;
console.log(`uploading win exe (${(size / 1024 / 1024).toFixed(1)} MB)…`);
const buf = readFileSync(exePath);
const { error: upErr } = await supabase.storage
  .from('downloads')
  .upload(`win/Realtime-Doctor-Setup-${VERSION}.exe`, buf, {
    contentType: 'application/vnd.microsoft.portable-executable',
    upsert: true
  });
if (upErr) {
  console.error(upErr);
  process.exit(1);
}
console.log('  -> uploaded');
console.log('done');
