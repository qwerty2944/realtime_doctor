import 'server-only';

/**
 * 무코드(walk-in) 문진의 속도 제한 — 서버 전용. SERVER ONLY.
 *
 * 원내에 붙여둔 고정 QR 로 들어오는 경로다. 방문 코드가 없다는 것은 **접근
 * 통제가 하나 사라졌다**는 뜻이므로, 그 자리를 세 가지가 대신한다(근거는
 * 0019 마이그레이션):
 *
 *   1. 출처 주소 + 의사 단위 속도 제한 — 이 파일.
 *   2. `encounters.intake_source = 'walk_in'` — 대기목록에서 "접수처가
 *      보증한 환자" 와 "포스터를 찍은 사람" 이 구별된다.
 *   3. 슬러그는 여전히 라우팅 키일 뿐이다. 담당 의사는 서버가 정한다.
 *
 * [HARD] 판정은 DB 함수가 한다(`record_walk_in_intake_start`). 프로세스 안에서
 * 세면 서버리스 인스턴스 수만큼 허용치가 곱해지고, 하필 부하가 걸릴 때 조용히
 * 그렇게 된다 — 0009 가 실패 카운터를 DB 에 둔 것과 같은 이유다.
 *
 * [HARD] 주소는 저장하지 않는다. 여기서 HMAC 을 씌워 해시만 넘긴다. 두 출처를
 * 구별할 수만 있으면 되고, 진료 기록 옆에 IP 목록을 쌓는 것은 쓸모 없이 위험만
 * 늘리는 일이다.
 */

import { createHmac } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/env';

export type WalkInVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'ip' | 'clinician' | 'unavailable' };

/**
 * 요청에서 클라이언트 주소를 뽑아 해시한다.
 *
 * 주소를 못 찾는 배포가 있을 수 있다(프록시 헤더가 없는 경우). 그때는 빈 값을
 * 돌려주고, DB 함수가 그것을 하나의 버킷으로 묶는다 — 제한이 **더 엄격해지는**
 * 방향이므로 안전한 실패다.
 */
export function hashClientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const address =
    forwarded.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    '';
  if (address === '') return '';

  // 토큰 서명과 같은 비밀을 쓴다. 해시가 무지개표로 되돌려지지 않게 하는 것이
  // 목적이고, 이 값에는 별도 수명 관리가 필요 없다.
  return createHmac('sha256', requireEnv('KIOSK_TOKEN_SECRET'))
    .update(address)
    .digest('hex');
}

/**
 * 무코드 시작 한 건을 세고 판정한다.
 *
 * [HARD] fail-closed. DB 호출이 실패하면 통과시키지 않는다 — 속도 제한이
 * 동작하지 않는 상태에서 무코드 문진을 여는 것은 제한이 없는 것과 같다
 * (`visitCodeServer.ts` 의 `unavailable` 과 같은 규칙).
 */
export async function recordWalkInStart(
  supabase: SupabaseClient,
  input: { clinicianId: string; ipHash: string }
): Promise<WalkInVerdict> {
  const { data, error } = await supabase.rpc('record_walk_in_intake_start', {
    p_clinician_id: input.clinicianId,
    p_ip_hash: input.ipHash
  });

  if (error) {
    console.error(
      `[walkIn] record_walk_in_intake_start failed: ${error.message}`
    );
    return { allowed: false, reason: 'unavailable' };
  }

  const row = (data ?? {}) as { allowed?: boolean; reason?: string };
  if (row.allowed === true) return { allowed: true };

  return {
    allowed: false,
    reason: row.reason === 'clinician' ? 'clinician' : row.reason === 'ip' ? 'ip' : 'unavailable'
  };
}

/** 환자에게 보여줄 문장. 어느 한도에 걸렸는지는 알려주지 않는다. */
export function walkInMessage(reason: 'ip' | 'clinician' | 'unavailable'): string {
  if (reason === 'unavailable') {
    return '지금은 문진을 시작할 수 없습니다. 접수처에 말씀해 주세요.';
  }
  return '잠시 후 다시 시도해 주세요. 계속되면 접수처에 말씀해 주세요.';
}
