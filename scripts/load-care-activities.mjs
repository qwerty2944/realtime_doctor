#!/usr/bin/env node
// 진료행위 정의 로더 (B1).
//
// `supabase/seed/care-activity-defs.csv` 를 읽어 `public.care_activity_defs` 에
// 넣는다. 항목을 추가·수정하는 사람이 코드를 만질 필요가 없게 하려는 것이
// 이 스크립트의 존재 이유다 — CSV 한 줄 추가하고 이 명령을 한 번 돌리면 끝이고,
// 앱 릴리스도, 마이그레이션도 필요 없다.
//
//   node scripts/load-care-activities.mjs                 # 로컬 스택
//   node scripts/load-care-activities.mjs --dry-run       # 검사만
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/load-care-activities.mjs
//
// [HARD] 이 스크립트는 무엇이든 'unreviewed' 로만 넣는다.
//   임상 검토 표시는 여기서 줄 수 없다. 규칙을 고친 기존 항목도 다시
//   'unreviewed' 로 내린다 — 규칙이 바뀌면 예전 검토는 그 규칙에 대한 검토가
//   아니기 때문이다. 검토 승격은 별도의 의도적인 행위(서비스 롤)로만 한다.
//
// [HARD] 문구 검사.
//   라벨/설명에 "청구", "수가" 같은 낱말이 들어오면 거부한다. 문구가 곧
//   책임 경계이고, 내부 식별자조차 언젠가 화면에 샌다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_WORDING } from './care-wording.mjs';

const CSV_PATH = fileURLToPath(
  new URL('../supabase/seed/care-activity-defs.csv', import.meta.url)
);

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:55321';
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const DRY_RUN = process.argv.includes('--dry-run');

/** RFC4180 최소 파서: 따옴표 안의 쉼표와 줄바꿈을 지킨다. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const REQUIRED_COLUMNS = [
  'code',
  'label_ko',
  'description_ko',
  'category',
  'specialty',
  'cue_terms',
  'negation_terms',
  'required_speaker',
  'min_distinct_cues',
  'min_utterances',
  'min_duration_seconds'
];

/** `단서1|단서2` → 배열. 비어 있으면 빈 배열. */
function splitList(value) {
  return value
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function intOf(value, fallback, label, problems) {
  if (value.trim() === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    problems.push(`${label}: 정수가 아님 ("${value}")`);
    return fallback;
  }
  return n;
}

function validate(record, problems) {
  const prefix = `[${record.code || '(code 없음)'}]`;
  if (!/^[a-z][a-z0-9_]*$/.test(record.code)) {
    problems.push(`${prefix} code 는 영문 소문자·숫자·밑줄만 쓴다`);
  }
  if (!record.label_ko.trim()) problems.push(`${prefix} label_ko 가 비어 있다`);
  // 문구 검사: 화면에 나갈 수 있는 모든 텍스트 + 식별자.
  for (const field of ['code', 'label_ko', 'description_ko', 'category']) {
    const text = record[field] ?? '';
    for (const word of FORBIDDEN_WORDING) {
      if (text.includes(word)) {
        problems.push(
          `${prefix} ${field} 에 "${word}" 가 들어 있다 — 이 제품은 행위 기록만 보여주고 청구를 권하지 않는다`
        );
      }
    }
  }
  if (record.cue_terms.length === 0) {
    problems.push(`${prefix} cue_terms 가 비어 있다 — 무엇이든 걸리는 규칙이 된다`);
  }
  if (record.min_distinct_cues > record.cue_terms.length) {
    problems.push(
      `${prefix} min_distinct_cues(${record.min_distinct_cues}) 가 단서 수(${record.cue_terms.length})보다 크다 — 절대 걸리지 않는다`
    );
  }
  if (!['doctor', 'patient', 'any'].includes(record.required_speaker)) {
    problems.push(`${prefix} required_speaker 는 doctor|patient|any 중 하나여야 한다`);
  }
  if (record.min_distinct_cues < 1 || record.min_utterances < 1) {
    problems.push(`${prefix} min_distinct_cues 와 min_utterances 는 1 이상이어야 한다`);
  }
}

async function rest(path, init = {}) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const main = async () => {
  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const header = rows[0].map((h) => h.trim());
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) throw new Error(`CSV 에 ${col} 열이 없다`);
  }

  const problems = [];
  const records = rows.slice(1).map((cells) => {
    const raw = Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
    const record = {
      code: raw.code,
      label_ko: raw.label_ko,
      description_ko: raw.description_ko,
      category: raw.category || null,
      specialty: raw.specialty || null,
      cue_terms: splitList(raw.cue_terms),
      negation_terms: splitList(raw.negation_terms),
      required_speaker: raw.required_speaker || 'any',
      min_distinct_cues: intOf(raw.min_distinct_cues, 2, `[${raw.code}] min_distinct_cues`, problems),
      min_utterances: intOf(raw.min_utterances, 2, `[${raw.code}] min_utterances`, problems),
      min_duration_seconds: intOf(
        raw.min_duration_seconds,
        0,
        `[${raw.code}] min_duration_seconds`,
        problems
      )
    };
    validate(record, problems);
    return record;
  });

  const seen = new Set();
  for (const r of records) {
    if (seen.has(r.code)) problems.push(`[${r.code}] code 가 중복된다`);
    seen.add(r.code);
  }

  if (problems.length > 0) {
    console.error('CSV 검사 실패 — 아무것도 저장하지 않았다:\n');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`CSV 검사 통과: ${records.length}건`);

  if (DRY_RUN) {
    console.log('--dry-run: 저장하지 않고 종료한다.');
    return;
  }

  const existing = await rest('care_activity_defs?select=code,rule_version');
  const byCode = new Map(existing.map((r) => [r.code, r]));

  let inserted = 0;
  let updated = 0;
  for (const record of records) {
    const prior = byCode.get(record.code);
    if (!prior) {
      await rest('care_activity_defs', {
        method: 'POST',
        body: JSON.stringify({
          ...record,
          // [HARD] 새 항목은 언제나 미검토다.
          clinical_review_status: 'unreviewed',
          rule_version: 1,
          source_label: 'CSV 시드 (임상 검토 전)'
        })
      });
      inserted += 1;
      continue;
    }
    // 규칙이 바뀌었으므로 예전 임상 검토는 무효다 — 다시 미검토로 내린다.
    await rest(`care_activity_defs?code=eq.${encodeURIComponent(record.code)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...record,
        clinical_review_status: 'unreviewed',
        reviewed_by: null,
        reviewed_at: null,
        rule_version: (prior.rule_version ?? 1) + 1
      })
    });
    updated += 1;
  }

  console.log(`저장 완료: 신규 ${inserted}건, 갱신 ${updated}건 (전부 임상 검토 전 상태)`);
  console.log(
    'CSV 에 없는 기존 항목은 건드리지 않는다. 내리려면 enabled=false 로 두고, 지우지는 않는다.'
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
