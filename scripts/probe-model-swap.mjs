#!/usr/bin/env node
// 모델 교체 검증 프로브 (A1 / E1).
//
// gemini-2.5-flash 와 gemini-3.5-flash-lite 를 **같은 입력**으로 돌려
// `src/main/analyzer.ts` 의 실제 경로(프롬프트/스키마/검증기 그대로)를 태우고,
// `src/shared/findings.ts` 의 partitionDifferentials 결과를 비교한다.
//
// 측정하는 것은 성능이 아니라 **스키마 준수**다: 감별진단마다
// supporting_findings 가 실제 발화 번호를 가리키는가. 그것이 무너지면 화면은
// 전부 "근거 미확인"이 된다.
//
// 실행:
//   node --import ./scripts/probe-model-swap-register.mjs scripts/probe-model-swap.mjs

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY 없음.');
  process.exit(2);
}

const MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash-lite'];

// 현실적인 한국어 진료 대화. 근거로 인용될 만한 구체 사실을 여러 발화에 흩뿌린다.
const CHUNKS = [
  { id: 'u-0', speaker: 'doctor', text: '어디가 불편해서 오셨어요?' },
  { id: 'u-1', speaker: 'patient', text: '한 사흘 전부터 가슴 가운데가 뻐근하게 조이는 느낌이 있어요.' },
  { id: 'u-2', speaker: 'doctor', text: '어떤 상황에서 더 심해지시나요?' },
  { id: 'u-3', speaker: 'patient', text: '계단을 두세 층 올라가면 꼭 그래요. 쉬면 한 오 분 안에 가라앉습니다.' },
  { id: 'u-4', speaker: 'doctor', text: '통증이 다른 곳으로 뻗치는 느낌은 없으세요?' },
  { id: 'u-5', speaker: 'patient', text: '왼쪽 어깨하고 턱 쪽으로 좀 당기는 것 같아요. 식은땀도 같이 납니다.' },
  { id: 'u-6', speaker: 'doctor', text: '숨이 차거나 두근거리지는 않으신가요?' },
  { id: 'u-7', speaker: 'patient', text: '올라갈 때 숨이 많이 차요. 누워 있을 때는 괜찮습니다.' },
  { id: 'u-8', speaker: 'doctor', text: '평소 앓고 계신 병이나 드시는 약이 있으신가요?' },
  { id: 'u-9', speaker: 'patient', text: '고혈압 약을 오 년째 먹고 있고, 당뇨는 재작년에 진단받았어요.' },
  { id: 'u-10', speaker: 'doctor', text: '담배는 피우시나요?' },
  { id: 'u-11', speaker: 'patient', text: '하루 한 갑씩 이십 년 넘게 피웠습니다. 지금도 피워요.' },
  { id: 'u-12', speaker: 'doctor', text: '가족 중에 심장병 앓으신 분 계세요?' },
  { id: 'u-13', speaker: 'patient', text: '아버지가 예순에 심근경색으로 돌아가셨어요.' },
  { id: 'u-14', speaker: 'doctor', text: '속쓰림이나 신물이 올라오는 증상은 어떠세요?' },
  { id: 'u-15', speaker: 'patient', text: '가끔 밤에 신물이 올라오긴 하는데 이번 가슴 통증하고는 다른 느낌이에요.' }
];

// ── 로컬 릴레이. 앱은 여기로 보내고, 여기서 키를 붙여 Google 로 보낸다.
//    Authorization(더미 토큰)은 떼어낸다. 호출 횟수와 원문 응답을 기록한다.
const captured = new Map(); // model -> { body, status, calls }
let currentModel = null;

const relay = createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', async () => {
    const m = /^\/models\/([^/]+):generateContent$/.exec(req.url);
    if (!m) {
      res.writeHead(404).end('{}');
      return;
    }
    const model = decodeURIComponent(m[1]);
    const slot = captured.get(model) ?? { calls: 0 };
    slot.calls += 1;
    captured.set(model, slot);
    const up = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
        body: raw
      }
    );
    const text = await up.text();
    slot.body = text;
    slot.status = up.status;
    res.writeHead(up.status, { 'Content-Type': 'application/json' }).end(text);
  });
});
await new Promise((r) => relay.listen(0, '127.0.0.1', r));
process.env.GEMINI_API_BASE = `http://127.0.0.1:${relay.address().port}`;

const { analyzer } = await import('../src/main/analyzer.ts');
const { partitionDifferentials } = await import('../src/shared/findings.ts');

const UTTERANCES = CHUNKS.map((c) => ({ id: c.id, text: c.text }));
const byId = new Map(UTTERANCES.map((u) => [u.id, u.text]));

function extract(bodyText) {
  const j = JSON.parse(bodyText);
  const parts = j?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('');
}

const summary = [];

