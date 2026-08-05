import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClipboardCopy, FileText, Loader2, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { OverlayShell } from '../shared/OverlayShell';
import { patientSummary, usePatientDetail } from '../shared/patientMode';
import { useLang, useT } from '../shared/i18n';
import type { TKey } from '../shared/i18n';
import type { SummaryResult, SummaryStatus } from '../../shared/types';

const SECTIONS: Array<{ key: keyof SummaryResult; tkey: TKey }> = [
  { key: 'chiefComplaint', tkey: 'summary.chiefComplaint' },
  { key: 'historyOfPresentIllness', tkey: 'summary.hpi' },
  { key: 'pertinentFindings', tkey: 'summary.findings' },
  { key: 'investigationsMentioned', tkey: 'summary.investigations' },
  { key: 'clinicalImpression', tkey: 'summary.impression' },
  { key: 'plan', tkey: 'summary.plan' }
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function summaryToText(
  r: SummaryResult,
  t: (k: TKey) => string
): string {
  return SECTIONS.map(({ key, tkey }) => `## ${t(tkey)}\n${r[key]}`).join('\n\n');
}

export default function SummaryApp() {
  const t = useT();
  const lang = useLang();
  const [status, setStatus] = useState<SummaryStatus>({ state: 'idle' });

  useEffect(() => {
    return window.api.onSummaryUpdate(setStatus);
  }, []);

  const requestMutation = useMutation({
    mutationFn: () => window.api.requestSummary(),
    onSuccess: (s) => setStatus(s)
  });

  // 환자 모드에서는 실시간 요약 상태 머신을 건드리지 않고 문진 SOAP 을 대신
  // 보여준다 — 선택을 해제하면 그대로 원래 요약으로 돌아온다.
  const patient = usePatientDetail();
  const patientResult = patient ? patientSummary(patient, t) : null;
  const liveResult = status.state === 'ready' ? status.result : null;
  const result = patient ? patientResult : liveResult;

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(summaryToText(result, t));
  };

  return (
    <OverlayShell
      title={t('window.summary')}
      shortcutId="toggleSummary"
      patientName={patient?.patient.name}
      badge={
        result ? (
          <Badge variant="outline" className="gap-1 font-mono tabular-nums">
            <FileText className="h-2.5 w-2.5" />
            {formatTime(result.generatedAt)}
          </Badge>
        ) : undefined
      }
      actions={
        <div className="flex items-center gap-1" data-no-drag>
          {/* 환자 모드에서 재생성하면 결과가 화면에 안 뜨고 조용히 실시간 캐시만
              바뀐다 — 오해를 막기 위해 비활성화하고 선택 해제 시 복구된다. */}
          <Button
            size="sm"
            disabled={
              patient !== null ||
              status.state === 'pending' ||
              requestMutation.isPending
            }
            onClick={() => requestMutation.mutate()}
          >
            {status.state === 'pending' || requestMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            {t('summary.run')}
          </Button>
          {result && (
            <Button
              size="icon"
              variant="ghost"
              onClick={copy}
              title={lang === 'en' ? 'Copy' : '복사'}
            >
              <ClipboardCopy />
            </Button>
          )}
        </div>
      }
    >
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3 text-sm leading-relaxed">
          {patient && (
            <p className="text-[10px] uppercase tracking-wide text-emerald-200/80">
              {t('patient.intakeSource')}
            </p>
          )}
          {patient && !patientResult && (
            <p className="text-xs text-muted-foreground">{t('patient.noIntake')}</p>
          )}
          {!patient && status.state === 'idle' && (
            <p className="text-xs text-muted-foreground">
              {lang === 'en'
                ? 'Press "Regenerate" to produce a chart-note summary of the conversation so far.'
                : '"요약" 버튼을 눌러 지금까지 진료 대화를 임상 노트 형식으로 정리합니다.'}
            </p>
          )}
          {!patient &&
            (status.state === 'pending' || requestMutation.isPending) &&
            !result && (
              <p className="text-xs text-muted-foreground">
                {t('summary.statusPending')}
              </p>
            )}
          {!patient && status.state === 'error' && (
            <p className="text-xs text-destructive">
              {t('summary.statusError')}: {status.message}
            </p>
          )}
          {result &&
            // 빈 섹션은 그리지 않는다 — 문진 SOAP 은 o/a/p 가 비어 있을 수 있다.
            SECTIONS.filter(({ key }) => String(result[key] ?? '').length > 0).map(({ key, tkey }) => (
              <div key={key} className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(tkey)}
                </div>
                <Separator />
                <p className="whitespace-pre-wrap text-sm">{result[key]}</p>
              </div>
            ))}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
