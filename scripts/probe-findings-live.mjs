#!/usr/bin/env node
// E1 라이브 경로 프로브 — 실시간 분석이 실제 모델(Gemini)로 근거를 만들고,
// main 의 검증기가 그것을 실제 발화와 대조하는지 확인한다.
//
// 진짜 `src/main/analyzer.ts` 를 부른다. 프롬프트도 스키마도 앱이 쓰는 것 그대로다.
// 모델 호출이 1회 발생한다 (gemini-2.5-flash).
//
// 실행:
//   node --import ./scripts/probe-findings-register.mjs scripts/probe-findings-live.mjs

import { readFileSync } from 'node:fs';

// .env 를 직접 읽는다 (electron-vite 의 주입 경로 밖이므로).
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY 가 없다. 라이브 검증을 건너뛴다.');
  process.exit(2);
}

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

const CHUNKS = [
  { id: 'u-0', speaker: 'doctor', text: '어디가 불편해서 오셨어요?' },
  {
    id: 'u-1',
    speaker: 'patient',
    text: '어제 저녁부터 오른쪽 아랫배가 아프기 시작했는데 점점 심해져요.'
  },
  { id: 'u-2', speaker: 'doctor', text: '열이 나거나 토하지는 않으셨나요?' },
  {
    id: 'u-3',
    speaker: 'patient',
    text: '오늘 아침에 열이 38도까지 났고 두 번 토했어요. 입맛도 하나도 없습니다.'
  },
  { id: 'u-4', speaker: 'doctor', text: '배를 눌렀다 뗄 때 더 아프신가요?' },
  { id: 'u-5', speaker: 'patient', text: '네, 뗄 때 훨씬 아파요. 걸을 때도 울립니다.' }
];

const main = async () => {
  const { analyzer } = await import('../src/main/analyzer.ts');

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('분석 응답 없음 (60초)')), 60_000);
    analyzer.on((r) => {
      clearTimeout(timer);
      resolve(r);
    });
    for (const chunk of CHUNKS) analyzer.push({ ...chunk, timestamp: Date.now() });
    analyzer.runNow();
  });

  console.log('\n--- 실제 모델 응답 (검증 후) ---');
  for (const d of result.differentialDiagnoses) {
    console.log(`\n  ● ${d.name}${d.nameEn ? ` (${d.nameEn})` : ''}  ICD-10 ${d.icd10 ?? '-'}`);
    console.log(`    reasoning: ${d.reasoning}`);
    for (const f of d.supportingFindings ?? []) {
      console.log(`    - ${f.finding}`);
      console.log(`      source=${f.source} → utteranceId=${f.utteranceId}`);
      console.log(`      quote="${f.quote}"`);
    }
  }
  for (const u of result.unverifiedDiagnoses ?? []) {
    console.log(
      `\n  ○ [근거 미확인] ${u.diagnosis.name} reason=${u.reason} rejected=${JSON.stringify(u.rejectedSources)}`
    );
  }

  console.log('');
  check('감별진단이 반환됐다', result.differentialDiagnoses.length > 0);
  check(
    'confidence 필드가 응답 어디에도 없다',
    !JSON.stringify(result).includes('"confidence"')
  );
  check(
    '렌더 대상 진단은 전부 근거를 최소 1개 갖는다 (E1 검증 기준)',
    result.differentialDiagnoses.every((d) => (d.supportingFindings?.length ?? 0) > 0)
  );
  const byId = Object.fromEntries(CHUNKS.map((c) => [c.id, c.text]));
  const all = result.differentialDiagnoses.flatMap((d) => d.supportingFindings ?? []);
  check(
    '모든 근거의 utteranceId 가 실제 발화 id 다',
    all.every((f) => f.utteranceId in byId),
    `${all.length}건`
  );
  check(
    '모든 인용문이 원문과 글자 단위로 같다',
    all.every((f) => byId[f.utteranceId] === f.quote)
  );

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
