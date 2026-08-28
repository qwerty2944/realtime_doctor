import 'server-only';

/**
 * 방문 코드 검증 — 서버 전용. SERVER ONLY.
 *
 * 이 파일은 **판정하지 않는다.** 판정은 전부 DB 함수
 * `redeem_visit_access_code()` 안에 있다(0009 마이그레이션). 여기 있는 것은
 * 그 함수를 부르고 결과를 타입 있는 값으로 바꾸는 얇은 층이다.
 *
 * 왜 판정을 DB 에 뒀는가
 * ---------------------
 *   1. **원자성.** "코드를 찾는다 → 이미 쓰였는지 본다 → 쓴 것으로 표시한다"
 *      를 애플리케이션에서 하면 두 태블릿이 같은 코드를 동시에 들이밀 때
 *      둘 다 통과할 수 있다. 그러면 한 방문에 진료 행이 둘 생긴다.
 *   2. **속도 제한이 프로세스보다 오래 살아야 한다.** 키오스크는 서버리스로
 *      뜰 수 있고 인스턴스가 여러 개면 프로세스 안의 카운터는 허용치를
 *      인스턴스 수만큼 곱한다 — 조용히, 그리고 하필 부하가 걸릴 때.
 *   3. 코드 해시와 소금이 DB 밖으로 나갈 이유가 없다.
 *
 * [HARD] 이 모듈의 호출은 `patients`/`encounters` insert 보다 **먼저**,
 * 그리고 LLM 호출보다 **먼저** 일어나야 한다. 발급되지 않은 접근이 진료 행을
 * 만들지 않는다는 것이 L1 의 요구사항이고, 모델 호출은 돈이다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** DB 함수가 돌려주는 실패 사유. 환자에게는 전부 같은 톤으로 번역된다. */
export type VisitCodeFailure =
  | 'unknown'
  | 'expired'
  | 'consumed'
  | 'exhausted'
  | 'rate_limited'
  /** DB 호출 자체가 실패했을 때. 실패는 곧 거절이다 — fail-closed. */
  | 'unavailable';

export type VisitCodeRedemption =
  | {
      ok: true;
      /** `created` = 이 코드로 새 진료를 만든다. `resumed` = 중단된 그 진료로 돌아간다. */
      mode: 'created' | 'resumed';
      /** 확인만 한 호출에서는 null. */
      codeId: string | null;
      clinicianId: string;
      encounterId: string | null;
      redeemCount: number;
      /**
       * 접수처가 코드를 발급하면서 미리 등록한 환자 (0019). 익명 코드는 null.
       *
       * 값이 있으면 `/api/intake/start` 는 새 환자 행을 만들지 않고 이 행에
       * 진료를 붙인다 — 만들면 같은 사람이 차트에 둘이 된다.
       */
      patientId: string | null;
      /** 문진 화면의 이름 칸을 미리 채우는 데만 쓴다. 판정에는 쓰이지 않는다. */
      patientName: string | null;
    }
  | { ok: false; reason: VisitCodeFailure };

interface RedeemRow {
  ok?: boolean;
  mode?: string;
  reason?: string;
  codeId?: string | null;
  clinicianId?: string;
  encounterId?: string | null;
  redeemCount?: number;
  patientId?: string | null;
  patientName?: string | null;
}

const FAILURES: readonly VisitCodeFailure[] = [
  'unknown',
  'expired',
  'consumed',
  'exhausted',
  'rate_limited',
  'unavailable'
];

/**
 * 코드를 소모한다(`consume: true`) 또는 소모 없이 확인만 한다(`consume: false`).
 *
 * 확인 전용 호출은 환자가 이름을 적기 **전에** 오타를 잡기 위한 것이다. 같은
 * 함수의 같은 경로를 쓰고 마지막 UPDATE 만 건너뛴다 — 인가 판정을 두 벌로
 * 만들지 않기 위해서다. 실패는 확인 호출에서도 속도 제한 카운터에 잡힌다.
 */
