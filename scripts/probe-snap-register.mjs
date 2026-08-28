// probe-snap 로더 등록 진입점. `node --import ./scripts/probe-snap-register.mjs ...`
import { register } from 'node:module';
register('./probe-snap-loader.mjs', import.meta.url);
