/**
 * 문진 흐름의 zod 스키마.
 *
 * 세 묶음이 여기 있다:
 *   1. API 요청 본문 — DB 에 아무것도 닿기 전에 검증.
 *   2. 모델 도구 출력 — 저장되기 전에 검증.
 *   3. 저장되는 JSON 컬럼 — intake_results 에 실제로 쓰이는 최종 형태.
 *
 * 3번은 `supabase/migrations/0001_patients_encounters.sql` 의 컬럼 주석과
 * Electron 쪽 파서(`src/renderer/shared/patientMode.ts`)가 함께 소비한다.
 * 특히 `differentials_json[].name_en` 은 M4 의 PubMed 조회가 검색어로 쓰고,
 * `soap_json.follow_up_questions` / `soap_json.medical_terms` 는 questions /
 * terms 오버레이 창이 읽는다. 그 키 이름들은 저쪽 파서가 받아들이는 것과
 * 정확히 같아야 한다 — 어긋나면 창이 조용히 빈 채로 뜬다.
 */

import { z } from 'zod';

import { MAX_ANSWER_LENGTH, MAX_DIALOGUE_TURNS } from '@/lib/intake/limits';

// ---------------------------------------------------------------------------
// 1. API 요청 본문
// ---------------------------------------------------------------------------

/** 세 동의 모두 필수: boolean 이 아니라 리터럴 true. */
export const consentsSchema = z.object({
  privacy: z.literal(true),
  recording: z.literal(true),
  ai: z.literal(true)
});

const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '생년월일 형식이 올바르지 않습니다.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    // 정규식이 통과시키는 2024-02-31 같은 달력상 불가능한 날짜를 거른다.
    if (parsed.toISOString().slice(0, 10) !== value) return false;
    return parsed.getTime() <= Date.now();
  }, '생년월일이 올바르지 않습니다.');

/**
 * 접수처가 발급한 방문 코드.
 *
 * 길이 상한만 둔다. 표기 정리(하이픈·공백·대소문자)와 유효성 판정은 전부 DB
 * 쪽(`normalize_visit_code()` / `redeem_visit_access_code()`)이 한다. 여기서
 * 형식을 엄격하게 잡으면 판정이 두 곳으로 갈라지고, 갈라진 둘 중 하나만
 * 고쳐지는 날이 온다.
 */
// `error` 옵션이 없으면 코드 키가 **아예 빠진** 요청은 zod 기본 영어 메시지로
// 떨어지고("Invalid input: expected string, received undefined") 그 문장이 접수대
// 앞의 환자에게 그대로 보인다. 토큰 스키마가 같은 이유로 이미 이렇게 되어 있다.
const visitCodeSchema = z
  .string({ error: '접수처에서 받은 코드를 입력해 주세요.' })
  .trim()
  .min(1, '접수처에서 받은 코드를 입력해 주세요.')
  .max(32, '코드를 다시 확인해 주세요.');

/** 코드만 확인하는 요청. 아무것도 만들지 않고 소모하지도 않는다. */
export const intakeCodeCheckRequestSchema = z.object({
  kiosk: z.string().trim().max(31).nullish(),
  code: visitCodeSchema
});

export type IntakeCodeCheckRequest = z.infer<typeof intakeCodeCheckRequestSchema>;

export const intakeStartRequestSchema = z.object({
  /** URL 의 `?k=` 값. 담당 의사 귀속의 출발점 (`lib/intake/kiosk.ts`). */
  kiosk: z.string().trim().max(31).nullish(),
  /**
   * [HARD] 방문 코드. 슬러그만으로는 문진을 시작할 수 없다 — L1 의 전부가
   * 이 한 줄이다. 검증은 DB 에 무엇을 쓰기 전에, 모델을 부르기 전에 끝난다.
   */
  code: visitCodeSchema,
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(60),
  birthDate: birthDateSchema,
  /** 선택: 환자가 모를 수 있고, 접수처가 나중에 채운다. */
  registrationNo: z.string().trim().max(40).nullish(),
  consents: consentsSchema
});

export type IntakeStartRequest = z.infer<typeof intakeStartRequestSchema>;

/**
 * 대화 한 턴.
 *
 * 이 키오스크는 대화를 DB 에 쌓지 않고 클라이언트가 매 턴 통째로 되돌려
 * 보낸다(`lib/intake/interview.ts` 의 근거 참고). 그래서 여기서 크기와 형태를
 * 서버가 직접 막아야 한다.
 */
const dialogueTurnSchema = z.object({
  role: z.enum(['agent', 'patient']),
  text: z.string().trim().min(1).max(MAX_ANSWER_LENGTH)
});

