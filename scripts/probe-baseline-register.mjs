// probe-baseline 로더 등록 진입점. `node --import ./scripts/probe-baseline-register.mjs ...`
import { register } from 'node:module';
register('./probe-baseline-loader.mjs', import.meta.url);
