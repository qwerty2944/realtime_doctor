import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useT } from '../shared/i18n';
import type {
  CareActivityBackfillResult,
  CareActivityDefinitionView
} from '../../shared/careActivities';

/**
 * 임상 검토 (B5).
 *
 * **왜 이 화면이 필요한가.** B4 까지 정의를 검토 상태로 올리는 길은
 * service_role SQL 뿐이었다. 손으로 DB 를 고쳐줄 사람이 없으면 이 기능은
 * 누구에게도 켜지지 않는다 — 설계상 아무것도 뜨지 않는 상태가 영구히 유지된다.
 *
 * **왜 앱 안(dock)인가.** admin-web 은 아직 배포되지 않았고, 배포돼도 이
 * 판단을 내리는 사람은 이미 앱을 켜 둔 원장 본인이다. 리포트 다이얼로그와
 * 같은 이유이고, 같은 자리에 둔다.
 *
 * **왜 규칙 전문을 보여주는가.** 검토는 임상 책임을 지는 행위다. 이름과
 * 스위치만 보여주면 무엇을 승인했는지 모르는 채로 승인하게 된다. 단서어,
 * 부정어, 화자 조건, 문턱 세 개가 전부 화면에 나온다.
 *
 * [HARD] 이 화면의 결정은 **이 계정에만** 적용된다. 정의는 공용 템플릿이라
 * 전역 상태로 두면 한 사람의 판단이 다른 의원의 탐지를 켠다(0008).
 *
 * [HARD] 되돌릴 수 있다. 철회하면 이후 탐지가 멈추고, 이미 저장된 기록은
 * 그대로 남는다 — 지난달에 무엇을 보여줬는지는 계속 답할 수 있어야 한다.
 */

function RuleDetail({ view }: { view: CareActivityDefinitionView }) {
  const t = useT();
  const d = view.def;
  const row = (label: string, value: string) => (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1 break-words">{value}</span>
    </div>
  );
  const speakerLabel =
    d.requiredSpeaker === 'doctor'
      ? t('review.speakerDoctor')
      : d.requiredSpeaker === 'patient'
        ? t('review.speakerPatient')
        : t('review.speakerAny');

  return (
    <div className="mt-1.5 space-y-0.5 rounded bg-muted/30 p-2 text-[10px] leading-snug">
      {row(t('review.ruleCues'), d.cueTerms.join(' · '))}
      {row(
        t('review.ruleNegations'),
        d.negationTerms.length > 0 ? d.negationTerms.join(' · ') : t('review.none')
      )}
      {row(t('review.ruleSpeaker'), speakerLabel)}
      {row(t('review.ruleMinCues'), String(d.minDistinctCues))}
      {row(t('review.ruleMinUtterances'), String(d.minUtterances))}
      {row(t('review.ruleMinDuration'), `${d.minDurationSeconds}s`)}
      {row(t('review.ruleVersionLabel'), `v${d.ruleVersion}`)}
    </div>
  );
}

function DefinitionCard({
  view,
  onChanged
}: {
  view: CareActivityDefinitionView;
  onChanged: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewed = view.def.reviewStatus === 'reviewed';

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const res = await window.api.careActivities.setReview({
      activityCode: view.def.code,
      // 화면에서 실제로 읽은 규칙 버전을 그대로 보낸다. 그 사이 규칙이
      // 바뀌었으면 서버가 거절한다 — 읽지 않은 규칙이 승인되는 경로를
      // 만들지 않기 위해서다.
      ruleVersion: view.def.ruleVersion,
      reviewed: !reviewed
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onChanged();
  };

  return (
    <div className="rounded border border-border/70 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block truncate text-[12px] font-medium">{view.def.labelKo}</span>
          <span className="block font-mono text-[9px] text-muted-foreground">
            {view.def.code}
            {view.def.category ? ` · ${view.def.category}` : ''}
          </span>
        </div>
        <Button
          size="sm"
          variant={reviewed ? 'default' : 'outline'}
          disabled={busy}
          onClick={() => void toggle()}
          className="h-7 shrink-0 px-2 text-[11px]"
        >
          {reviewed ? t('review.unmark') : t('review.mark')}
        </Button>
      </div>

      {view.def.descriptionKo && (
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
          {view.def.descriptionKo}
        </p>
      )}

      {/* 승인하는 대상 전체. 접어두지 않는다 — 접힌 규칙은 읽히지 않는다. */}
      <RuleDetail view={view} />

      <div className="mt-1 text-[10px] text-muted-foreground">
        {reviewed && view.adoption
          ? `${t('review.stateReviewed')} · ${new Date(view.adoption.reviewedAt).toLocaleString()}`
          : view.adoptionStale
            ? t('review.stateStale')
            : view.adoption?.revokedAt
              ? `${t('review.stateRevoked')} · ${new Date(view.adoption.revokedAt).toLocaleString()}`
              : t('review.stateUnreviewed')}
      </div>

      {error && <p className="mt-1 text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

export function CareActivityReviewDialog({
  onPopoverOpenChange
}: {
  onPopoverOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<CareActivityDefinitionView[] | null>(null);
  const [backfill, setBackfill] = useState<CareActivityBackfillResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    window.api.careActivities
      .definitions()
      .then(setViews)
      .catch(() => setViews([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    setViews(null);
    setBackfill(null);
    load();
  }, [open, load]);

  const runBackfill = async () => {
    setBusy(true);
    setBackfill(null);
    try {
      setBackfill(await window.api.careActivities.backfill(3));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onPopoverOpenChange(next);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          title={t('review.title')}
        >
          <ShieldCheck className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('review.title')}</DialogTitle>
          <DialogDescription>{t('review.desc')}</DialogDescription>
        </DialogHeader>

        <p className="rounded border border-amber-400/30 bg-amber-500/[0.07] p-2 text-[10px] leading-snug text-amber-100/90">
          {t('review.scopeNote')}
        </p>

        <div className="space-y-2">
          {views?.map((v) => (
            <DefinitionCard key={v.def.code} view={v} onChanged={load} />
          ))}
          {views?.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t('review.empty')}
            </p>
          )}
        </div>

        <Separator />

        {/* 재스캔 자리가 여기인 이유: 검토 상태가 바뀌는 유일한 화면이고,
            그 직후가 지난 진료에 후보가 하나도 없는 유일한 순간이다. */}
        <div className="space-y-1">
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t('review.backfillDesc')}
          </p>
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runBackfill()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('review.backfill')}
            </Button>
            {backfill && (
              <span className="text-[10px] text-muted-foreground">
                {t('review.backfillResult')
                  .replace('{scanned}', String(backfill.scannedSessions))
                  .replace('{inserted}', String(backfill.inserted))
                  .replace('{unchanged}', String(backfill.unchanged))}
              </span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CareActivityReviewDialog;