export const intakeTurnRequestSchema = z.object({
  encounterId: z.uuid('문진 정보가 올바르지 않습니다.'),
  /**
   * /api/intake/start 가 발급한 서명 토큰. 진료 id 와 담당 의사에 묶여 있고
   * 서버에서 검증된다(`lib/intake/token.ts`). 이게 없으면 진료 id 하나만으로
   * 남의 문진에 답변을 덧붙일 수 있다.
   */
  // `error` 옵션이 없으면 토큰이 아예 빠진 요청은 zod 기본 영어 메시지로
  // 떨어지고, 그 문장이 문진 중인 환자에게 그대로 보인다.
  token: z
    .string({ error: '문진 세션 정보가 올바르지 않습니다. 처음부터 다시 시작해 주세요.' })
    .min(1, '문진 세션 정보가 올바르지 않습니다. 처음부터 다시 시작해 주세요.')
    .max(300),
  /** 지금까지의 대화. 이번 답변은 포함하지 않는다. */
  turns: z.array(dialogueTurnSchema).max(MAX_DIALOGUE_TURNS),
  text: z.string().trim().min(1, '답변을 입력해 주세요.').max(MAX_ANSWER_LENGTH)
});

export type IntakeTurnRequest = z.infer<typeof intakeTurnRequestSchema>;

// ---------------------------------------------------------------------------
// 2. 모델 도구 출력
// ---------------------------------------------------------------------------

/** `record_intake_turn` 도구가 만드는 문진 한 턴. */
export const interviewTurnSchema = z.object({
  done: z
    .boolean()
    .describe(
      'true only when 3-5 prioritized differential diagnoses and matching tests can already be produced from the answers so far.'
    ),
  message: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe(
      'Korean text spoken to the patient. The next single question when done is false, a short closing line when done is true.'
    ),
  danger: z
    .boolean()
    .describe('true when the answers so far suggest an ophthalmic emergency (red flag).'),
  danger_reason: z
    .string()
    .max(300)
    .describe('Short Korean reason for the red flag. Empty string when danger is false.')
});

export type InterviewTurn = z.infer<typeof interviewTurnSchema>;

/**
 * 감별진단 하나를 지지하는 근거 (E1).
 *
 * `source` 는 문진 대화의 발화 번호다. 프롬프트가 대화를 `[#0]` 부터 번호를
 * 매겨 보여주고 모델은 그 번호를 그대로 쓴다. Electron 쪽 렌더러
 * (`src/shared/findings.ts`)가 같은 규칙으로 다시 검증한다 — 확신도 퍼센트
 * 대신 의사가 직접 확인할 수 있는 발화를 화면에 올리기 위한 것이다.
 */
const modelSupportingFindingSchema = z.object({
  finding: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('One-line Korean observation from the interview supporting this diagnosis.'),
  source: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .describe(
      'The utterance number this observation came from, copied from the [#N] prefix in the transcript. Example: "#3". Number form only.'
    )
});

const modelDifferentialSchema = z.object({
  rank: z.number().int().min(1).max(5).describe('1 is the most likely diagnosis.'),
  name_kr: z.string().trim().min(1).describe('Korean diagnosis name.'),
  name_en: z
    .string()
    .trim()
    .min(1)
    .describe(
      'English diagnosis name as written in the medical literature. Used verbatim as a PubMed search term, so it must be the standard English clinical term, not a transliteration.'
    ),
  rationale: z.string().trim().min(1).max(300).describe('One-line Korean rationale.'),
  supporting_findings: z
    .array(modelSupportingFindingSchema)
    .max(4)
    .describe(
      'Observations from the interview that support this diagnosis. Leave the array empty rather than citing an utterance that does not exist.'
    )
});

const modelRecommendedTestSchema = z.object({
  name_kr: z.string().trim().min(1).describe('Korean test name.'),
  name_en: z.string().trim().min(1).describe('English test name.'),
  reason: z.string().trim().min(1).max(200).describe('One-line Korean reason for the test.')
});

const modelFollowUpQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Korean question the physician should ask the patient at the visit.'),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('One-line Korean note on which differential the answer discriminates.')
});

const modelMedicalTermSchema = z.object({
  term: z.string().trim().min(1).max(60).describe('Korean medical term used in this record.'),
  term_en: z.string().trim().min(1).max(80).describe('English equivalent of the term.'),
  definition: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('One or two plain Korean sentences an elderly patient would understand.')
});

/**
 * `record_intake_result` 도구의 출력.
 *
 * SOAP 의 `o` 는 일부러 없다: 이 단계의 objective 섹션은 항상 고정 문구
 * "진찰 소견 대기" 이므로 모델에 맡기지 않고 서버가 채운다.
 */
