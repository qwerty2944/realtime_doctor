import { useQuery } from '@tanstack/react-query';
import type {
  DifferentialDiagnosis,
  MedicalTerm,
  PatientDetail,
  Speaker,
  SuggestedQuestion,
  SummaryResult
} from '../../shared/types';
import {
  partitionDifferentials,
  type DifferentialWithRawFindings,
  type PartitionResult,
  type SourceUtterance
} from '../../shared/findings';
import { readIntakeDifferentialName } from '../../shared/differentials';
import type { TKey } from './i18n';

/**
 * 환자 모드.
 *
 * 대기목록에서 환자를 고르면 기존 오버레이 창들이 실시간 녹취 대신 그 환자의
 * 문진 결과를 보여준다. 실시간 캐시(ANALYSIS_KEY 등)를 덮어쓰지 않고 **별도 키**에
 * 담는다 — 녹음 중에 환자를 눌러도 진행 중인 분석 상태가 파괴되지 않아야 하고,
 * 선택 해제 시 재분석 없이 즉시 실시간 화면으로 돌아와야 하기 때문이다.
 * 각 창은 이 키에 값이 있으면 그것을 우선한다.
 *
 * 문진 JSON 의 스키마는 키오스크(별도 앱)가 소유하므로 여기서는 전부 방어적으로
 * 파싱하고, 없는 필드는 렌더링하지 않는다 ("undefined" 가 화면에 뜨지 않도록).
 */

export const PATIENT_KEY = ['active-patient'] as const;

export function usePatientDetail(): PatientDetail | null {
  const { data } = useQuery<PatientDetail | null>({
    queryKey: PATIENT_KEY,
    queryFn: () => null
  });
  return data ?? null;
}

// ── 문진 JSON 방어적 파서 ───────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 여러 후보 키 중 처음으로 문자열이 있는 것. 키오스크 스키마 변주 흡수용. */
function pickText(
  source: Record<string, unknown> | null,
  ...keys: string[]
): string | null {
  if (!source) return null;
  for (const key of keys) {
    const text = asText(source[key]);
    if (text) return text;
  }
  return null;
}

function soapOf(detail: PatientDetail): Record<string, unknown> | null {
  return asRecord(detail.intakeResult?.soap);
}

function subjectiveOf(detail: PatientDetail): Record<string, unknown> | null {
  const soap = soapOf(detail);
  return asRecord(soap?.s) ?? asRecord(soap?.subjective);
}

/** 문진 대화 한 턴 — 트랜스크립트 창이 실시간 발화와 같은 모양으로 그린다. */
export interface IntakeDialogueTurn {
  id: string;
  /** 실시간 발화와 같은 색/아이콘을 쓰기 위한 매핑값. */
  speaker: Speaker;
  /** 화자 라벨. 문진 진행자는 의사가 아니라 키오스크 AI 라서 별도 라벨을 쓴다. */
  labelKey: TKey;
  text: string;
}

/** 문진 진행자로 볼 role 값들. 키오스크 스키마 변주 흡수용. */
const AGENT_ROLES = new Set([
  'agent',
  'assistant',
  'interviewer',
  'ai',
  'bot',
  'system',
  'doctor',
  'clinician'
]);
const PATIENT_ROLES = new Set(['patient', 'user', 'human']);

/**
 * 키오스크가 저장한 문진 대화(`soap_json.transcript`).
 *
 * 스키마 소유자가 키오스크라 방어적으로 읽는다: role/speaker, text/content 변주를
 * 받고, 문자열만 든 배열도 받는다(그 경우 화자를 알 수 없으므로 unknown).
 * 쓸 수 없는 항목은 "undefined" 를 그리지 않도록 그냥 버린다.
 */
export function patientTranscript(detail: PatientDetail): IntakeDialogueTurn[] {
  const soap = soapOf(detail);
  const raw = soap?.transcript ?? soap?.dialogue ?? soap?.turns;
  if (!Array.isArray(raw)) return [];

  const turns: IntakeDialogueTurn[] = [];
  raw.forEach((entry, index) => {
    const plain = asText(entry);
    if (plain) {
      turns.push({
        id: `intake-${index}`,
        speaker: 'unknown',
        labelKey: 'transcript.speakerUnknown',
        text: plain
      });
      return;
    }
    const row = asRecord(entry);
    const text = pickText(row, 'text', 'content', 'message', 'utterance');
    if (!text) return;
    const role = (pickText(row, 'role', 'speaker', 'author') ?? '').toLowerCase();
    if (PATIENT_ROLES.has(role)) {
      turns.push({
        id: `intake-${index}`,
        speaker: 'patient',
        labelKey: 'transcript.speakerPatient',
        text
      });
      return;
    }
    if (AGENT_ROLES.has(role)) {
      turns.push({
        id: `intake-${index}`,
        speaker: 'doctor',
        labelKey: 'patient.speakerIntakeAgent',
        text
      });
      return;
    }
    turns.push({
      id: `intake-${index}`,
      speaker: 'unknown',
      labelKey: 'transcript.speakerUnknown',
      text
    });
  });
  return turns;
}

