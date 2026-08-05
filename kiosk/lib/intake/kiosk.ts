import 'server-only';

/**
 * 키오스크 → 담당 의사 귀속. SERVER ONLY.
 *
 * 왜 필요한가:
 * realtime_doctor 의 `encounters.user_id` 는 NOT NULL 이고 RLS 는
 * `user_id = auth.uid()` 다. 즉 진료를 볼 의사의 auth user id 가 행에 박혀
 * 있지 않으면 그 행은 **아무에게도 보이지 않는다**. 문진을 받은 환자가
 * 대기목록에서 영영 사라지는, 조용하고 최악인 실패다.
 *
 * 그런데 환자는 로그인하지 않는다(카카오톡 링크로 들어온 어르신에게 계정은
 * 없다). 따라서 "이 문진은 누구 것인가" 는 환자가 아니라 **접속 경로**가
 * 알려줘야 한다. 그래서 두 겹으로 나눈다:
 *
 *   1) 키오스크 슬러그 (URL `?k=<slug>`)
 *      비밀이 아니다. `KIOSK_CLINICIANS` 매핑에서 의사 uuid 로 서버에서만
 *      번역된다. 슬러그만으로 할 수 있는 일은 "그 의사 앞으로 문진을 시작"
 *      뿐이고, 읽기 권한은 0 이다. 병원 태블릿 홈 화면에 URL 을 박아두거나
 *      대기실 QR 로 뿌리는 용도.
 *
 *   2) 세션 토큰 (HMAC, `./token.ts`)
 *      /api/intake/start 가 발급한다. MAC 입력에 encounter id 와 **의사
 *      uuid** 가 함께 들어간다. 검증할 때 의사 uuid 는 클라이언트가 보낸 값이
 *      아니라 DB 의 encounter 행에서 다시 읽어온다. 그래서 토큰은 자기가
 *      발급된 그 진료·그 의사에서만 유효하고, 다른 진료에 재사용할 수 없다.
 *
 * 매핑 형식(`KIOSK_CLINICIANS`)은 JSON 객체다:
 *   {"main":"00000000-0000-0000-0000-000000000000","annex":"..."}
 * 슬러그가 하나뿐이면 `?k=` 를 생략해도 그 하나가 쓰인다 — 단일 의원에서
 * URL 을 더 짧게 유지하기 위한 편의이고, 둘 이상이면 생략은 에러다
 * (어느 의사인지 임의로 고르는 것보다 접수처에 물어보는 편이 낫다).
 */

import { requireEnv } from '@/lib/env';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 슬러그는 URL 에 그대로 들어가므로 좁게 제한한다. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,30}$/i;

export interface KioskRegistry {
  /** slug -> 담당 의사의 auth.users.id */
  readonly bySlug: ReadonlyMap<string, string>;
}

let cached: KioskRegistry | null = null;

/**
 * `KIOSK_CLINICIANS` 를 파싱한다.
 *
 * 형식이 조금이라도 이상하면 던진다. 잘못된 항목을 조용히 건너뛰면 그 키오스크로
 * 들어온 환자만 통째로 사라지는데, 그건 화면상 "그냥 안 뜬다" 로만 보인다.
 */
export function parseKioskRegistry(raw: string): KioskRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      'KIOSK_CLINICIANS is not valid JSON. Expected {"slug":"<clinician auth user uuid>"}.',
      { cause }
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'KIOSK_CLINICIANS must be a JSON object mapping kiosk slug to clinician uuid.'
    );
  }

  const bySlug = new Map<string, string>();
  for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!SLUG_PATTERN.test(slug)) {
      throw new Error(
        `KIOSK_CLINICIANS has an invalid kiosk slug "${slug}". Use letters, digits, "-" and "_" only.`
      );
    }
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new Error(
        `KIOSK_CLINICIANS["${slug}"] is not a uuid. It must be the clinician's Supabase auth user id.`
      );
    }
    bySlug.set(slug.toLowerCase(), value.toLowerCase());
  }

  if (bySlug.size === 0) {
    throw new Error('KIOSK_CLINICIANS is empty. At least one kiosk must be registered.');
  }

  return { bySlug };
}

export function getKioskRegistry(): KioskRegistry {
  if (!cached) cached = parseKioskRegistry(requireEnv('KIOSK_CLINICIANS'));
  return cached;
}

/** 테스트/재로딩용. */
export function resetKioskRegistryCache(): void {
  cached = null;
}

export type KioskResolution =
  | { ok: true; slug: string; clinicianId: string }
  | { ok: false; reason: 'unknown_kiosk' | 'ambiguous_kiosk' };

/**
 * URL 의 `?k=` 값을 담당 의사 uuid 로 번역한다.
 *
 * 실패 이유를 구분해서 돌려준다. 환자에게는 어차피 같은 문장("접수처에
 * 문의해 주세요")을 보여주지만, 운영자는 로그에서 "슬러그 오타" 와
 * "여러 키오스크인데 k 가 없음" 을 구별할 수 있어야 한다.
 */
export function resolveKiosk(slug: string | null | undefined): KioskResolution {
  const registry = getKioskRegistry();
  const normalized = slug?.trim().toLowerCase() ?? '';

  if (normalized === '') {
    if (registry.bySlug.size === 1) {
      const [only] = [...registry.bySlug.entries()];
      return { ok: true, slug: only[0], clinicianId: only[1] };
    }
    return { ok: false, reason: 'ambiguous_kiosk' };
  }

  const clinicianId = registry.bySlug.get(normalized);
  if (!clinicianId) return { ok: false, reason: 'unknown_kiosk' };

  return { ok: true, slug: normalized, clinicianId };
}