export const modelIntakeResultSchema = z.object({
  soap: z.object({
    s: z.object({
      chief_complaint: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('Chief complaint in one short Korean phrase.'),
      hpi: z.string().trim().min(1).describe('History of present illness.'),
      pmh: z.string().trim().min(1).describe('Past medical history. Write 없음 when none.'),
      medications: z
        .string()
        .trim()
        .min(1)
        .describe('Current medications. Write 없음 when none.'),
      allergies: z.string().trim().min(1).describe('Allergies. Write 없음 when none.')
    }),
    a: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Assessment: the differential list in prose. Must state it is not a confirmed diagnosis.'
      ),
    p: z.string().trim().min(1).describe('Plan: the recommended tests in prose.')
  }),
  differentials: z.array(modelDifferentialSchema).min(3).max(5),
  recommended_tests: z.array(modelRecommendedTestSchema).min(1).max(10),
  follow_up_questions: z.array(modelFollowUpQuestionSchema).min(3).max(5),
  medical_terms: z.array(modelMedicalTermSchema).min(3).max(6)
});

export type ModelIntakeResult = z.infer<typeof modelIntakeResultSchema>;

// ---------------------------------------------------------------------------
// 3. 저장되는 JSON 컬럼 형태
// ---------------------------------------------------------------------------

/**
 * `soap_json.transcript` 한 줄.
 *
 * 대화 원문을 남기는 자리다. 이 스키마에는 righthand 의 `messages` 테이블에
 * 해당하는 것이 없으므로, 진료 기록으로서의 대화 전문을 여기에 함께 저장한다.
 * Electron 파서는 모르는 키를 무시하므로 추가해도 안전하다.
 */
export const transcriptLineSchema = z.object({
  role: z.enum(['agent', 'patient']),
  text: z.string().min(1)
});

/** intake_results.differentials_json — index 0 이 최우선이어야 한다. */
export const differentialsJsonSchema = z
  .array(
    z.object({
      rank: z.number().int().min(1),
      name_kr: z.string().trim().min(1),
      name_en: z.string().trim().min(1),
      rationale: z.string().trim().min(1),
      /**
       * Electron 감별진단 창이 읽는다 (E1, `src/shared/findings.ts`).
       * 빈 배열을 허용한다 — 서버가 존재하지 않는 발화를 가리킨 근거를
       * 저장 전에 떨어내고 나면 하나도 안 남을 수 있다. 그 경우 Electron 은
       * 그 진단을 "근거 미확인" 으로 따로 표시한다. 지어낸 근거를 남기는
       * 것보다 낫다.
       */
      supporting_findings: z.array(
        z.object({
          finding: z.string().trim().min(1),
          source: z.string().trim().min(1)
        })
      )
    })
  )
  .min(3)
  .max(5)
  .refine((items) => items[0]?.rank === 1, 'The first differential must be rank 1.');

/** intake_results.recommended_tests_json */
export const recommendedTestsJsonSchema = z
  .array(
    z.object({
      name_kr: z.string().trim().min(1),
      name_en: z.string().trim().min(1),
      reason: z.string().trim().min(1)
    })
  )
  .min(1);

/** intake_results.soap_json */
export const soapJsonSchema = z.object({
  s: z.object({
    chief_complaint: z.string().trim().min(1),
    hpi: z.string().trim().min(1),
    pmh: z.string().trim().min(1),
    medications: z.string().trim().min(1),
    allergies: z.string().trim().min(1)
  }),
  o: z.string().trim().min(1),
  a: z.string().trim().min(1),
  p: z.string().trim().min(1),
  /** Electron `questions` 창이 읽는다. patientMode.patientQuestions 참고. */
  follow_up_questions: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        rationale: z.string().trim().min(1)
      })
    )
    .min(1),
  /** Electron `terms` 창이 읽는다. patientMode.patientTerms 참고. */
  medical_terms: z
    .array(
      z.object({
        term: z.string().trim().min(1),
        term_en: z.string().trim().min(1),
        definition: z.string().trim().min(1)
      })
    )
    .min(1),
  /** 문진 대화 전문. 별도 테이블이 없어서 여기에 함께 남긴다. */
  transcript: z.array(transcriptLineSchema)
});

export type SoapJson = z.infer<typeof soapJsonSchema>;

/** insert 직전에 한 번에 검증하는 행 전체. */
export const intakeResultRowSchema = z.object({
  soap_json: soapJsonSchema,
  differentials_json: differentialsJsonSchema,
  recommended_tests_json: recommendedTestsJsonSchema
});

export type IntakeResultRow = z.infer<typeof intakeResultRowSchema>;
