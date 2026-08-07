#!/usr/bin/env node
/**
 * 빌드 가드. npm `prebuild` 로 자동 실행되므로 로컬 `npm run build` 와 Vercel
 * 배포 양쪽에서 반드시 지나간다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 무엇을 막는가
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Vercel Cron 은 프로젝트 환경변수 이름이 **정확히 `CRON_SECRET`** 일 때만
 * 스케줄 호출에 `Authorization: Bearer <값>` 을 붙인다. `/api/billing/watchdog`
 * 이 다른 이름(`BILLING_` + `CRON_SECRET`)을 기대하도록 되돌아가면 크론은 매
 * 실행 401 을 받고, 그 라우트는 실행 기록을 인증 **이후에** 쓰므로
 * `subscription_watchdog_runs` 가 영원히 비어 있게 된다. 즉 증상이 "아무 일도
 * 일어나지 않음"이고, 그건 이 잡이 탐지하려는 조용한 과금 중단과 DB 상에서
 * 완전히 같은 모습이다.
 *
 * 그 되돌림이 코드 리뷰에서 눈에 띄리라고 기대하지 않는다. 환경변수 이름 하나는
 * 한 줄짜리 변경이고 테스트도 타입도 깨뜨리지 않는다. 그래서 빌드를 깨뜨린다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 이 스크립트 자체가 그 문자열을 담지 않는 이유
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 담으면 자기 자신을 잡는다. 조각을 합쳐서 만든다. lib/env.ts 도 같은 이유로
 * 조각으로 만들어 두었고(LEGACY_CRON_SECRET_ENV), 그래서 예외 목록이 필요 없다 --
 * 예외 목록은 언젠가 "일단 여기 추가"로 무력화되는 종류의 장치다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const FORBIDDEN = ['BILLING', 'CRON', 'SECRET'].join('_');
const REQUIRED = 'CRON_SECRET';
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.vercel']);
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.json'];

/** @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const offenders = [];
let watchdogReadsRequired = false;

for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  if (text.includes(FORBIDDEN)) {
    const line = text.split('\n').findIndex((l) => l.includes(FORBIDDEN)) + 1;
    offenders.push(`${relative(ROOT, file)}:${line}`);
  }
  if (file.endsWith(join('watchdog', 'route.ts')) && text.includes('CRON_SECRET_ENV')) {
    watchdogReadsRequired = true;
  }
}

const problems = [];

if (offenders.length > 0) {
  problems.push(
    `금지된 환경변수 이름 ${FORBIDDEN} 이 소스에 남아 있습니다:\n` +
      offenders.map((o) => `    ${o}`).join('\n') +
      `\n  Vercel Cron 은 ${REQUIRED} 라는 이름에만 Bearer 를 붙입니다. ` +
      `lib/env.ts 의 CRON_SECRET_ENV 를 쓰세요.`,
  );
}

// 반대 방향도 본다. 위 검사만 있으면 watchdog 이 인증 자체를 없애 버리는
// 변경(그러면 금지 문자열도 사라진다)을 통과시킨다.
if (!watchdogReadsRequired) {
  problems.push(
    'app/api/billing/watchdog/route.ts 가 lib/env.ts 의 CRON_SECRET_ENV 를 참조하지 않습니다.\n' +
      '  크론 인증이 사라졌거나 이름이 하드코딩됐습니다. 둘 다 되돌려야 합니다.',
  );
}

// ---------------------------------------------------------------------------
// 크론 경로가 basePath 를 포함하는가
// ---------------------------------------------------------------------------
// 같은 실패의 다른 얼굴. Vercel Cron 은 배포물의 URL 경로를 그대로 치므로,
// basePath 를 켜 놓고 vercel.json 에 접두사 없는 경로를 적으면 매 실행 404 가
// 된다. 404 는 라우트 코드에 닿기 전이라 실행 기록도 남지 않는다 -- 시크릿
// 이름이 틀렸을 때와 증상이 완전히 같다. 그래서 같은 가드에서 함께 본다.
{
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim().replace(/\/+$/, '');
  const vercelJsonPath = join(ROOT, 'vercel.json');
  let crons = [];
  try {
    crons = JSON.parse(readFileSync(vercelJsonPath, 'utf8')).crons ?? [];
  } catch (err) {
    problems.push(`vercel.json 을 읽지 못했습니다: ${err.message}`);
  }

  for (const cron of crons) {
    const path = cron.path ?? '';
    if (basePath && !path.startsWith(`${basePath}/`)) {
      problems.push(
        `vercel.json 의 cron path "${path}" 가 basePath "${basePath}" 로 시작하지 않습니다.\n` +
          '  Vercel Cron 은 이 경로를 그대로 칩니다. 접두사가 빠지면 매 실행 404 이고,\n' +
          '  404 는 라우트에 닿기 전이라 실행 기록조차 남지 않습니다.',
      );
      continue;
    }
    // 접두사를 벗긴 경로에 실제 라우트 파일이 있는가. 경로 오타는 위 검사를
    // 통과하면서도 똑같이 404 를 만든다.
    const rel = basePath ? path.slice(basePath.length) : path;
    const routeFile = join(ROOT, 'app', rel.replace(/^\//, ''), 'route.ts');
    try {
      statSync(routeFile);
    } catch {
      problems.push(
        `vercel.json 의 cron path "${path}" 에 대응하는 라우트가 없습니다: ` +
          `${relative(ROOT, routeFile)}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error('\n[admin-web] 빌드 가드 실패\n');
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(`[admin-web] 빌드 가드 통과: 크론 시크릿 이름은 ${REQUIRED} 하나뿐입니다.`);
