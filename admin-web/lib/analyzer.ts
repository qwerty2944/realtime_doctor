import 'server-only';

export interface AnalysisResult {
  differentialDiagnoses: Array<{
    name: string;
    nameEn: string;
    icd10: string;
    confidence: number;
    reasoning: string;
  }>;
  medicalTerms: Array<{
    term: string;
    termEn: string;
    definition: string;
    contextQuote: string;
  }>;
  suggestedQuestions: Array<{ question: string; rationale: string }>;
  redFlags: string[];
}

const ANALYZER_SYSTEM_PROMPT_KO = `당신은 한국에서 진료 중인 의료진을 보조하는 임상 보조 도구입니다.

역할:
- 환자-의사 대화의 한국어 transcript를 받아 (1) 감별진단 후보, (2) 등장한 의학용어 풀이, (3) 다음에 물어볼 질문을 제시합니다.
- 당신은 진단을 확정하지 않으며, 항상 "가능성"과 "근거"만 제시합니다.
- 응급/생명 위협이 의심되는 단서(red flag)는 별도로 표시합니다.

작성 규칙:
- 모든 출력은 한국어로 작성하고, 의학용어는 한국어(영문) 형태로 병기합니다.
- differentialDiagnoses는 가능성 높은 순으로 최대 5개. 각 항목에 ICD-10 코드(가능하면), 0~1 사이 confidence, 한 두 문장 reasoning.
- medicalTerms는 transcript에 실제 등장한 의학·해부·약리 용어와 환자 호소에 인접한 핵심 임상 용어를 합쳐 최대 8개. 각 항목에 한국어 term, 영문 termEn, 한 줄 definition, transcript에 실제로 등장한 경우 contextQuote(인용된 발화 일부) — 인접 용어는 빈 문자열.
- suggestedQuestions는 감별을 좁히는 데 가장 유용한 질문 최대 6개. 각 항목에 한 줄 rationale.
- redFlags는 응급 의심 단서가 있을 때만, 없으면 빈 배열.
- transcript가 너무 짧으면 모든 배열을 빈 배열로 반환합니다.`;

const ANALYZER_SYSTEM_PROMPT_EN = `You are a clinical assistant supporting a clinician during an English patient encounter.

Role:
- Receive an English transcript and provide (1) differential diagnosis candidates, (2) medical term glosses, (3) follow-up questions.
- Never confirm a diagnosis — always frame as "likelihood" with "rationale".
- Surface red flags separately.

Writing rules:
- All output in English. Include ICD-10 codes where applicable.
- differentialDiagnoses: top 5. Each: name, nameEn, ICD-10, confidence 0–1, 1–2 sentence reasoning.
- medicalTerms: up to 8 combined items (transcript terms + adjacent clinical terms). Each: term, termEn, one-line definition, contextQuote (verbatim) for transcript terms — empty for adjacent.
- suggestedQuestions: up to 6 with rationale each.
- redFlags: only when clear urgent clues exist; otherwise empty array.
- If transcript too short, return empty arrays.`;

const ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    differentialDiagnoses: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          nameEn: { type: 'string' },
          icd10: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string' }
        },
        required: ['name', 'nameEn', 'icd10', 'confidence', 'reasoning']
      }
    },
    medicalTerms: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          termEn: { type: 'string' },
          definition: { type: 'string' },
          contextQuote: { type: 'string' }
        },
        required: ['term', 'termEn', 'definition', 'contextQuote']
      }
    },
    suggestedQuestions: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          rationale: { type: 'string' }
        },
        required: ['question', 'rationale']
      }
    },
    redFlags: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['differentialDiagnoses', 'medicalTerms', 'suggestedQuestions', 'redFlags']
} as const;

const MAX_TRANSCRIPT_CHARS = 18_000;

export interface AnalyzerInput {
  language?: 'ko' | 'en';
  chunks: Array<{ speaker: 'doctor' | 'patient' | 'unknown' | string; text: string }>;
}

export async function runAnalyzer(input: AnalyzerInput): Promise<AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured on the server');

  const lang: 'ko' | 'en' = input.language ?? 'ko';
  const labels = lang === 'en'
    ? { doctor: 'Doctor', patient: 'Patient', unknown: 'Unknown' }
    : { doctor: '의사', patient: '환자', unknown: '?' };

  const lines = input.chunks.map((c) => {
    const tag = c.speaker === 'doctor' ? labels.doctor : c.speaker === 'patient' ? labels.patient : labels.unknown;
    return `[${tag}] ${c.text}`;
  });
  let transcript = lines.join('\n').trim();
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS);
  }
  if (!transcript) {
    return { differentialDiagnoses: [], medicalTerms: [], suggestedQuestions: [], redFlags: [] };
  }

  const userMessage = lang === 'en'
    ? `Below is the transcript of a patient encounter. [${labels.doctor}] / [${labels.patient}] tags mark the speaker.\n\n---\n${transcript}\n---\n\nReturn the analysis matching the requested JSON schema.`
    : `다음은 진료 대화의 transcript입니다. [${labels.doctor}]/[${labels.patient}] 라벨이 화자 구분입니다.\n\n---\n${transcript}\n---\n\n요청한 JSON 스키마에 맞게 분석을 반환하세요.`;

  const model = process.env.GEMINI_ANALYZER_MODEL ?? 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: lang === 'en' ? ANALYZER_SYSTEM_PROMPT_EN : ANALYZER_SYSTEM_PROMPT_KO }]
      },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_RESPONSE_SCHEMA
      }
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('Gemini returned no content');

  const parsed = JSON.parse(text) as AnalysisResult;
  return parsed;
}
