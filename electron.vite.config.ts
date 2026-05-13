import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(__dirname, '.env') });

const EMBEDDED_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_TRANSCRIBE_MODEL',
  'GEMINI_DIARIZER_MODEL',
  'GEMINI_ANALYZER_MODEL',
  'GEMINI_SUMMARIZER_MODEL',
  'GEMINI_DICTATOR_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_TRANSCRIBE_MODEL',
  'CLOVA_API_KEY_ID',
  'CLOVA_API_KEY',
  'CLOVA_SPEECH_SECRET',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY'
] as const;

const mainDefine: Record<string, string> = {};
for (const k of EMBEDDED_ENV_KEYS) {
  const v = process.env[k];
  if (v) mainDefine[`process.env.${k}`] = JSON.stringify(v);
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: mainDefine,
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          transcript: resolve(__dirname, 'src/renderer/transcript/index.html'),
          diagnosis: resolve(__dirname, 'src/renderer/diagnosis/index.html'),
          terms: resolve(__dirname, 'src/renderer/terms/index.html'),
          questions: resolve(__dirname, 'src/renderer/questions/index.html'),
          summary: resolve(__dirname, 'src/renderer/summary/index.html'),
          dictation: resolve(__dirname, 'src/renderer/dictation/index.html'),
          dock: resolve(__dirname, 'src/renderer/dock/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    }
  }
});
