import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(__dirname, '.env') });

// ═══════════════════════════════════════════════════════════════════════════
// [HARD] 여기 넣는 값은 빌드타임에 main 번들로 **평문 인라인**된다.
// ═══════════════════════════════════════════════════════════════════════════
//
// 판단 기준은 하나다: "이 값을 가진 사람이 소유자에게 비용을 발생시킬 수
// 있는가?" 그럴 수 있으면 여기 넣지 않는다. 빌드를 가진 사람은 곧 그 값을 가진
// 사람이고, 회수하려면 전 설치본을 다시 배포해야 하기 때문이다.
//
// A1 에서 GEMINI_API_KEY 와 OPENAI_API_KEY 를 뺐다. 두 키는 이제 Edge Function
// 시크릿(`ai-gemini`, `ai-realtime`)에만 있고, 앱은 자기 로그인 토큰으로 그
// 함수들에 물어본다. 남아 있는 CLOVA 세 개는 A1 범위 밖이다 -- 스트리밍이
// gRPC 라 프록시가 간단하지 않고, 반쪽만 옮기지 않기로 했다 (STATE.md 참조).
//
// [HARD] 이 목록은 세 곳에 미러돼 있다. 하나만 고치면 CI 가 깨진다:
//   1. 이 파일 (EMBEDDED_ENV_KEYS)
//   2. .github/workflows/build-win.yml 의 `$required` 배열 + env 블록
//   3. scripts/ci-assert-embedded.mjs 의 REQUIRED_KEYS
const EMBEDDED_ENV_KEYS = [
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
  // 구독 게이트 (S2). 여기 있는 세 개는 전부 공개 정보다:
  //   ENTITLEMENT_PUBLIC_KEY  검증 전용 공개키. 이걸로는 토큰을 만들 수 없다.
  //   ENTITLEMENT_URL         Edge Function 주소.
  //   BILLING_PORTAL_URL      admin-web 결제 페이지 주소.
  // [HARD] ENTITLEMENT_PRIVATE_KEY 와 포트원 API Secret 은 절대 이 목록에
  // 추가하지 않는다. 여기 넣는 값은 빌드타임에 번들로 인라인된다.
  'ENTITLEMENT_PUBLIC_KEY',
  'ENTITLEMENT_URL',
  'BILLING_PORTAL_URL',
  // AI 프록시 Edge Function 들의 베이스 주소 (A1). 미설정이면 SUPABASE_URL 에서
  // 유도된다. 이것도 주소일 뿐이며 provider 키는 저쪽 끝에만 있다.
  'AI_PROXY_URL',
  // 기기 등록 Edge Function 주소 (S5). SUPABASE_URL 에서 유도되므로 보통은
  // 설정할 필요가 없다. 이것도 주소일 뿐 비밀이 아니다 -- 판정은 전부 서버가
  // service_role 로 하고, 이 함수는 caller 의 JWT 없이는 아무것도 하지 않는다.
  'DEVICE_FUNCTION_URL'
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
          patients: resolve(__dirname, 'src/renderer/patients/index.html'),
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
