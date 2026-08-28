// probe-model-swap 모듈 resolve 훅.
// probe-findings-loader 와 같은 일 + aiProxy 를 스텁으로 바꾼다.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STUBS = new URL('./probe-baseline-stubs.mjs', import.meta.url).href;
const STORE_STUB = new URL('./probe-baseline-store-stub.mjs', import.meta.url).href;
const AI_PROXY_STUB = new URL('./probe-model-swap-stub-aiproxy.mjs', import.meta.url).href;
const EMPTY = new URL('./probe-findings-empty.mjs', import.meta.url).href;

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js'];

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
  if (specifier === 'server-only') return { url: EMPTY, shortCircuit: true };
  if (specifier.endsWith('/aiProxy.js') || specifier.endsWith('/aiProxy')) {
    return { url: AI_PROXY_STUB, shortCircuit: true };
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
