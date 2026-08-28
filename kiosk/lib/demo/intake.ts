/**
 * 데모 문진(7항목 체크리스트)의 프롬프트·도구 선언·응답 파싱.
 *
 * 이것은 **데모 전용**이다. 운영 문진(`lib/intake/*`)과 섞이지 않게 따로 둔다.
 * 운영 문진은 안과 특화 히스토리 트리를 강제 도구 호출(mode=ANY)로 돌리지만,
 * 여기서는 일반 문진 7항목을 자유 대화(mode=AUTO)로 채운다 — 모델이 말도 하고
 * 도구도 부르는 형태라 `lib/llm` 의 `callTool`(도구 호출 하나만 허용) 추상화에
 * 얹을 수 없다. 그래서 요청 조립은 이 파일이 직접 한다.
 *
 * Flutter 참조 구현(mobile/lib/data/datasources/remote/intake_chat_ds.dart)의
 * 한국어 시스템 프롬프트·도구 선언·필드 의미를 그대로 옮겼다.
 *
 * 프로토콜 단순화: 도구 호출 결과를 대화 이력에 되돌려 넣지 않는다. 대신 매 턴
 * "수집됨/미수집" 목록을 시스템 프롬프트에 실어 보낸다. 상태의 단일 출처는
 * 클라이언트가 들고 있는 record 다.
 */

export const RECORD_INTAKE_FIELD_TOOL = 'record_intake_field';

/** 이 7개가 모두 채워지면 문진 완료로 본다. */
export const INTAKE_FIELDS = [
  'chiefComplaint',
  'onset',
  'character',
  'aggravatingRelieving',
  'medications',
  'allergies',
  'pastHistory'
] as const;

export type IntakeField = (typeof INTAKE_FIELDS)[number];

/** 진행 표시와 확인 카드에 쓰는 한국어 라벨. */
export const INTAKE_FIELD_LABELS: Record<IntakeField, string> = {
  chiefComplaint: '주증상',
  onset: '발병 시기·경과',
  character: '증상 양상·부위',
  aggravatingRelieving: '악화·완화 요인',
  medications: '복용약',
  allergies: '알레르기',
  pastHistory: '과거력'
};

/**
 * 항목별 기본 질문. 모델이 도구만 부르고 말을 하지 않은 턴의 마지막 방어선이다.
 * 이게 없으면 화면에 다음 질문이 안 떠서 대화가 조용히 멈춘다.
 */
const INTAKE_FIELD_QUESTIONS: Record<IntakeField, string> = {
  chiefComplaint: '오늘 어디가 어떻게 불편해서 오셨나요?',
  onset: '그 증상은 언제부터 시작되셨나요?',
  character: '증상이 어떤 느낌인지, 어느 부위가 불편하신지 말씀해 주시겠어요?',
  aggravatingRelieving: '어떤 때 더 심해지고, 어떤 때 좀 나아지시나요?',
  medications: '지금 드시고 계신 약이 있으신가요? 영양제도 괜찮습니다.',
  allergies: '약이나 음식에 알레르기가 있으신가요?',
  pastHistory: '이전에 앓으셨던 병이나 받으신 수술이 있으신가요?'
};

/** 값이 없는(=아직 못 들은) 항목은 map 에 없다. */
export type IntakeRecord = Partial<Record<IntakeField, string>>;

export type IntakeRole = 'assistant' | 'patient';

export interface IntakeMessage {
  role: IntakeRole;
  text: string;
}

export interface IntakeFieldCall {
  field: IntakeField;
  value: string;
}

export interface IntakeTurn {
  reply: string;
  calls: IntakeFieldCall[];
}

export function isIntakeField(value: unknown): value is IntakeField {
  return typeof value === 'string' && (INTAKE_FIELDS as readonly string[]).includes(value);
}

function hasValue(record: IntakeRecord, field: IntakeField): boolean {
  const value = record[field];
  return typeof value === 'string' && value.trim() !== '';
}

export function filledFields(record: IntakeRecord): IntakeField[] {
  return INTAKE_FIELDS.filter((field) => hasValue(record, field));
}

export function missingFields(record: IntakeRecord): IntakeField[] {
  return INTAKE_FIELDS.filter((field) => !hasValue(record, field));
}