/**
 * 근거 검증용 발화 목록 (E1).
 *
 * **원본 배열의 인덱스를 그대로 보존한다.** `patientTranscript` 는 읽을 수 없는
 * 줄을 건너뛰므로 그 결과의 위치는 키오스크 프롬프트가 매긴 번호와 어긋날 수
 * 있고, 그러면 근거가 옆 발화를 가리킨다. 읽을 수 없는 줄은 빈 텍스트로
 * 자리만 채우고, 검증기가 그것을 인용 불가로 거절한다.
 */
export function patientTranscriptSources(
  detail: PatientDetail
): SourceUtterance[] {
  const soap = soapOf(detail);
  const raw = soap?.transcript ?? soap?.dialogue ?? soap?.turns;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => ({
    id: `intake-${index}`,
    text:
      asText(entry) ??
      pickText(asRecord(entry), 'text', 'content', 'message', 'utterance') ??
      ''
  }));
}

/** 대화 기록이 없는 옛 문진 레코드용 폴백 — SOAP 의 S 서술. 대화가 아니다. */
export interface IntakeNarrativeItem {
  labelKey: TKey;
  body: string;
}

export function patientHistoryFallback(
  detail: PatientDetail
): IntakeNarrativeItem[] {
  const s = subjectiveOf(detail);
  const soap = soapOf(detail);
  const items: IntakeNarrativeItem[] = [];

  const push = (labelKey: TKey, body: string | null): void => {
    if (body) items.push({ labelKey, body });
  };

  push('summary.chiefComplaint', pickText(s, 'chief_complaint', 'chiefComplaint'));
  push('summary.hpi', pickText(s, 'hpi', 'history'));
  push('patient.pmh', pickText(s, 'pmh', 'past_history'));
  push('patient.medications', pickText(s, 'medications', 'meds'));
  push('patient.allergies', pickText(s, 'allergies', 'allergy'));
  // S 가 통째로 문자열인 변주도 있어서 fallback 을 둔다.
  if (items.length === 0) {
    push('patient.intake', asText(soap?.s) ?? asText(soap?.subjective));
  }
  return items;
}

/**
 * 문진 감별진단 → 기존 DifferentialDiagnosis 형태 + 근거 검증 (E1).
 *
 * 실시간 분석과 **같은 검증기**(`src/shared/findings.ts`)를 쓴다. 근거의
 * `source` 는 `soap_json.transcript` 의 발화 번호이고, 그 번호가 실제 대화에
 * 없으면 근거를 버린다. 근거가 하나도 안 남은 진단은 `unverified` 로 빠진다 —
 * 구버전 문진 기록(근거 필드 자체가 없던 시절)이 통째로 여기 들어온다.
 * 그것이 정확하다: 그 기록에는 검증 가능한 근거가 실제로 없다.
 */
export function patientDifferentialsPartitioned(
  detail: PatientDetail
): PartitionResult {
  const rows = detail.intakeResult?.differentials ?? [];
  const mapped: DifferentialWithRawFindings[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    // 정규 키는 `name_kr` 하나다. 다섯 철자를 더듬던 자리를 여기로 접었다 —
    // 어떤 철자를 받아줄지는 `src/shared/differentials.ts` 한 곳에만 적혀 있다.
    const read = readIntakeDifferentialName(row);
    if (!read) continue;
    if (read.legacyKey) {
      // 0018 의 CHECK 제약 이후로는 새 행이 여기 올 수 없다. 그래도 왔다면
      // 제약보다 오래된 행이라는 뜻이므로 눈에 띄게 남긴다.
      console.warn(
        `[patientMode] 구 표기 감별진단 행: 진단명을 '${read.legacyKey}' 에서 읽었다 (정규 키는 name_kr).`
      );
    }
    const { name, nameEn } = read;
    const icd10 = pickText(row, 'icd10', 'icd_10');
    mapped.push({
      name,
      // 한글명과 영문명이 같으면 괄호 중복 표기를 만들지 않는다.
      ...(nameEn && nameEn !== name ? { nameEn } : {}),
      ...(icd10 ? { icd10 } : {}),
      reasoning: pickText(row, 'rationale', 'reasoning', 'reason') ?? '',
      rawFindings: row.supporting_findings ?? row.supportingFindings
    });
  }
  // 검증 대상은 환자가 실제로 말한 대화다.
  return partitionDifferentials(mapped, patientTranscriptSources(detail));
}

/** 근거가 확인된 감별진단만. 창이 정상 목록으로 그리는 것. */
export function patientDifferentials(
  detail: PatientDetail
): DifferentialDiagnosis[] {
  return patientDifferentialsPartitioned(detail).supported;
}