export async function redeemVisitCode(
  supabase: SupabaseClient,
  input: {
    clinicianId: string;
    code: string;
    kioskSlug: string | null;
    consume: boolean;
  }
): Promise<VisitCodeRedemption> {
  const { data, error } = await supabase.rpc('redeem_visit_access_code', {
    p_clinician_id: input.clinicianId,
    p_code: input.code,
    p_kiosk_slug: input.kioskSlug,
    p_consume: input.consume
  });

  if (error) {
    // 조용히 통과시키지 않는다. 코드 검증이 안 되는 상태에서 문진을 여는 것은
    // 검증이 없는 것과 같다.
    console.error(
      `[visitCode] redeem_visit_access_code failed (consume=${input.consume}): ${error.message}`
    );
    return { ok: false, reason: 'unavailable' };
  }

  const row = (data ?? {}) as RedeemRow;

  if (row.ok !== true) {
    const reason = FAILURES.find((r) => r === row.reason) ?? 'unknown';
    return { ok: false, reason };
  }

  if (typeof row.clinicianId !== 'string') {
    console.error('[visitCode] redeem returned ok without a clinician id.');
    return { ok: false, reason: 'unavailable' };
  }

  return {
    ok: true,
    mode: row.mode === 'resumed' ? 'resumed' : 'created',
    codeId: typeof row.codeId === 'string' ? row.codeId : null,
    clinicianId: row.clinicianId,
    encounterId: typeof row.encounterId === 'string' ? row.encounterId : null,
    redeemCount: typeof row.redeemCount === 'number' ? row.redeemCount : 0,
    patientId: typeof row.patientId === 'string' ? row.patientId : null,
    patientName: typeof row.patientName === 'string' ? row.patientName : null
  };
}

/**
 * 소모한 코드를 그 코드가 만든 진료에 묶는다.
 *
 * 한 번만 쓰인다(write-once). 실패해도 진료는 이미 만들어졌으므로 던지지
 * 않고 경고만 남긴다 — 다만 묶이지 않은 코드는 재개(resume)에 쓸 수 없고
 * 새 진료를 한 번 더 만들 수 있게 되므로, 조용히 넘기지 말고 반드시 로그에
 * 남긴다.
 */
export async function bindVisitCodeToEncounter(
  supabase: SupabaseClient,
  codeId: string,
  encounterId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('bind_visit_access_code_encounter', {
    p_code_id: codeId,
    p_encounter_id: encounterId
  });

  if (error) {
    console.error(
      `[visitCode] Failed to bind code ${codeId} to encounter ${encounterId}: ${error.message}`
    );
    return false;
  }
  if (data !== true) {
    console.warn(
      `[visitCode] Code ${codeId} was not bound to encounter ${encounterId} (already bound?).`
    );
    return false;
  }
  return true;
}

/**
 * 환자에게 보여줄 문장.
 *
 * `unknown` 과 `expired` 는 서로 다른 문장을 쓴다. 이 둘은 접수처의 대응이
 * 다르고(다시 불러주기 vs 새로 발급), 어느 쪽이든 환자는 이미 접수처에서
 * 코드를 받아 든 사람이라 "그 코드가 있었는지" 를 알려주는 것이 새로운
 * 정보가 되지 않는다. 반대로 `consumed`/`exhausted`/`rate_limited` 는
 * 대응이 같으므로 뭉뚱그린다.
 */
export function visitCodeMessage(reason: VisitCodeFailure): string {
  switch (reason) {
    case 'expired':
      return '코드 사용 시간이 지났습니다. 접수처에서 새 코드를 받아 주세요.';
    case 'consumed':
      return '이미 사용한 코드입니다. 접수처에서 새 코드를 받아 주세요.';
    case 'exhausted':
      return '이 코드는 더 이상 사용할 수 없습니다. 접수처에서 새 코드를 받아 주세요.';
    case 'rate_limited':
      return '잠시 후 다시 시도해 주세요. 계속되면 접수처에 말씀해 주세요.';
    case 'unavailable':
      return '지금은 문진을 시작할 수 없습니다. 접수처에 말씀해 주세요.';
    case 'unknown':
    default:
      return '코드가 맞지 않습니다. 접수처에서 받은 코드를 다시 확인해 주세요.';
  }
}