export function isComplete(record: IntakeRecord): boolean {
  return missingFields(record).length === 0;
}

/** 항목 기록. 빈 값은 무시한다(모델이 빈 문자열로 도구를 부르는 경우 방어). */
export function recordField(
  record: IntakeRecord,
  field: IntakeField,
  value: string
): IntakeRecord {
  const trimmed = value.trim();
  if (trimmed === '') return record;
  return { ...record, [field]: trimmed };
}

/** 모델 응답이 비었을 때 대신 내보낼 안내 문구. */
export function fallbackReply(record: IntakeRecord): string {
  const next = missingFields(record)[0];
  if (!next) return '말씀해 주셔서 감사합니다. 문진이 모두 끝났습니다. 내용을 확인해 주세요.';
  return INTAKE_FIELD_QUESTIONS[next];
}

const SYSTEM_PROMPT = `당신은 병원 접수처의 친절한 문진 도우미입니다. 환자와 한국어로 자연스럽게 대화하며 문진 항목을 채웁니다.

규칙:
- 존댓말로, 짧고 쉬운 문장을 씁니다. 의학 전문용어는 풀어서 말합니다.
- 한 번에 질문은 딱 하나만 합니다. 여러 항목을 몰아서 묻지 않습니다.
- 아직 수집되지 않은 항목 중 하나를 향해 질문합니다.
- 환자가 어떤 항목에 대한 정보를 말하면 즉시 ${RECORD_INTAKE_FIELD_TOOL} 도구를 호출해 기록합니다.
  한 번의 발화에 여러 항목이 담겨 있으면 도구를 여러 번 호출합니다.
- 환자가 "없다/모른다"고 답해도 그것이 답변이므로 "없음"으로 기록합니다.
- 진단하거나 치료를 권하지 않습니다. 정보 수집만 합니다.
- 답변이 모호하면 되묻되, 같은 질문을 세 번 이상 반복하지 않습니다.
- 모든 항목이 수집되면 더 묻지 말고 감사 인사와 함께 마무리합니다.
`;

/** 문진 도구 선언 — field 는 7개 체크리스트 키의 enum. */
function intakeToolDeclaration() {
  return {
    functionDeclarations: [
      {
        name: RECORD_INTAKE_FIELD_TOOL,
        description: '환자가 말한 문진 항목 값을 기록한다. 항목 하나당 한 번 호출한다.',
        parameters: {
          type: 'OBJECT',
          properties: {
            field: {
              type: 'STRING',
              description: '기록할 문진 항목',
              enum: [...INTAKE_FIELDS]
            },
            value: {
              type: 'STRING',
              description: '환자 발화에서 뽑아낸 값. 환자의 표현을 살려 간결하게.'
            }
          },
          required: ['field', 'value']
        }
      }
    ]
  };
}

/** 현재 수집 상태를 모델에게 알려주는 한국어 상태 블록. */
export function intakeStateBlock(record: IntakeRecord): string {
  const filled = filledFields(record)
    .map((field) => `- ${INTAKE_FIELD_LABELS[field]}(${field}): ${record[field]}`)
    .join('\n');
  const missing = missingFields(record)
    .map((field) => `- ${INTAKE_FIELD_LABELS[field]}(${field})`)
    .join('\n');

  return [
    '지금까지 수집된 항목:',
    filled === '' ? '- (없음)' : filled,
    '',
    '아직 수집되지 않은 항목:',
    missing === '' ? '- (없음, 모두 수집 완료)' : missing
  ].join('\n');
}

/**
 * Gemini 3 는 숨은 추론 토큰도 `maxOutputTokens` 에 센다. 답변 자체는 짧지만
 * 예산을 빠듯하게 잡으면 추론이 다 먹고 `finishReason: MAX_TOKENS` 로 빈 응답이
 * 나온다. `lib/llm/gemini.ts` 의 THINKING_HEADROOM 과 같은 이유의 여유분이다.
 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * 대화 한 턴의 요청 body. history 는 오래된 것부터 정렬돼 있어야 한다.
 *
 * `allowTools` 를 false 로 주면 도구를 빼고 텍스트만 받는다. 모델이 도구만
 * 부르고 말은 하지 않은 턴을 이어받아 다음 질문을 뽑아낼 때 쓴다.
 */
