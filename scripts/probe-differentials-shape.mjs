#!/usr/bin/env node
// 감별진단 저장 형태 가드 (0018).
//
// 막으려는 실패
// -------------
// 미래의 writer 가 `intake_results.differentials_json` 에 여섯 번째 철자를
// 만들어 넣고 **아무도 눈치채지 못하는 것**. 눈치채지 못하는 이유는 구체적이다:
// `f_web_stats_diagnosis`(0014)는 모르는 철자를 에러로 만들지 않고 '미분류'
// 로 조용히 버킷팅한다. 차트는 그럴듯하고 숫자만 틀린다.
//
// 정규형 선언은 네 군데에 나뉘어 산다 — 하나로 합칠 수 없기 때문이다:
//   1. src/shared/differentials.ts                     (Electron, 기준점)
//   2. kiosk/lib/intake/schemas.ts                     (별도 배포되는 Next 앱)
//   3. supabase/migrations/0018_...sql                 (DB CHECK 제약)
//   4. supabase/migrations/0014_web_statistics.sql     (집계가 읽는 키)
// 이 스크립트가 넷을 묶는다. 어긋나면 non-zero 로 끝나고 빌드가 선다.
//
// 실행 (`npm run check:differentials` 가 이것을 부른다):
//   node --import ./scripts/probe-findings-register.mjs scripts/probe-differentials-shape.mjs
//
// 로더를 재사용하는 이유: 이 스크립트는 문자열을 grep 하는 대신 **진짜 모듈을
// 불러서 돌린다**. 정규식으로 스키마를 읽는 검사는 스키마가 아니라 정규식을
// 검사하게 된다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const {
  INTAKE_DIFFERENTIAL_KEYS,
  INTAKE_DIFFERENTIAL_NAME_KEY,
  INTAKE_DIFFERENTIAL_NAME_EN_KEY,
  LEGACY_INTAKE_DIFFERENTIAL_NAME_KEYS,
  LIVE_ANALYSIS_DIFFERENTIAL_KEYS,
  readIntakeDifferentialName,
  toIntakeDifferentials
} = await import('../src/shared/differentials.ts');

const CANON = [...INTAKE_DIFFERENTIAL_KEYS];

function canonicalItem(over = {}) {
  return {
    rank: 1,
    name_kr: '급성 폐쇄각 녹내장',
    name_en: 'acute angle-closure glaucoma',
    rationale: '안압 상승과 각막부종을 시사하는 발화가 있다.',
    supporting_findings: [{ finding: '눈이 갑자기 아프고 뿌옇다', source: '#1' }],
    ...over
  };
}
/** 스키마의 최소 길이(3)를 만족시키는 정규 배열. */
function canonicalArray(over = {}) {
  return [
    canonicalItem(over),
    canonicalItem({ rank: 2, name_kr: '백내장', name_en: 'cataract' }),
    canonicalItem({ rank: 3, name_kr: '건성안', name_en: 'dry eye disease' })
  ];
}

// ---------------------------------------------------------------------------
// 1. 기준점이 스스로 일관적인가
// ---------------------------------------------------------------------------
console.log('\n1. src/shared/differentials.ts');
check('정규 키 5개', CANON.length === 5, CANON.join(','));
check(
  '진단명 키가 정규 키 집합 안에 있다',
  CANON.includes(INTAKE_DIFFERENTIAL_NAME_KEY) &&
    CANON.includes(INTAKE_DIFFERENTIAL_NAME_EN_KEY)
);
check(
  '레거시 철자와 정규 키가 겹치지 않는다',
  !LEGACY_INTAKE_DIFFERENTIAL_NAME_KEYS.some((k) => CANON.includes(k)),
  LEGACY_INTAKE_DIFFERENTIAL_NAME_KEYS.join(',')
);
check(
  '실시간 분석 형태는 정규형과 진단명 키를 공유하지 않는다 (일부러 다른 산출물)',
  !LIVE_ANALYSIS_DIFFERENTIAL_KEYS.includes(INTAKE_DIFFERENTIAL_NAME_KEY)
);

// ---------------------------------------------------------------------------
// 2. 키오스크의 진짜 zod 스키마 — 유일한 writer
// ---------------------------------------------------------------------------
console.log('\n2. kiosk/lib/intake/schemas.ts (진짜 zod 스키마)');
const { differentialsJsonSchema } = await import(
  '../kiosk/lib/intake/schemas.ts'
);

check('정규 배열을 받는다', differentialsJsonSchema.safeParse(canonicalArray()).success);

