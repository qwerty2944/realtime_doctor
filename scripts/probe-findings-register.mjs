// probe-findings 로더 등록 진입점. `node --import ./scripts/probe-findings-register.mjs ...`
import { register } from 'node:module';
register('./probe-findings-loader.mjs', import.meta.url);