for (const model of MODELS) {
  process.env.GEMINI_ANALYZER_MODEL = model;
  analyzer.reset();

  console.log(`\n${'='.repeat(74)}\n모델: ${model}\n${'='.repeat(74)}`);

  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('60초 내 응답 없음')), 60_000);
    const off = analyzer.on((r) => {
      clearTimeout(timer);
      off();
      resolve(r);
    });
    for (const c of CHUNKS) analyzer.push({ ...c, timestamp: Date.now() });
    analyzer.runNow();
  });
  const elapsed = Date.now() - started;

  // ── 검증 **이전**의 원시 응답 (릴레이가 잡아둔 업스트림 본문 그대로)
  const rawText = extract(captured.get(model).body);
  const rawParsed = JSON.parse(rawText);
  const rawDiffs = rawParsed.differentialDiagnoses ?? [];

  console.log('\n--- 원시 differentials (모델이 돌려준 그대로, 검증 전) ---');
  for (const d of rawDiffs) {
    console.log(`\n  ● ${d.name} / ${d.nameEn} [${d.icd10}]`);
    console.log(`    reasoning: ${d.reasoning}`);
    if (!d.supportingFindings?.length) console.log('    supportingFindings: []');
    for (const f of d.supportingFindings ?? []) {
      console.log(`    - finding: ${f.finding}`);
      console.log(`      source: ${JSON.stringify(f.source)}`);
    }
  }

  // ── 앱 자신의 검증기를 원시 응답에 그대로 돌린다.
  const part = partitionDifferentials(
    rawDiffs.map((d) => {
      const { supportingFindings, ...rest } = d;
      return { ...rest, rawFindings: supportingFindings };
    }),
    UTTERANCES
  );

  const totalFindingsRaw = rawDiffs.reduce((n, d) => n + (d.supportingFindings?.length ?? 0), 0);
  const totalResolved = part.supported.reduce((n, d) => n + d.supportingFindings.length, 0);

  // ── 인용문이 입력 원문과 글자 그대로 같은가.
  let verbatim = 0;
  let notVerbatim = 0;
  for (const d of part.supported) {
    for (const f of d.supportingFindings) {
      if (byId.get(f.utteranceId) === f.quote) verbatim += 1;
      else notVerbatim += 1;
    }
  }

  console.log('\n--- partitionDifferentials 결과 ---');
  for (const d of part.supported) {
    console.log(`\n  ✓ ${d.name} — 근거 ${d.supportingFindings.length}개`);
    for (const f of d.supportingFindings) {
      console.log(`      source=${f.source} → ${f.utteranceId}  quote="${f.quote}"`);
      console.log(`      원문 일치: ${byId.get(f.utteranceId) === f.quote ? 'YES(verbatim)' : 'NO'}`);
    }
  }
  for (const u of part.unverified) {
    console.log(`\n  ✗ [근거 미확인] ${u.diagnosis.name} reason=${u.reason} rejected=${JSON.stringify(u.rejectedSources)}`);
  }

  const row = {
    model,
    ms: elapsed,
    calls: captured.get(model).calls,
    diffs: rawDiffs.length,
    rawFindings: totalFindingsRaw,
    supported: part.supported.length,
    unverified: part.unverified.length,
    resolvedFindings: totalResolved,
    verbatim,
    notVerbatim,
    medicalTerms: (rawParsed.medicalTerms ?? []).length,
    questions: (rawParsed.suggestedQuestions ?? []).length,
    redFlags: (rawParsed.redFlags ?? []).length,
    // analyzer 가 붙인 출처 (E3)
    provenanceModel: result.provenance?.model,
    liveSupported: result.differentialDiagnoses.length,
    liveUnverified: (result.unverifiedDiagnoses ?? []).length,
    hasConfidence: JSON.stringify(result).includes('"confidence"')
  };
  summary.push(row);
  console.log(`\n  provenance.model = ${row.provenanceModel}`);
  console.log(`  analyzer 라이브 결과: supported=${row.liveSupported} unverified=${row.liveUnverified}`);
}

relay.close();

console.log(`\n${'='.repeat(74)}\n비교표\n${'='.repeat(74)}`);
console.table(summary);

const [base, next] = summary;
let fail = 0;
const check = (label, cond, detail) => {
  if (!cond) fail += 1;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
};
console.log('');
check('신모델이 감별진단을 반환했다', next.diffs > 0, `${next.diffs}건`);
check('신모델의 근거 미확인 = 0', next.unverified === 0, `${next.unverified}건`);
check(
  '신모델의 근거 해석률이 구모델 이상',
  next.rawFindings > 0 && next.resolvedFindings / next.rawFindings >= base.resolvedFindings / Math.max(1, base.rawFindings),
  `${next.resolvedFindings}/${next.rawFindings} vs ${base.resolvedFindings}/${base.rawFindings}`
);
check('신모델 인용문이 전부 원문 그대로', next.notVerbatim === 0, `verbatim=${next.verbatim} 불일치=${next.notVerbatim}`);
check('confidence 필드 없음', !next.hasConfidence);
check('provenance.model 이 실제 사용 모델', next.provenanceModel === 'gemini-3.5-flash-lite', String(next.provenanceModel));

console.log(fail === 0 ? '\n모델 교체 안전.' : `\n${fail}건 실패 — 교체 보류.`);
process.exit(fail === 0 ? 0 : 1);
