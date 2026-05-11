// One-off: generate a 1024x1024 app icon PNG via Gemini image gen.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/gen-icon.mjs
//
// Output: build/icon-1024.png
import { writeFileSync, mkdirSync } from 'node:fs';
import { config as dotenv } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
dotenv({ path: join(root, '.env') });

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error('GEMINI_API_KEY missing.');
  process.exit(1);
}

const MODEL = 'gemini-2.5-flash-image';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PROMPT = `Square macOS application icon, 1024x1024, modern Apple iOS/macOS style.
Subject: an abstract clinical-assistant glyph — a soft rounded speech bubble fused with a minimalist medical cross, accented with a thin sound-wave arc.
Style: glassmorphic translucent surface, deep navy and teal gradient background, subtle inner glow, soft drop shadow, rounded squircle silhouette.
Composition: centered, generous margin, vector-clean edges, no text, no letters, no numbers, no watermark.
Color palette: navy #0b1d3a, teal #18b6c8, white accents, deep glow.
Mood: clinical, calm, trustworthy, premium.`;

console.log(`[gen-icon] calling ${MODEL}…`);

const resp = await fetch(URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': KEY
  },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: PROMPT }] }]
  })
});

if (!resp.ok) {
  const txt = await resp.text();
  console.error(`HTTP ${resp.status}: ${txt}`);
  process.exit(2);
}

const data = await resp.json();
const parts = data?.candidates?.[0]?.content?.parts ?? [];
const imagePart = parts.find(
  (p) => p?.inlineData?.mimeType?.startsWith('image/') && p.inlineData.data
);

if (!imagePart) {
  console.error('No image part in response:', JSON.stringify(data, null, 2));
  process.exit(3);
}

const buf = Buffer.from(imagePart.inlineData.data, 'base64');
const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'icon-1024.png');
writeFileSync(outPath, buf);
console.log(`[gen-icon] wrote ${outPath} (${buf.length} bytes)`);
