// probe-findings 전용 모듈 resolve 훅.
//
// probe-baseline-loader 와 같은 일(electron/electron-store 스텁, `./x.js` → `./x.ts`)을
// 하고 두 가지를 더 한다:
//   1. 확장자 없는 상대 경로(`../../shared/findings`)를 `.ts` 로 붙여준다 —
//      renderer 쪽 소스는 번들러 규칙으로 확장자를 생략한다.
//   2. 키오스크의 `@/` 별칭을 kiosk 디렉토리로 보낸다 — 키오스크의 진짜
//      검증 코드(lib/intake/result.ts)를 그대로 부르기 위해서다.
//
// 앱 코드는 한 줄도 고치지 않는다.

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STUBS = new URL('./probe-baseline-stubs.mjs', import.meta.url).href;
const STORE_STUB = new URL('./probe-baseline-store-stub.mjs', import.meta.url).href;
const KIOSK_ROOT = new URL('../kiosk/', import.meta.url);
const EMPTY = new URL('./probe-findings-empty.mjs', import.meta.url).href;

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js'];

function isFile(url) {
  const path = fileURLToPath(url);
  return existsSync(path) && statSync(path).isFile();
}

function firstExisting(base) {
  for (const ext of EXTENSIONS) {
    const candidate = new URL(base.href + ext);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  const index = new URL(base.href + '/index.ts');
  if (existsSync(fileURLToPath(index))) return index;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: STUBS, shortCircuit: true };
  if (specifier === 'electron-store') return { url: STORE_STUB, shortCircuit: true };
  // Next 런타임 전용 가드. 프로브는 Next 밖에서 도므로 무해한 빈 모듈로 바꾼다.
  if (specifier === 'server-only') return { url: EMPTY, shortCircuit: true };

  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), KIOSK_ROOT);
    const hit = isFile(base) ? base : firstExisting(base);
    if (hit) return { url: hit.href, shortCircuit: true };
  }

  if (specifier.startsWith('.') && context.parentURL) {
    if (specifier.endsWith('.js')) {
      const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    } else if (!/\.[a-z]+$/i.test(specifier)) {
      const hit = firstExisting(new URL(specifier, context.parentURL));
      if (hit) return { url: hit.href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
