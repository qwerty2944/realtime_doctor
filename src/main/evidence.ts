import {
  type EvidenceReference,
  type EvidenceStatus
} from '../shared/types.js';
import { getSupabase } from './supabaseClient.js';

/**
 * 감별진단 문헌근거 조회 (righthand `lib/evidence/pubmed.ts` 포팅).
 *
 * righthand 판은 LLM 이 검색어를 만들고 결과를 요약했지만, 여기서는 **LLM 을 전혀
 * 거치지 않는다.** 인용문헌을 모델이 만들면 존재하지 않는 논문이 화면에 뜰 수
 * 있어서, PubMed 가 실제로 돌려준 레코드만 그대로 보여준다 (prompts.ts 는 손대지
 * 않는 이유이기도 하다).
 *
 * 실패는 절대 위로 던지지 않는다. 근거 패널은 보조 정보이므로 네트워크 장애나
 * NCBI 429 가 main 프로세스를 흔들면 안 된다 — 전부 EvidenceStatus 로 환원한다.
 */

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/** NCBI 에 이 앱을 식별시키는 이름 (E-utilities 가 요구하는 `tool` 파라미터). */
const TOOL_NAME = 'realtime-doctor';

/** 키 없는 호출은 초당 3회가 상한. 340ms 면 약간의 여유가 남는다. */
const MIN_REQUEST_INTERVAL_MS = 340;

/** API 키가 있으면 초당 10회까지 허용된다. */
const MIN_REQUEST_INTERVAL_MS_WITH_KEY = 110;

const REQUEST_TIMEOUT_MS = 10_000;

/** 한 진단당 가져올 논문 수. 380px 폭 카드에 접혀 들어갈 만큼만. */
const MAX_ARTICLES = 5;

/**
 * 캐시 유효기간 30일.
 *
 * 조회 대상이 가이드라인·리뷰·메타분석이라 하루이틀 단위로 바뀌지 않는다. 반면
 * 영원히 캐시하면 새 가이드라인이 나와도 화면에 영영 안 뜬다. 진료 현장에서 한
 * 달은 "최신 문헌을 놓쳤다"고 하기엔 짧고, 재조회 비용을 아끼기엔 충분한 구간.
 */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 429 를 맞으면 이 시간 동안 PubMed 호출을 전부 중단한다. */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

let contactWarned = false;

/** NCBI 가 요청하는 연락처. 없으면 파라미터를 빼고 한 번만 경고한다. */
function contactEmail(): string | null {
  const email = process.env['PUBMED_CONTACT_EMAIL']?.trim();
  if (email) return email;
  if (!contactWarned) {
    contactWarned = true;
    console.warn(
      '[evidence] PUBMED_CONTACT_EMAIL 미설정 — NCBI 는 모든 E-utilities 요청에 연락처를 요구합니다.'
    );
  }
  return null;
}

/** 선택적 NCBI API 키. 있으면 rate limit 이 3/s → 10/s 로 올라간다. */
function apiKey(): string | null {
  const key =
    process.env['NCBI_API_KEY']?.trim() || process.env['PUBMED_API_KEY']?.trim();
  return key ? key : null;
}

