import { buildKioskIntakeUrl, formatVisitCode } from '../shared/visitCode.js';
import type {
  IssuedVisitCode,
  IssueVisitCodeResult,
  PatientVisitCodeInput,
  VisitCodeAlimtalkResult,
  VisitCodeSettings
} from '../shared/types.js';
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
  patientId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
}

/**
 * RPC 반환값 → 화면이 쓰는 모양.
 *
 * 익명 코드와 환자 등록형 코드가 같은 함수를 지난다. 두 벌로 만들면 URL 조립이
 * 갈라지고, 갈라진 둘 중 하나만 고쳐지는 날이 온다(E1 규칙).
 */
function toIssued(row: IssueRow, settings: VisitCodeSettings): IssuedVisitCode | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.code !== 'string' ||
    row.code === '' ||
    typeof row.expiresAt !== 'string'
  ) {
    return null;
  }

  return {
    id: row.id,
    code: row.code,
    formatted: formatVisitCode(row.code),
    expiresAt: row.expiresAt,
    ttlSeconds: typeof row.ttlSeconds === 'number' ? row.ttlSeconds : 0,
    // 키오스크 주소가 설정돼 있지 않으면 null. 화면은 QR 대신 설정 안내를
    // 띄운다 — 열리지 않는 QR 은 환자 앞에서 실패한다.
    url: buildKioskIntakeUrl(settings.kioskUrl, row.code, settings.kioskSlug),
    patientId: typeof row.patientId === 'string' ? row.patientId : null,
    patientName: typeof row.patientName === 'string' ? row.patientName : null,
    patientPhone: typeof row.patientPhone === 'string' ? row.patientPhone : null
  };
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

    const issued = toIssued((data ?? {}) as IssueRow, settings);
    if (!issued) {
      warn('issue', 'RPC returned no code');
      return { ok: false, error: 'failed' };
    }

    return { ok: true, issued };
  } catch (err) {
    warn('issue', err);
    return { ok: false, error: 'failed' };
  }
}

/**
 * 환자를 등록하고 그 환자에게 묶인 코드를 발급한다 (0019).
 *
 * 익명 코드와 다른 점은 두 가지다: 환자 행이 발급 시점에 생기고(그래서 링크를
 * 미리 보낼 수 있다), 기본 수명이 24시간이다(전날 저녁에 보낸 링크가 아침에
 * 죽어 있으면 환자는 자기 탓을 하고 다시 시도하지 않는다).
 *
 * 이름·전화번호 검증은 DB 함수가 한다. 여기서 한 번 더 판정하지 않고 거절
 * 사유만 화면이 쓸 수 있는 값으로 옮긴다.
 */
export async function issuePatientVisitCode(
  input: PatientVisitCodeInput
): Promise<IssueVisitCodeResult> {
  const user = getCurrentUser();
  if (!user) return { ok: false, error: 'signed-out' };

  const name = input.name.trim();
  if (name === '') return { ok: false, error: 'invalid-input' };

  const settings = getVisitCodeSettings();

  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'failed' };

  try {
    const { data, error } = await supabase.rpc('issue_patient_visit_code', {
      p_kiosk_slug: settings.kioskSlug,
      p_patient_name: name,
      p_patient_phone: input.phone?.trim() ? input.phone.trim() : null,
      p_ttl_seconds: null
    });

    if (error) {
      warn('issue-patient', error.message ?? 'unknown');
      if (error.code === '53400' || (error.message ?? '').includes('too many unused')) {
        return { ok: false, error: 'too-many-live' };
      }
      // 22023 = invalid_parameter_value. 이름이 비었거나 전화번호 형식이
      // 아니라는 뜻이고, 대응이 "다시 시도" 가 아니라 "입력을 고쳐라" 다.
      if (error.code === '22023') return { ok: false, error: 'invalid-input' };
      return { ok: false, error: 'failed' };
    }

    const issued = toIssued((data ?? {}) as IssueRow, settings);
    if (!issued) {
      warn('issue-patient', 'RPC returned no code');
      return { ok: false, error: 'failed' };
    }

    return { ok: true, issued };
  } catch (err) {
    warn('issue-patient', err);
    return { ok: false, error: 'failed' };
  }
}

/**
 * 발급한 환자 링크를 알림톡으로 보낸다.
 *
 * **발송은 이 앱이 하지 않는다.** 키오스크 서버의 `/api/notify/alimtalk` 가
 * 한다. 이유는 A1 과 같다: Solapi 자격증명이 데스크톱 번들에 들어가면 빌드를
 * 가진 누구나 우리 계정으로 문자를 보낼 수 있고, 유출되면 전 설치본을 다시
 * 배포하기 전에는 회수할 수 없다.
 *
 * 그래서 이 함수가 보내는 것은 (1) 현재 로그인 세션의 JWT, (2) 코드 행 id,
 * (3) 링크뿐이다. 서버가 JWT 로 사람을 확인하고, 그 사람 소유의 코드가 맞는지
 * DB 에서 다시 확인하고, **전화번호는 DB 에서 읽는다** — 클라이언트가 보낸
 * 번호로 보내면 그 소유 확인이 아무것도 지키지 못한다.
 *
 * 링크만은 여기서 보낼 수밖에 없다. 평문 코드는 발급 RPC 의 반환값에만
 * 존재하고 어디에도 저장되지 않으므로(0009) 서버가 재구성할 방법이 없다.
 * 대신 서버가 그 링크의 호스트·경로가 자기 자신의 `/intake` 인지 확인한다.
 */
export async function sendVisitCodeAlimtalk(
  codeId: string,
  link: string
): Promise<VisitCodeAlimtalkResult> {
  const user = getCurrentUser();
  if (!user) return { ok: false, error: 'signed-out' };

  const settings = getVisitCodeSettings();
  const base = settings.kioskUrl.trim().replace(/\/+$/, '');
  // 주소가 없으면 보낼 링크도 없다. 조용히 성공했다고 말하지 않는다.
  if (base === '') return { ok: false, error: 'no-kiosk-url' };

  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: 'failed' };

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { ok: false, error: 'signed-out' };

    const response = await fetch(`${base}/api/notify/alimtalk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ codeId, link })
    });

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      configured?: boolean;
      error?: string;
      reason?: string;
    };

    // 미설정은 실패가 아니다 — 화면은 "링크를 복사해서 보내세요" 로 안내한다.
    if (body.configured === false) return { ok: false, error: 'not-configured' };

    if (!response.ok || body.ok !== true) {
      warn('alimtalk', `${response.status} ${body.error ?? body.reason ?? 'unknown'}`);
      if (body.reason === 'no-phone') return { ok: false, error: 'no-phone' };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'rejected', message: body.error };
      }
      return { ok: false, error: 'failed', message: body.error };
    }

    return { ok: true, sent: true };
  } catch (err) {
    warn('alimtalk', err);
    return { ok: false, error: 'failed' };
  }
}
