// Cleanup old + upload new builds to Supabase `downloads` bucket.
// 사용: node scripts/release-upload.mjs <version>
//   예) node scripts/release-upload.mjs 0.5.5
// 동작:
//   1) downloads/mac, downloads/win 의 기존 파일 중 새 VERSION 이 아닌 것 전부 삭제.
//   2) release/ 의 새 DMG + .exe (+ blockmap) 업로드.
// 필요한 정책: anon 키로 storage.objects 에 select/insert/delete 가능해야 함.
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
  console.error('Usage: node scripts/release-upload.mjs <version>  e.g. 0.5.5');
  process.exit(1);
}

const newPaths = new Set([
  `Realtime-Doctor-${VERSION}-arm64.dmg`,
  `Realtime-Doctor-Setup-${VERSION}.exe`,
  `Realtime-Doctor-Setup-${VERSION}.exe.blockmap`
]);

async function cleanFolder(folder) {
  const { data, error } = await supabase.storage.from('downloads').list(folder, {
    limit: 500
  });
  if (error) {
    console.error(`list ${folder} failed:`, error.message);
    return;
  }
  const stale = (data ?? [])
    .map((f) => f.name)
    .filter((name) => !newPaths.has(name));
  if (stale.length === 0) {
    console.log(`[${folder}] nothing to delete`);
    return;
  }
  const targets = stale.map((name) => `${folder}/${name}`);
  console.log(`[${folder}] deleting ${targets.length}: ${stale.join(', ')}`);
  const { data: del, error: delErr } = await supabase.storage
    .from('downloads')
    .remove(targets);
  if (delErr) {
    console.error(`delete ${folder} failed:`, delErr.message);
    return;
  }
  console.log(`[${folder}] removed ${del?.length ?? 0} object(s)`);
}

const uploads = [
  {
    local: `release/Realtime Doctor-${VERSION}-arm64.dmg`,
    remote: `mac/Realtime-Doctor-${VERSION}-arm64.dmg`,
    contentType: 'application/x-apple-diskimage'
  },
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

console.log(`>>> release upload for v${VERSION}`);

await cleanFolder('mac');
await cleanFolder('win');

for (const f of uploads) {
  const path = join(root, f.local);
  let size;
  try {
    size = statSync(path).size;
  } catch (err) {
    console.error(`missing local file: ${path}`);
    process.exit(1);
  }
  console.log(`uploading ${f.remote} (${(size / 1024 / 1024).toFixed(1)} MB)…`);
  const data = readFileSync(path);
  const { error } = await supabase.storage
    .from('downloads')
    .upload(f.remote, data, {
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

console.log('done');