function warn(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[evidence:${scope}]`, msg);
}

// ── rate limit ──────────────────────────────────────────────────────────

/** 다음 호출이 허용되는 시각. 모듈 전역이라 창이 여러 개여도 하나의 줄에 선다. */
let nextSlot = 0;
/** 429 를 맞은 뒤 다시 시도해도 되는 시각. */
let cooldownUntil = 0;

class RateLimitedError extends Error {}

/**
 * E-utilities 호출을 최소 간격으로 직렬화한다.
 *
 * 요청마다 sleep 하는 방식이면 두 창이 동시에 근거를 열었을 때 각자 예의바르게
 * 기다린 뒤 결국 동시에 NCBI 를 때린다. 전역 체인이어야 실제로 줄이 선다.
 */
async function schedule<T>(run: () => Promise<T>): Promise<T> {
  const interval = apiKey()
    ? MIN_REQUEST_INTERVAL_MS_WITH_KEY
    : MIN_REQUEST_INTERVAL_MS;
  const now = Date.now();
  const startAt = Math.max(now, nextSlot);
  nextSlot = startAt + interval;

  const wait = startAt - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return run();
}

async function eutilsFetch(
  endpoint: string,
  params: Record<string, string>
): Promise<Response> {
  if (Date.now() < cooldownUntil) {
    throw new RateLimitedError('PubMed rate limit cooldown in effect.');
  }

  const url = new URL(`${EUTILS_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('tool', TOOL_NAME);
  const email = contactEmail();
  if (email) url.searchParams.set('email', email);
  const key = apiKey();
  if (key) url.searchParams.set('api_key', key);

  return schedule(async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: '*/*' }
    });

    if (response.status === 429) {
      // NCBI 가 막았으면 더 두드리지 않는다 — 차단이 길어질 뿐이다.
      cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      throw new RateLimitedError('PubMed returned 429 (too many requests).');
    }
    if (!response.ok) {
      throw new Error(`PubMed ${endpoint} responded ${response.status}.`);
    }
    return response;
  });
}

// ── 파싱 헬퍼 ───────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * esummary 날짜 필드에서 4자리 연도만 뽑는다.
 * PubMed 날짜는 자유형식("2023 Mar", "2019 Nov-Dec")이라 파싱이 아니라 추출.
 */
function parseYear(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const match = /\b(19|20)\d{2}\b/.exec(asString(candidate));
    if (match) return Number(match[0]);
  }
  return null;
}

export function pubmedUrl(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

/** shell.openExternal 로 넘겨도 되는 주소인지 — PubMed 논문 링크만 허용. */
export function isPubmedUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'pubmed.ncbi.nlm.nih.gov';
  } catch {
    return false;
  }
}

// ── esearch / esummary ──────────────────────────────────────────────────

async function esearch(term: string, retmax: number): Promise<string[]> {
  const response = await eutilsFetch('esearch.fcgi', {
    db: 'pubmed',
    retmode: 'json',
    retmax: String(retmax),
    sort: 'relevance',
    term
  });
  const body: unknown = await response.json();
  const idList = asRecord(asRecord(body)?.esearchresult)?.idlist;
  if (!Array.isArray(idList)) return [];
  return idList.map(asString).filter((pmid) => /^\d+$/.test(pmid));
}

async function esummary(pmids: readonly string[]): Promise<EvidenceReference[]> {
  if (pmids.length === 0) return [];

  const response = await eutilsFetch('esummary.fcgi', {
    db: 'pubmed',
    retmode: 'json',
    id: pmids.join(',')
  });
  const body: unknown = await response.json();
  const result = asRecord(asRecord(body)?.result);
  if (!result) return [];

  const refs: EvidenceReference[] = [];
  for (const pmid of pmids) {
    const entry = asRecord(result[pmid]);
    if (!entry) continue;
    const title = asString(entry.title);
    // 제목 없는 레코드는 빈 링크로 렌더되느니 버린다.
    if (title === '') continue;
    refs.push({
      pmid,
      title,
      journal: asString(entry.fulljournalname) || asString(entry.source) || null,
      year: parseYear(entry.pubdate, entry.epubdate, entry.sortpubdate),
      url: pubmedUrl(pmid)
    });
  }
  return refs;
}

/** 임상의가 먼저 보고 싶어하는 것 — 가이드라인과 리뷰로 좁힌다. */
function withReviewFilter(term: string): string {
  return `(${term}) AND (guideline[pt] OR practice guideline[pt] OR review[pt] OR systematic review[pt] OR meta-analysis[pt])`;
}

/**
 * PubMed 검색 → 인용 레코드.
 *
 * 가이드라인/리뷰 필터를 먼저 시도하고 결과가 없으면 원 검색어로 한 번 더 간다.
 * "이 진단에 가이드라인이 없다"가 "문헌이 없다"로 읽히면 안 되기 때문.
 */