export function buildIntakeTurnBody(
  history: readonly IntakeMessage[],
  record: IntakeRecord,
  { allowTools = true }: { allowTools?: boolean } = {}
) {
  return {
    systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n${intakeStateBlock(record)}` }] },
    contents: history.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.text }]
    })),
    ...(allowTools
      ? {
          tools: [intakeToolDeclaration()],
          // 운영 문진과 달리 ANY 가 아니라 AUTO 다. 도구 호출과 자유 발화를
          // 한 턴에 같이 받아야 대화가 이어진다.
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
        }
      : {}),
    generationConfig: { temperature: 0.4, maxOutputTokens: MAX_OUTPUT_TOKENS }
  };
}

/** 확인용 요약문 요청 body — 도구 없이 텍스트만 받는다. */
export function buildIntakeSummaryBody(record: IntakeRecord) {
  const lines = filledFields(record)
    .map((field) => `${INTAKE_FIELD_LABELS[field]}: ${record[field]}`)
    .join('\n');

  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              '다음 문진 내용을 환자가 확인하기 쉽도록 한국어 3~5문장으로 요약하세요. ' +
              '항목을 빠뜨리지 말고, 진단이나 치료 권고는 하지 마세요. 요약문만 출력하세요.\n\n' +
              lines
          }
        ]
      }
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS }
  };
}

/**
 * 모델이 텍스트 파트 안에 흘리는 도구 호출 마크업.
 *
 * gemini-3.5-flash-lite 는 도구를 제대로 된 functionCall 파트로 부르면서
 * **동시에** 그 호출을 직렬화한 `<tool_call>...</tool_call>` 을 답변 텍스트에
 * 같이 뱉는다. 그대로 두면 환자 말풍선에 내부 마크업이 보이고 TTS 가 그걸
 * 소리 내어 읽는다. 닫는 태그가 없는 잘린 형태도 함께 걷어낸다.
 */
const TOOL_CALL_MARKUP = /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g;

function stripToolCallMarkup(text: string): string {
  return text.replace(TOOL_CALL_MARKUP, ' ').replace(/\s+/g, ' ').trim();
}

type GeminiPart = Record<string, unknown>;

function partsOf(response: unknown): GeminiPart[] {
  if (response === null || typeof response !== 'object') return [];
  const candidates = (response as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const first: unknown = candidates[0];
  if (first === null || typeof first !== 'object') return [];
  const content = (first as Record<string, unknown>).content;
  if (content === null || typeof content !== 'object') return [];
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return [];

  return parts.filter((part): part is GeminiPart => part !== null && typeof part === 'object');
}

/**
 * generateContent 응답에서 텍스트와 functionCall 을 뽑아 한 턴으로 만든다.
 * 형태가 어긋난 part 는 조용히 건너뛴다 — 모델 응답은 신뢰할 수 없는 입력이다.
 */
export function parseIntakeTurn(response: unknown): IntakeTurn {
  const chunks: string[] = [];
  const calls: IntakeFieldCall[] = [];

  for (const part of partsOf(response)) {
    const text = part.text;
    if (typeof text === 'string') {
      const cleaned = stripToolCallMarkup(text);
      if (cleaned !== '') chunks.push(cleaned);
    }

    const call = part.functionCall ?? part.function_call;
    if (call === null || typeof call !== 'object') continue;

    const callRecord = call as Record<string, unknown>;
    if (callRecord.name !== RECORD_INTAKE_FIELD_TOOL) continue;

    const args = callRecord.args ?? callRecord.arguments;
    if (args === null || typeof args !== 'object') continue;

    const { field, value } = args as Record<string, unknown>;
    if (isIntakeField(field) && typeof value === 'string' && value.trim() !== '') {
      calls.push({ field, value: value.trim() });
    }
  }

  return { reply: chunks.join(' '), calls };
}

/** 응답에서 순수 텍스트만 뽑는다(요약 경로). */
export function parseIntakeText(response: unknown): string {
  return stripToolCallMarkup(
    partsOf(response)
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
  );
}
