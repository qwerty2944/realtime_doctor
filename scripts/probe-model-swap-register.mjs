// probe-model-swap 로더 등록 진입점.
import { register } from 'node:module';
register('./probe-model-swap-loader.mjs', import.meta.url);