async function searchPubMed(term: string): Promise<EvidenceReference[]> {
  let pmids = await esearch(withReviewFilter(term), MAX_ARTICLES);
  if (pmids.length === 0) pmids = await esearch(term, MAX_ARTICLES);
  if (pmids.length === 0) return [];
  return esummary(pmids);
}

// ── evidence_lookups 캐시 ───────────────────────────────────────────────

/** 캐시 키 — DB 인덱스가 lower(diagnosis) 라 조회도 소문자로 맞춘다. */
function cacheKey(diagnosis: string): string {
  return diagnosis.trim().toLowerCase();
}

function isReference(value: unknown): value is EvidenceReference {
  const row = asRecord(value);
  return (
    row !== null && typeof row.pmid === 'string' && typeof row.title === 'string'
  );
}

/** 저장된 JSON 은 스키마 보장이 없으므로 방어적으로 통과시킨다. */
function parseCached(value: unknown): EvidenceReference[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isReference).map((ref) => ({
    pmid: ref.pmid,
    title: ref.title,
    journal: typeof ref.journal === 'string' ? ref.journal : null,
    year: typeof ref.year === 'number' ? ref.year : null,
    // 저장 시점의 url 을 믿지 않고 pmid 에서 다시 만든다 (외부 열기 검증과 일관).
    url: pubmedUrl(ref.pmid)
  }));
}

async function readCache(key: string): Promise<EvidenceReference[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('evidence_lookups')
      .select('results_json, created_at')
      .eq('diagnosis', key)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      warn('readCache', error.message);
      return null;
    }
    const row = (data ?? [])[0] as
      | { results_json: unknown; created_at: string }
      | undefined;
    if (!row) return null;
    // 오래된 행은 없는 것으로 취급 — 삭제하지 않는 이유는 조회 실패 시
    // 마지막 수단으로 쓸 여지를 남기기 위함이 아니라, RLS 가 delete 를 막기 때문.
    if (Date.now() - new Date(row.created_at).getTime() > CACHE_TTL_MS) return null;
    return parseCached(row.results_json);
  } catch (err) {
    warn('readCache', err);
    return null;
  }
}

async function writeCache(
  key: string,
  references: EvidenceReference[]
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('evidence_lookups')
      .insert({ diagnosis: key, results_json: references });
    // 캐시 쓰기 실패는 조회 실패가 아니다 — 로그만 남기고 결과는 그대로 준다.
    if (error) warn('writeCache', error.message);
  } catch (err) {
    warn('writeCache', err);
  }
}

// ── 공개 진입점 ─────────────────────────────────────────────────────────

/** 같은 진단에 대한 중복 조회 합치기 (창 여러 개가 동시에 요청할 수 있다). */
const inFlight = new Map<string, Promise<EvidenceStatus>>();

/**
 * 진단명 하나의 문헌근거.
 *
 * 검색어는 영문명이 있으면 영문명을 쓴다 — PubMed 색인이 영어이고, 한국어
 * 진단명을 번역해 줄 LLM 을 여기서는 의도적으로 쓰지 않는다.
 */
export async function lookupEvidence(
  diagnosis: string,
  diagnosisEn?: string | null
): Promise<EvidenceStatus> {
  const term = (diagnosisEn ?? '').trim() || diagnosis.trim();
  if (term === '') {
    return { state: 'ready', references: [], cached: false };
  }

  const key = cacheKey(term);
  const running = inFlight.get(key);
  if (running) return running;

  const task = (async (): Promise<EvidenceStatus> => {
    const cached = await readCache(key);
    if (cached) return { state: 'ready', references: cached, cached: true };

    try {
      const references = await searchPubMed(term);
      // 빈 결과도 캐시한다 — "문헌 없음"을 알아내는 데도 두 번의 왕복이 든다.
      void writeCache(key, references);
      return { state: 'ready', references, cached: false };
    } catch (err) {
      warn('lookupEvidence', err);
      return {
        state: 'error',
        message:
          err instanceof RateLimitedError
            ? 'rate-limited'
            : err instanceof Error
              ? err.message
              : 'lookup failed'
      };
    }
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, task);
  return task;
}
