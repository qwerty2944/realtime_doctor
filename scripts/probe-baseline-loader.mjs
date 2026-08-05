// probe-baseline 전용 모듈 resolve 훅.
//
// 두 가지만 한다:
//   1. `electron` / `electron-store` 를 스텁으로 갈아끼운다.
//   2. TypeScript 소스가 쓰는 `./x.js` 확장자 지정을 실제 파일 `./x.ts` 로 되돌린다
//      (Node 의 타입 스트리핑은 specifier 를 다시 쓰지 않는다).
//
// 앱 코드는 한 줄도 고치지 않는다.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STUBS = new URL('./probe-baseline-stubs.mjs', import.meta.url).href;
const STORE_STUB = new URL('./probe-baseline-store-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: STUBS, shortCircuit: true };
  if (specifier === 'electron-store') return { url: STORE_STUB, shortCircuit: true };

  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return { url: candidate.href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

void pathToFileURL;
