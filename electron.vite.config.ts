import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