for (const legacy of LEGACY_INTAKE_DIFFERENTIAL_NAME_KEYS) {
  // (a) 정규 키를 그 철자로 갈아끼운 경우 → 필수 키 누락으로 거절.
  const swapped = canonicalArray();
  swapped[0] = { ...canonicalItem() };
  delete swapped[0][INTAKE_DIFFERENTIAL_NAME_KEY];
  swapped[0][legacy] = '급성 폐쇄각 녹내장';
  check(
    `'${legacy}' 로 갈아끼운 행을 거절한다`,
    !differentialsJsonSchema.safeParse(swapped).success
  );

  // (b) 정규 키는 두고 그 철자를 **덧붙인** 경우 → strict 가 아니면 조용히
  //     버려진다. 여섯 번째 철자가 소리 없이 태어나는 경로가 정확히 이것이다.
  const extra = canonicalArray();
  extra[0] = { ...canonicalItem(), [legacy]: '급성 폐쇄각 녹내장' };
  check(
    `'${legacy}' 를 덧붙인 행을 거절한다 (조용히 버리지 않는다)`,
    !differentialsJsonSchema.safeParse(extra).success
  );
}

const invented = canonicalArray();
invented[0] = { ...canonicalItem(), dx_name: '급성 폐쇄각 녹내장' };
check(
  '아직 존재하지 않는 철자(dx_name)도 거절한다',
  !differentialsJsonSchema.safeParse(invented).success
);

// 스키마가 실제로 통과시키는 키 집합 == 기준점의 정규 키 집합.
const parsedKeys = Object.keys(
  differentialsJsonSchema.parse(canonicalArray())[0]
).sort();
check(
  'zod 가 내놓는 키 집합이 INTAKE_DIFFERENTIAL_KEYS 와 같다',
  JSON.stringify(parsedKeys) === JSON.stringify([...CANON].sort()),
  parsedKeys.join(',')
);

// ---------------------------------------------------------------------------
// 3. 진짜 reader — 정규 행과 구 표기 행
// ---------------------------------------------------------------------------
console.log('\n3. src/renderer/shared/patientMode.ts (진짜 매퍼)');
const { patientDifferentialsPartitioned } = await import(
  '../src/renderer/shared/patientMode.ts'
);

function detailWith(differentials) {
  return {
    patient: { id: 'p', name: '테스트', registrationNo: null, birthDate: null },
    encounter: {
      id: 'e',
      chiefComplaint: null,
      redFlag: false,
      redFlagReason: null
    },
    intakeResult: {
      id: 'r',
      encounterId: 'e',
      soap: {
        s: {},
        transcript: [
          { role: 'agent', text: '어떤 증상으로 오셨나요?' },
          { role: 'patient', text: '눈이 갑자기 아프고 뿌옇습니다.' }
        ]
      },
      differentials,
      recommendedTests: [],
      version: 1,
      createdAt: new Date().toISOString(),
      provenance: { recorded: false },
      factsFingerprint: null,
      derivedFromId: null,
      supersededAt: null
    }
  };
}

const fromCanonical = patientDifferentialsPartitioned(detailWith(canonicalArray()));
check(
  '정규 행 3건이 전부 근거 확인으로 올라온다',
  fromCanonical.supported.length === 3,
  `supported=${fromCanonical.supported.length} unverified=${fromCanonical.unverified.length}`
);
check(
  '정규 행의 진단명이 name_kr 이다',
  fromCanonical.supported[0]?.name === '급성 폐쇄각 녹내장',
  String(fromCanonical.supported[0]?.name)
);
check(
  '정규 행의 영문명이 name_en 이다',
  fromCanonical.supported[0]?.nameEn === 'acute angle-closure glaucoma'
);

// 구 표기 행 — 0018 이전에 저장됐을 수 있는 모양. 운영에는 0건이지만 읽기
// 경로가 살아 있다는 것을 여기서 증명한다.
const legacyRows = [
  {
    rank: 1,
    name: '급성 폐쇄각 녹내장',
    nameEn: 'acute angle-closure glaucoma',
    reasoning: '구 표기 행',
    supportingFindings: [{ finding: '눈이 갑자기 아프고 뿌옇다', source: '#1' }]
  }
];
const fromLegacy = patientDifferentialsPartitioned(detailWith(legacyRows));
check(
  '구 표기(camelCase) 행도 진단명을 잃지 않는다',
  fromLegacy.supported[0]?.name === '급성 폐쇄각 녹내장',
  String(fromLegacy.supported[0]?.name)
);
check(
  '구 표기 행의 근거도 그대로 검증된다 (supportingFindings)',
  (fromLegacy.supported[0]?.supportingFindings?.length ?? 0) === 1
);
check(
  '레거시 경로를 탄 사실이 값으로 드러난다',
  readIntakeDifferentialName(legacyRows[0])?.legacyKey === 'name',
  String(readIntakeDifferentialName(legacyRows[0])?.legacyKey)
);
check(
  '정규 행은 레거시 경로를 타지 않는다',
  readIntakeDifferentialName(canonicalItem())?.legacyKey === null
);