/** HPI + 과거력/복용약/알레르기. 라벨 번역기가 없으면 HPI 만 반환한다. */
function historyBlock(
  detail: PatientDetail,
  t?: (key: TKey) => string
): string {
  const s = subjectiveOf(detail);
  const soap = soapOf(detail);
  // 키오스크는 S 를 통째로 한 문자열로 쓰는 변주도 있다.
  const hpi =
    pickText(s, 'hpi', 'history') ??
    asText(soap?.s) ??
    asText(soap?.subjective) ??
    '';
  if (!t) return hpi;

  const extras: string[] = [];
  const add = (labelKey: TKey, body: string | null): void => {
    if (body) extras.push(`${t(labelKey)}: ${body}`);
  };
  add('patient.pmh', pickText(s, 'pmh', 'past_history'));
  add('patient.medications', pickText(s, 'medications', 'meds'));
  add('patient.allergies', pickText(s, 'allergies', 'allergy'));
  if (extras.length === 0) return hpi;
  return hpi ? `${hpi}\n\n${extras.join('\n')}` : extras.join('\n');
}

/** 문진 추천검사 — 요약 창의 "검사" 섹션에 문장으로 합쳐 넣는다. */
function recommendedTestsText(detail: PatientDetail): string {
  const rows = detail.intakeResult?.recommendedTests ?? [];
  const lines: string[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const name = pickText(row, 'name_kr', 'nameKr', 'name', 'code');
    if (!name) continue;
    const reason = pickText(row, 'reason', 'rationale');
    lines.push(reason ? `${name} — ${reason}` : name);
  }
  return lines.join('\n');
}

/**
 * 문진 SOAP → 요약 창이 그대로 쓰는 SummaryResult.
 *
 * 과거력/복용약/알레르기는 예전에 트랜스크립트 창이 그렸지만 그 자리는 이제 문진
 * 대화가 쓴다. SummaryResult 는 실시간 요약과 공유하는 타입이라 필드를 늘리지 않고
 * HPI 블록 아래에 라벨을 붙여 이어 붙인다 — 어느 창에도 안 남는 것보다 낫고,
 * 요약 창 한 곳에만 있으므로 중복도 아니다.
 */
export function patientSummary(
  detail: PatientDetail,
  t?: (key: TKey) => string
): SummaryResult | null {
  const result = detail.intakeResult;
  if (!result) return null;
  const soap = soapOf(detail);
  const s = subjectiveOf(detail);
  const summary: SummaryResult = {
    chiefComplaint:
      pickText(s, 'chief_complaint', 'chiefComplaint') ??
      detail.encounter.chiefComplaint ??
      '',
    // 키오스크는 S 를 통째로 한 문자열로 쓴다. 트랜스크립트 창이 대화를
    // 보여주게 되면서 그 서술을 그릴 창이 여기밖에 남지 않아 HPI 자리에 싣는다.
    historyOfPresentIllness: historyBlock(detail, t),
    pertinentFindings: pickText(soap, 'o', 'objective') ?? '',
    investigationsMentioned: recommendedTestsText(detail),
    clinicalImpression: pickText(soap, 'a', 'assessment') ?? '',
    plan: pickText(soap, 'p', 'plan') ?? '',
    generatedAt: new Date(result.createdAt).getTime()
  };
  const hasAny = Object.values(summary).some(
    (v) => typeof v === 'string' && v.length > 0
  );
  return hasAny ? summary : null;
}

/**
 * 문진이 추천 질문을 실어 보낸 경우에만 반환. 없으면 빈 배열 —
 * 이때 창은 실시간 데이터가 아니라 "해당 데이터 없음" 을 보여야 한다.
 */
export function patientQuestions(detail: PatientDetail): SuggestedQuestion[] {
  const soap = soapOf(detail);
  const candidates =
    soap?.follow_up_questions ?? soap?.followUpQuestions ?? soap?.questions;
  if (!Array.isArray(candidates)) return [];
  const out: SuggestedQuestion[] = [];
  for (const raw of candidates) {
    const text = asText(raw);
    if (text) {
      out.push({ question: text, rationale: '' });
      continue;
    }
    const row = asRecord(raw);
    const question = pickText(row, 'question', 'text');
    if (!question) continue;
    out.push({
      question,
      rationale: pickText(row, 'rationale', 'reason') ?? ''
    });
  }
  return out;
}

/** 문진 데이터에 의학용어가 실려 있으면 반환. 없으면 빈 배열. */
export function patientTerms(detail: PatientDetail): MedicalTerm[] {
  const soap = soapOf(detail);
  const candidates = soap?.medical_terms ?? soap?.medicalTerms ?? soap?.terms;
  if (!Array.isArray(candidates)) return [];
  const out: MedicalTerm[] = [];
  for (const raw of candidates) {
    const row = asRecord(raw);
    const term = pickText(row, 'term', 'name');
    if (!term) continue;
    const termEn = pickText(row, 'term_en', 'termEn');
    out.push({
      term,
      ...(termEn ? { termEn } : {}),
      definition: pickText(row, 'definition', 'description') ?? ''
    });
  }
  return out;
}

/** 문진 결과의 red flag — 감별진단 창 배너에 실시간 redFlags 와 같은 자리로 넣는다. */
export function patientRedFlags(
  detail: PatientDetail,
  fallbackReason: string
): string[] {
  if (!detail.encounter.redFlag) return [];
  return [detail.encounter.redFlagReason ?? fallbackReason];
}
