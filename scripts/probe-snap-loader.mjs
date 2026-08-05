// probe-snap 전용 모듈 resolve 훅 (probe-baseline-loader 와 같은 패턴).
// electron / electron-store 만 스텁으로 바꾸고, TS 소스의 './x.js' 지정을
// 실제 파일 './x.ts' 로 되돌린다. 앱 코드는 한 줄도 고치지 않는다.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STUBS = new URL('./probe-snap-stubs.mjs', import.meta.url).href;
const STORE_STUB = new URL('./probe-snap-store-stub.mjs', import.meta.url).href;

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
