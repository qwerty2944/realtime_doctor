import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  WAITING_STATUSES,
  type Encounter,
  type EncounterStatus,
  type IntakeResult,
  type Patient,
  type PatientDetail,
  type WaitingEncounter
} from '../shared/types.js';
import { getCurrentUser } from './auth.js';
import { getSupabase } from './supabaseClient.js';

/**
 * 환자 대기목록 / 환자 상세 조회.
 *
 * 문진은 별도 웹앱(키오스크)이 담당하고, 이 앱은 그 결과를 읽기만 한다.
 * 데이터는 PHI 이므로 로그인 상태에서만 조회하고 사인아웃 시 전부 버린다.
 */

interface WaitingRow {
  id: string;
  patient_id: string;
  status: EncounterStatus;
  red_flag: boolean;
  red_flag_reason: string | null;
  chief_complaint: string | null;
  created_at: string;
  completed_at: string | null;
  patients: { name: string; registration_no: string | null } | null;
  intake_results: IntakeResultRow[] | null;
}

/** 상세 조회 row — 대기목록보다 환자 컬럼을 더 많이 가져온다. */
interface DetailRow extends Omit<WaitingRow, 'patients' | 'intake_results'> {
  patients: {
    id: string;
    name: string;
    birth_date: string | null;
    registration_no: string | null;
    phone: string | null;
    created_at: string;
  } | null;
}

interface IntakeResultRow {
  id?: string;
  encounter_id?: string;
  soap_json: Record<string, unknown> | null;
  differentials_json: unknown[] | null;
  recommended_tests_json: unknown[] | null;
  version: number;
  created_at: string;
}

const UNKNOWN_PATIENT_NAME = '(이름 미확인)';

