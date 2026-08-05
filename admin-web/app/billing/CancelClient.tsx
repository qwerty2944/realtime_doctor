'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/spinner';

/**
 * 해지 / 해지 취소 (S5).
 *
 * 화면이 반드시 말해야 하는 것은 "언제까지 쓸 수 있는가" 하나다. 해지 버튼을
 * 누른 의사가 가장 먼저 걱정하는 것이 "지금 바로 잘리나?" 이기 때문에, 확인
 * 단계에서 남은 이용 기간을 먼저 보여주고 그다음에 확인을 받는다.
 *
 * 환불 얘기는 여기서 하지 않는다. 계획서대로 중도 환불은 자동화하지 않고
 * 관리자가 포트원 콘솔에서 처리한다.
 */

function fmt(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul'
  });
}

export function CancelClient({
  cancelAtPeriodEnd,
  currentPeriodEnd,
  status
}: {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  status: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // 종결된 구독에는 해지할 것이 없다.
  if (status === 'canceled' || status === 'expired' || status === 'none') return null;
  // 체험 중에는 카드가 없으므로 해지할 예약도 없다.
  if (status === 'trialing') return null;

  async function submit(cancel: boolean) {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel })
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        warning?: string;
        rescheduled?: boolean;
      };
      if (!res.ok || !body.ok) {
        throw new Error(
          body.error === 'period_already_ended'
            ? '이용 기간이 이미 끝나 되돌릴 수 없습니다. 카드를 다시 등록해 주세요.'
            : '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
        );
      }
      if (body.warning === 'schedule_revoke_failed') {
        // 조용히 성공이라고 하지 않는다. 예약이 살아 있으면 청구가 나간다.
        setNote(
          '해지 예약은 접수됐지만 결제사 예약 취소를 확인하지 못했습니다. ' +
            '결제가 발생하면 즉시 환불 처리되니 고객센터로 알려주세요.'
        );
      } else if (body.warning === 'reschedule_failed') {
        setNote('해지를 취소했습니다. 다음 결제 예약은 잠시 후 자동으로 복구됩니다.');
      } else {
        setNote(cancel ? '해지가 예약되었습니다.' : '해지를 취소했습니다. 구독이 계속됩니다.');
      }
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {cancelAtPeriodEnd ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="text-sm font-semibold text-amber-200">해지 예약됨</div>
          <p className="mt-1 text-xs text-amber-100/80">
            {fmt(currentPeriodEnd)}까지 그대로 이용할 수 있고, 그 이후 자동 결제가 중단됩니다.
            추가 결제는 발생하지 않습니다.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(false)}
            className="mt-3 flex items-center gap-2 rounded-md border border-amber-400/60 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-60"
          >
            {busy && <Spinner />}
            해지 취소하고 구독 유지
          </button>
        </div>
      ) : confirming ? (
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <div className="text-sm font-semibold">구독을 해지할까요?</div>
          <p className="mt-2 text-xs text-foreground/70">
            지금 해지해도 <strong className="text-foreground">{fmt(currentPeriodEnd)}</strong>까지는
            그대로 이용할 수 있습니다. 그 이후부터 자동 결제가 중단되고 새 진료를 시작할 수
            없게 됩니다. 저장된 진료 기록의 열람과 내보내기는 해지 후에도 계속 가능합니다.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(true)}
              className="flex items-center gap-2 rounded-md border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/15 disabled:opacity-60"
            >
              {busy && <Spinner />}
              기간 종료일에 해지
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground/70 hover:bg-muted"
            >
              그대로 두기
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setErr(null);
            setNote(null);
            setConfirming(true);
          }}
          className="text-xs text-foreground/50 underline underline-offset-2 hover:text-foreground/80"
        >
          구독 해지
        </button>
      )}

      {err && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      {note && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground/70">
          {note}
        </div>
      )}
    </div>
  );
}
