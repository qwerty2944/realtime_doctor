import { buildKioskIntakeUrl, formatVisitCode } from '../shared/visitCode.js';
import type { IssuedVisitCode, IssueVisitCodeResult, VisitCodeSettings } from '../shared/types.js';
import { getCurrentUser } from './auth.js';
import { getVisitCodeSettings } from './store.js';
import { getSupabase } from './supabaseClient.js';

/**
 * 방문 코드 발급 (L1).
 *
 * 배포구조·책임등급 문서 4장: 키오스크가 공개 주소를 갖는 순간 슬러그만으로
 * 문진을 시작할 수 있어서는 안 된다. 접수처가 방문마다 코드를 발급하고,
 * 그 코드가 있어야 문진이 시작된다.
 *
 * **왜 발급이 이 앱인가**
 * 스태프가 쓰는 표면이 이것뿐이기 때문이다. admin-web 은 아직 배포되지
 * 않았고(S3~S5 내내 그랬다), 배포된다 해도 접수처가 환자를 앞에 두고
 * 브라우저를 따로 여는 흐름은 마찰이 가장 큰 지점에 마찰을 더한다 —
 * 0005 의 기기 한도 다이얼로그를 dock 에 둔 것과 같은 판단이다.
 * 원장 계정으로 앱이 이미 떠 있고, 그 세션이 곧 "누구 앞으로 발급하는가" 다.
 *
 * **코드를 만드는 것은 여기가 아니다.** 생성·해시·만료·수량 제한은 전부 DB
 * 함수 `issue_visit_access_code()` 안에 있다. 이 파일은 그 함수를 부르고
 * 결과를 화면이 쓸 모양으로 바꾼다. 평문 코드는 그 반환값에만 존재하고
 * 어디에도 저장하지 않는다 — 다시 보려면 새로 발급해야 한다.
 */

function warn(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[visitCodes:${scope}]`, msg);
}

interface IssueRow {
  id?: string;
  code?: string;
  kioskSlug?: string | null;
  expiresAt?: string;
  ttlSeconds?: number;
}

export function loadVisitCodeSettings(): VisitCodeSettings {
  return getVisitCodeSettings();
}

/**
 * 코드 하나를 발급한다.
 *
 * 실패를 예외로 던지지 않고 값으로 돌려준다. 이 호출은 환자가 접수대 앞에
 * 서 있는 동안 일어나고, 화면은 "왜 안 되는지" 를 한 문장으로 말할 수 있어야
 * 한다(로그인 안 됨 / 미사용 코드가 너무 많음 / 네트워크).
 */
export async function issueVisitCode(): Promise<IssueVisitCodeResult> {
  const user = getCurrentUser();
  if (!user) return { ok: false, error: 'signed-out' };

  const settings = getVisitCodeSettings();

  const supabase = getSupabase();
  // DB 가 설정되지 않은 빌드. 코드 없이 문진을 열 수 있게 하는 우회로는
  // 만들지 않는다 — 발급이 안 되면 문진도 시작되지 않는 것이 맞다.
  if (!supabase) return { ok: false, error: 'failed' };

  try {
    const { data, error } = await supabase.rpc('issue_visit_access_code', {
      p_kiosk_slug: settings.kioskSlug,
      p_ttl_seconds: null
    });

    if (error) {
      warn('issue', error.message ?? 'unknown');
      // 53400 = configuration_limit_exceeded. 미사용 코드가 한도까지 쌓였다는
      // 뜻이고, 그건 네트워크 오류와 대응이 완전히 다르므로 구분해 넘긴다.
      if (error.code === '53400' || (error.message ?? '').includes('too many unused')) {
        return { ok: false, error: 'too-many-live' };
      }
      return { ok: false, error: 'failed' };
    }

    const row = (data ?? {}) as IssueRow;
    if (typeof row.code !== 'string' || row.code === '' || typeof row.expiresAt !== 'string') {
      warn('issue', 'RPC returned no code');
      return { ok: false, error: 'failed' };
    }

    const issued: IssuedVisitCode = {
      code: row.code,
      formatted: formatVisitCode(row.code),
      expiresAt: row.expiresAt,
      ttlSeconds: typeof row.ttlSeconds === 'number' ? row.ttlSeconds : 0,
      // 키오스크 주소가 설정돼 있지 않으면 null. 화면은 QR 대신 설정 안내를
      // 띄운다 — 열리지 않는 QR 은 환자 앞에서 실패한다.
      url: buildKioskIntakeUrl(settings.kioskUrl, row.code, settings.kioskSlug)
    };

    return { ok: true, issued };
  } catch (err) {
    warn('issue', err);
    return { ok: false, error: 'failed' };
  }
}