function warn(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[patients:${scope}]`, msg);
}

/** 대기목록이 보여주는 것은 항상 최신 버전 문진 결과. */
function latestResult(rows: IntakeResultRow[] | null): IntakeResultRow | null {
  if (!rows || rows.length === 0) return null;
  return [...rows].sort((a, b) => b.version - a.version)[0];
}

function chiefComplaintOf(
  row: { chief_complaint: string | null },
  result: IntakeResultRow | null
): string | null {
  if (row.chief_complaint) return row.chief_complaint;
  const s = result?.soap_json?.s as { chief_complaint?: string } | undefined;
  return s?.chief_complaint ?? null;
}

/**
 * 대기목록 정렬 (righthand `lib/dashboard/sessions.ts` compareWaiting 이식).
 *
 * red flag 를 맨 위에 고정하고, 그 안에서는 오래 기다린 순. 피드가 아니라
 * 대기줄로 읽히게 하는 규칙이다.
 */
function compareWaiting(a: WaitingEncounter, b: WaitingEncounter): number {
  if (a.redFlag !== b.redFlag) return a.redFlag ? -1 : 1;

  const aTime = new Date(a.completedAt ?? a.createdAt).getTime();
  const bTime = new Date(b.completedAt ?? b.createdAt).getTime();
  return aTime - bTime;
}

function toIntakeResult(
  encounterId: string,
  row: IntakeResultRow | null
): IntakeResult | null {
  if (!row) return null;
  return {
    id: row.id ?? '',
    encounterId: row.encounter_id ?? encounterId,
    soap: row.soap_json ?? {},
    differentials: row.differentials_json ?? [],
    recommendedTests: row.recommended_tests_json ?? [],
    version: row.version,
    createdAt: row.created_at
  };
}

/**
 * 대기 중인 진료 목록. 미로그인/DB 미설정/조회 실패는 빈 배열로 떨어뜨린다
 * (대기목록은 보조 화면이라 예외로 앱 흐름을 막지 않는다).
 */
export async function listWaitingEncounters(): Promise<WaitingEncounter[]> {
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('encounters')
      .select(
        'id, patient_id, status, red_flag, red_flag_reason, chief_complaint, created_at, completed_at, ' +
          'patients (name, registration_no), ' +
          'intake_results (soap_json, differentials_json, recommended_tests_json, version, created_at)'
      )
      .eq('user_id', user.id)
      .in('status', WAITING_STATUSES)
      .order('created_at', { ascending: true });
    if (error) {
      warn('listWaitingEncounters', error.message);
      return [];
    }
    const rows = (data ?? []) as unknown as WaitingRow[];
    return rows
      .map((row): WaitingEncounter => {
        const result = latestResult(row.intake_results);
        return {
          encounterId: row.id,
          patientId: row.patient_id,
          status: row.status,
          redFlag: row.red_flag,
          redFlagReason: row.red_flag_reason,
          patientName: row.patients?.name ?? UNKNOWN_PATIENT_NAME,
          registrationNo: row.patients?.registration_no ?? null,
          chiefComplaint: chiefComplaintOf(row, result),
          createdAt: row.created_at,
          completedAt: row.completed_at ?? result?.created_at ?? null
        };
      })
      .sort(compareWaiting);
  } catch (err) {
    warn('listWaitingEncounters', err);
    return [];
  }
}

/** 환자 상세 — 진료 + 환자 + 최신 문진 결과. 없으면 null. */
export async function loadPatientDetail(
  encounterId: string
): Promise<PatientDetail | null> {
  const user = getCurrentUser();
  const supabase = getSupabase();
  if (!user || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from('encounters')
      .select(
        'id, patient_id, status, red_flag, red_flag_reason, chief_complaint, created_at, completed_at, ' +
          'patients (id, name, birth_date, registration_no, phone, created_at)'
      )
      .eq('id', encounterId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      warn('loadPatientDetail:encounter', error.message);
      return null;
    }
    if (!data) return null;

    const row = data as unknown as DetailRow;

    const { data: resultData, error: resultError } = await supabase
      .from('intake_results')
      .select(
        'id, encounter_id, soap_json, differentials_json, recommended_tests_json, version, created_at'
      )
      .eq('encounter_id', encounterId)
      .order('version', { ascending: false })
      .limit(1);
    if (resultError) warn('loadPatientDetail:result', resultError.message);

    const resultRow = ((resultData ?? []) as IntakeResultRow[])[0] ?? null;

    const patient: Patient = {
      id: row.patients?.id ?? row.patient_id,
      name: row.patients?.name ?? UNKNOWN_PATIENT_NAME,
      birthDate: row.patients?.birth_date ?? null,
      registrationNo: row.patients?.registration_no ?? null,
      phone: row.patients?.phone ?? null,
      createdAt: row.patients?.created_at ?? row.created_at
    };
    const encounter: Encounter = {
      id: row.id,
      patientId: row.patient_id,
      status: row.status,
      redFlag: row.red_flag,
      redFlagReason: row.red_flag_reason,
      chiefComplaint: chiefComplaintOf(row, resultRow),
      createdAt: row.created_at,
      completedAt: row.completed_at ?? null
    };
    return {
      patient,
      encounter,
      intakeResult: toIntakeResult(encounterId, resultRow)
    };
  } catch (err) {
    warn('loadPatientDetail', err);
    return null;
  }
}

// ── 선택된 환자 ─────────────────────────────────────────────────────────
// 상세까지 여기서 들고 있는다. 나중에 뜬 창이 getActiveDetail 로 스스로 채울 수
// 있어야 하고(재조회하면 창 수만큼 쿼리가 나간다), 사인아웃 때 함께 버린다.

let activeEncounterId: string | null = null;
let activeDetail: PatientDetail | null = null;

export function getActiveEncounterId(): string | null {
  return activeEncounterId;
}

/** 현재 선택된 환자 상세. 선택이 없으면 null. */
export function getActiveDetail(): PatientDetail | null {
  return activeDetail;
}

/** 환자 선택. encounterId 가 null 이면 선택 해제(실시간 녹취 모드). */
export async function selectEncounter(
  encounterId: string | null
): Promise<PatientDetail | null> {
  if (!encounterId) {
    activeEncounterId = null;
    activeDetail = null;
    return null;
  }
  const detail = await loadPatientDetail(encounterId);
  activeEncounterId = detail ? encounterId : null;
  activeDetail = detail;
  return detail;
}

// ── Realtime 구독 ───────────────────────────────────────────────────────

let channel: RealtimeChannel | null = null;
/** 재조회 중 재진입 방지 — 이벤트가 몰려도 조회는 한 번에 하나만. */
let refreshing = false;
let refreshQueued = false;

export interface WaitingSubscription {
  /** 수동 새로고침 (에러 배너의 "다시 시도"). */
  refresh: () => Promise<void>;
  stop: () => void;
}

/**
 * `encounters` 변경 구독.
 *
 * 이벤트는 **알림용으로만** 쓰고 payload 는 보지 않는다. 조인된 환자명·주소가
 * 이벤트에 실려오지 않으므로 어차피 전체 재조회가 필요하다.
 * 채널 에러(CHANNEL_ERROR / TIMED_OUT)는 onError 로 올려 UI 가 배너 + 수동
 * 새로고침을 띄울 수 있게 한다.
 */
export function subscribeWaitingChanges(
  onChange: (items: WaitingEncounter[]) => void,
  onError?: (message: string) => void
): WaitingSubscription {
  stopWaitingSubscription();

  const refresh = async (): Promise<void> => {
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    refreshing = true;
    try {
      onChange(await listWaitingEncounters());
    } catch (err) {
      warn('refresh', err);
    } finally {
      refreshing = false;
      if (refreshQueued) {
        refreshQueued = false;
        void refresh();
      }
    }
  };

  const supabase = getSupabase();
  if (supabase && getCurrentUser()) {
    channel = supabase
      .channel('waiting-encounters')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'encounters' },
        () => {
          void refresh();
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onError?.(
            status === 'TIMED_OUT'
              ? '대기목록 실시간 연결이 시간 초과되었습니다.'
              : '대기목록 실시간 연결이 끊어졌습니다.'
          );
        }
      });
  }

  // 첫 스냅샷은 구독과 무관하게 한 번 채운다.
  void refresh();

  return { refresh, stop: stopWaitingSubscription };
}

export function stopWaitingSubscription(): void {
  refreshing = false;
  refreshQueued = false;
  if (!channel) return;
  const ch = channel;
  channel = null;
  try {
    void getSupabase()?.removeChannel(ch);
  } catch (err) {
    warn('stopWaitingSubscription', err);
  }
}

/** 사인아웃 시 호출 — 구독을 끊고 메모리에 남은 PHI 참조를 비운다. */
export function clearPatientState(): void {
  stopWaitingSubscription();
  activeEncounterId = null;
  activeDetail = null;
}