// ---------------------------------------------------------------------------
// 4. 다리 — 실시간 분석 결과를 정규형으로
// ---------------------------------------------------------------------------
console.log('\n4. toIntakeDifferentials (rederive 가 지나야 할 다리)');
const bridged = toIntakeDifferentials([
  {
    name: '급성 폐쇄각 녹내장',
    nameEn: 'acute angle-closure glaucoma',
    reasoning: '실시간 분석',
    supportingFindings: [{ finding: '눈이 갑자기 아프다', source: '#1' }]
  },
  { name: '백내장', reasoning: '영문명이 없는 경우' }
]);
check(
  '변환 결과가 DB 제약과 같은 키 집합을 갖는다',
  bridged.every(
    (item) => JSON.stringify(Object.keys(item).sort()) === JSON.stringify([...CANON].sort())
  ),
  Object.keys(bridged[0]).join(',')
);
check('rank 를 1부터 다시 매긴다', bridged[0].rank === 1 && bridged[1].rank === 2);
check(
  '영문명이 없으면 빈 문자열이 아니라 한국어명으로 채운다 (name_en 은 필수)',
  bridged[1].name_en === '백내장'
);

// ---------------------------------------------------------------------------
// 5. SQL — 제약과 집계가 같은 철자를 본다
// ---------------------------------------------------------------------------
// SQL 은 여기서 실행할 수 없으므로 텍스트로 대조한다. 대조 대상은 "정규 키가
// 전부 등장하는가"와 "레거시 철자가 허용목록에 새어 들어가지 않았는가" 두 가지다.
console.log('\n5. supabase/migrations (제약 · 집계)');
const sql0018 = readFileSync(
  join(REPO, 'supabase/migrations/0018_differentials_canonical_shape.sql'),
  'utf8'
);
const allowlistLine =
  sql0018.match(/\$\[\*\]\.keyvalue\(\) \? \(!\((.+?)\)\)/s)?.[1] ?? '';
const allowlisted = [...allowlistLine.matchAll(/@\.key == "([^"]+)"/g)].map((m) => m[1]);
check(
  '0018 의 키 허용목록이 INTAKE_DIFFERENTIAL_KEYS 와 정확히 같다',
  JSON.stringify([...allowlisted].sort()) === JSON.stringify([...CANON].sort()),
  allowlisted.join(',')
);
check(
  '0018 이 name_kr / name_en 을 필수로 강제한다',
  CANON.filter((k) => k.startsWith('name_')).every((k) =>
    sql0018.includes(`!(@.${k}.type() == "string")`)
  )
);
check(
  '0018 이 rederive 안에서 실시간 형태를 이름으로 거절한다',
  LIVE_ANALYSIS_DIFFERENTIAL_KEYS.filter((k) => k === 'name' || k === 'nameEn').every(
    (k) => sql0018.includes(`@.key == "${k}"`)
  )
);

const sql0014 = readFileSync(
  join(REPO, 'supabase/migrations/0014_web_statistics.sql'),
  'utf8'
);
const statsFn = sql0014.slice(
  sql0014.indexOf('function public.f_web_stats_diagnosis'),
  sql0014.indexOf("comment on function public.f_web_stats_diagnosis")
);
const statsKeys = [...statsFn.matchAll(/->>\s*'([a-zA-Z_]+)'/g)].map((m) => m[1]);
check(
  '0014 의 진단 집계가 정규 키만 읽는다',
  statsKeys.length > 0 && statsKeys.every((k) => CANON.includes(k)),
  statsKeys.join(',')
);
check(
  '0014 가 진단명으로 name_kr 을 가장 먼저 읽는다 (정규 키와 일치)',
  statsKeys[0] === INTAKE_DIFFERENTIAL_NAME_KEY,
  statsKeys[0]
);

console.log(
  failures === 0
    ? '\n감별진단 형태 가드: 통과.'
    : `\n감별진단 형태 가드: 실패 ${failures}건.`
);
process.exit(failures === 0 ? 0 : 1);
