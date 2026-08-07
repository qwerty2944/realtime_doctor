'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLAN, formatKrw } from '@/lib/billing/plan';
import { Spinner } from '@/components/spinner';
import { withBasePath } from '@/lib/base-path';

/**
 * 카드 등록 흐름 (S3).
 *
 *   1) 확인 단계에서 **실제 청구 금액 77,000원**을 명시한다. 표기(70,000원 VAT
 *      별도)와 청구가 다르므로, 결제창에 뜨는 금액과 화면의 금액이 어긋나면
 *      바로 이탈·문의로 이어진다.
 *   2) 서버에서 1회용 issueId 를 받는다.
 *   3) 포트원 브라우저 SDK 로 빌링키를 발급한다.
 *   4) 결과를 서버로 넘긴다. 서버가 포트원에 직접 확인한 뒤 결제한다.
 *      여기서 성공했다고 화면이 말하는 것만으로는 아무것도 활성화되지 않는다.
 */

type Phase = 'idle' | 'confirm' | 'working';

export function BillingClient({ hasCard, status }: { hasCard: boolean; status: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function start() {
    setErr(null);
    setDone(null);
    setPhase('working');
    try {
      const issueRes = await fetch(withBasePath('/api/billing/issue-id'), { method: 'POST' });
      if (issueRes.status === 503) {
        // 서버가 아직 포트원 자격을 갖고 있지 않다. 화면은 이 상태에서 버튼을
        // 렌더링하지 않지만(page.tsx), 오래 열어 둔 탭이 여기 올 수 있다.
        // "다시 시도"를 권하지 않는다 -- 다시 시도해도 되지 않는다.
        throw new Error('결제 시스템이 아직 준비되지 않았습니다. 준비되면 안내드리겠습니다.');
      }
      if (!issueRes.ok) throw new Error('결제 준비에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      const issue = (await issueRes.json()) as {
        issueId: string;
        customerId: string;
        storeId: string;
        channelKey: string;
      };

      // 브라우저 SDK 는 클라이언트에서만 로드한다 (window 의존).
      const PortOne = await import('@portone/browser-sdk/v2');
      const result = await PortOne.requestIssueBillingKey({
        storeId: issue.storeId,
        channelKey: issue.channelKey,
        billingKeyMethod: 'CARD',
        issueId: issue.issueId,
        customer: { customerId: issue.customerId }
      });

      if (!result || result.code !== undefined) {
        // 사용자가 창을 닫았거나 PG 가 거절했다. 서버는 아무것도 하지 않는다.
        throw new Error(result?.message ?? '카드 등록이 취소되었습니다.');
      }

      const completeRes = await fetch(withBasePath('/api/billing/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.issueId, billingKey: result.billingKey })
      });
      const body = (await completeRes.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        duplicate?: boolean;
      };
      if (!completeRes.ok || !body.ok) {
        throw new Error(
          body.error === 'payment_failed'
            ? `결제가 거절되었습니다. ${body.message ?? ''}`.trim()
            : '결제 처리에 실패했습니다. 카드 정보를 확인한 뒤 다시 시도해 주세요.'
        );
      }
      setDone(
        body.duplicate
          ? '이미 처리된 요청입니다.'
          : `결제가 완료되었습니다. (${formatKrw(PLAN.totalKrw)})`
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase('idle');
    }
  }

  const label = hasCard ? '카드 변경' : status === 'trialing' ? '구독 시작하기' : '카드 등록하고 구독하기';

  return (
    <div className="space-y-3">
      {phase !== 'confirm' ? (
        <button
          type="button"
          disabled={phase === 'working'}
          onClick={() => {
            setErr(null);
            setDone(null);
            setPhase('confirm');
          }}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {phase === 'working' && <Spinner />}
          {phase === 'working' ? '처리 중…' : label}
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <div className="text-sm font-semibold">결제 내용 확인</div>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-foreground/60">상품</dt>
              <dd>{PLAN.orderName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-foreground/60">이용료 (VAT 별도)</dt>
              <dd>{formatKrw(PLAN.priceKrw)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-foreground/60">부가세</dt>
              <dd>{formatKrw(PLAN.vatKrw)}</dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>지금 결제되는 금액</dt>
              <dd>{formatKrw(PLAN.totalKrw)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-foreground/60">
            등록한 카드로 매월 {formatKrw(PLAN.totalKrw)}이 자동 결제됩니다. 언제든지 해지할 수
            있습니다.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={start}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent/90"
            >
              카드 등록하고 {formatKrw(PLAN.totalKrw)} 결제
            </button>
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground/70 hover:bg-muted"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      {done && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {done} 앱으로 돌아가면 잠금이 해제됩니다.
        </div>
      )}
    </div>
  );
}
