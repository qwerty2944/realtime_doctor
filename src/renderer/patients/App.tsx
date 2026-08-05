import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, Stethoscope, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { OverlayShell } from '../shared/OverlayShell';
import { useLang, useT } from '../shared/i18n';
import type { AuthState, Language, WaitingEncounter } from '../../shared/types';

/**
 * 대기목록 오버레이.
 *
 * 데이터는 main 이 소유한다 — Realtime 이벤트는 알림용으로만 쓰이고 실제 목록은
 * main 이 조인 조회해 broadcast 한다. 정렬(레드플래그 상단 고정 → 오래 기다린 순)
 * 도 main 이 끝낸 상태이므로 여기서 다시 정렬하지 않는다.
 */

const WAITING_KEY = ['waiting-encounters'] as const;

/** 경과 시간 표시는 재조회 없이 이 주기로만 다시 그린다. */
const TICK_MS = 30_000;

/** 대기 시작 시각 — 문진 완료 시각이 있으면 그것, 없으면 진료 생성 시각. */
function waitSince(item: WaitingEncounter): number {
  return new Date(item.completedAt ?? item.createdAt).getTime();
}

function formatWait(sinceMs: number, now: number, lang: Language): string {
  const minutes = Math.max(0, Math.floor((now - sinceMs) / 60_000));
  if (minutes < 1) return lang === 'en' ? 'just now' : '방금';
  if (minutes < 60) return lang === 'en' ? `${minutes}m` : `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (lang === 'en') return m === 0 ? `${h}h` : `${h}h ${m}m`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** 오래 기다릴수록 눈에 띄게 — 30분/60분을 경계로 색을 올린다. */
function waitTone(sinceMs: number, now: number): string {
  const minutes = (now - sinceMs) / 60_000;
  if (minutes >= 60) return 'text-red-300';
  if (minutes >= 30) return 'text-amber-300';
  return 'text-muted-foreground';
}

export default function PatientsApp() {
  const t = useT();
  const lang = useLang();
  const queryClient = useQueryClient();

  const [auth, setAuth] = useState<AuthState>({ status: 'signed-out' });
  const [channelError, setChannelError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const { data, isFetching, refetch } = useQuery<WaitingEncounter[]>({
    queryKey: WAITING_KEY,
    queryFn: () => window.api.patients.listWaiting(),
    initialData: []
  });
  const items = data ?? [];

  // 대기 시간 표시만 갱신 — 목록 재조회는 하지 않는다.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void window.api.auth.getState().then(setAuth);
    return window.api.auth.onStateChange(setAuth);
  }, []);

  // main 의 broadcast 를 캐시에 그대로 반영. error 가 실려와도 items 는 마지막으로
  // 성공한 목록이므로 화면을 비우지 않는다.
  useEffect(() => {
    return window.api.patients.onWaitingChange((payload) => {
      queryClient.setQueryData<WaitingEncounter[]>(WAITING_KEY, payload.items);
      setChannelError(payload.error);
    });
  }, [queryClient]);

  // 선택 상태의 소유자는 main 이다. 사인아웃 등으로 main 이 선택을 비우면
  // 카드 강조도 함께 풀려야 하므로 broadcast 를 그대로 따라간다.
  useEffect(() => {
    void window.api.patients
      .getActive()
      .then((detail) => setSelected(detail?.encounter.id ?? null));
    return window.api.patients.onActiveChange((detail) =>
      setSelected(detail?.encounter.id ?? null)
    );
  }, []);

  const manualRefresh = useCallback(() => {
    void refetch().then((res) => {
      if (!res.isError) setChannelError(null);
    });
  }, [refetch]);

  const pick = useCallback((encounterId: string) => {
    // 같은 카드를 다시 누르면 선택 해제 → 실시간 녹취 모드.
    setSelected((prev) => {
      const next = prev === encounterId ? null : encounterId;
      // main 이 상세를 불러 전 창에 broadcast 한다. 조회 실패로 선택이 성립하지
      // 않으면 돌아온 값으로 강조를 되돌린다.
      void window.api.patients
        .select(next)
        .then((detail) => setSelected(detail?.encounter.id ?? null));
      return next;
    });
  }, []);

  const redFlagCount = items.filter((i) => i.redFlag).length;
  const signedOut = auth.status === 'signed-out';

  return (
    <OverlayShell
      title={t('window.patients')}
      shortcutId="togglePatients"
      badge={
        <Badge variant="outline" className="gap-1">
          <Users className="h-2.5 w-2.5" />
          {items.length}
        </Badge>
      }
      actions={
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={signedOut || isFetching}
          onClick={manualRefresh}
          data-no-drag
        >
          <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
          {t('patients.refresh')}
        </Button>
      }
    >
      {channelError && (
        <div className="m-2 mb-0 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/15 p-2 text-[11px] text-amber-100">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1">{channelError}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 shrink-0 px-1.5 text-[10px]"
            onClick={manualRefresh}
          >
            {t('patients.refresh')}
          </Button>
        </div>
      )}

      {!signedOut && items.length > 0 && (
        <div className="px-3 pt-2 text-[10px] text-muted-foreground">
          {t('patients.waitingCount')}{' '}
          <span className="font-semibold text-foreground">{items.length}</span>
          {t('patients.unit')}
          {redFlagCount > 0 && (
            <>
              {' · '}
              {t('patients.redFlagCount')}{' '}
              <span className="font-semibold text-red-300">{redFlagCount}</span>
              {t('patients.unit')}
            </>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="space-y-1.5 p-2">
          {signedOut && (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {t('patients.signedOut')}
            </p>
          )}
          {!signedOut && items.length === 0 && (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {t('patients.empty')}
            </p>
          )}
          {!signedOut &&
            items.map((item) => {
              const since = waitSince(item);
              const isSelected = selected === item.encounterId;
              return (
                <Card
                  key={item.encounterId}
                  onClick={() => pick(item.encounterId)}
                  className={cn(
                    'cursor-pointer overflow-hidden transition-colors',
                    item.redFlag
                      ? 'border-red-500/60 ring-1 ring-red-500/25'
                      : 'hover:border-primary/40',
                    isSelected && 'border-primary bg-primary/10 ring-1 ring-primary'
                  )}
                >
                  {item.redFlag && (
                    // 색만으로 구분하지 않도록 아이콘 + 텍스트를 함께 둔다.
                    <div className="flex items-center gap-1 bg-red-500/25 px-2 py-1 text-[10px] font-semibold text-red-100">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {t('patients.redFlag')} ·{' '}
                        {item.redFlagReason ?? t('patients.redFlagFallback')}
                      </span>
                    </div>
                  )}
                  <CardContent className="space-y-1 p-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-xs font-semibold">
                        {item.patientName}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {t('patients.registrationNo')}{' '}
                        {item.registrationNo ?? t('patients.registrationNoNone')}
                      </span>
                      <span
                        className={cn(
                          'ml-auto shrink-0 text-[10px] tabular-nums',
                          waitTone(since, now)
                        )}
                      >
                        {t('patients.waitPrefix')} {formatWait(since, now, lang)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">
                        {item.chiefComplaint ?? t('patients.chiefComplaintNone')}
                      </p>
                      {item.status === 'in_consult' && (
                        <Badge variant="secondary" className="shrink-0 gap-1">
                          <Stethoscope className="h-2.5 w-2.5" />
                          {t('patients.inConsult')}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
