import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClipboardCopy, FileText, Loader2, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { OverlayShell } from '../shared/OverlayShell';
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

  const result = status.state === 'ready' ? status.result : null;

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(summaryToText(result, t));
  };

  return (
    <OverlayShell
      title={t('window.summary')}
      shortcutId="toggleSummary"
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
          <Button
            size="sm"
            disabled={status.state === 'pending' || requestMutation.isPending}
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
          {status.state === 'idle' && (
            <p className="text-xs text-muted-foreground">
              {lang === 'en'
                ? 'Press "Regenerate" to produce a chart-note summary of the conversation so far.'
                : '"요약" 버튼을 눌러 지금까지 진료 대화를 임상 노트 형식으로 정리합니다.'}
            </p>
          )}
          {(status.state === 'pending' || requestMutation.isPending) && !result && (
            <p className="text-xs text-muted-foreground">{t('summary.statusPending')}</p>
          )}
          {status.state === 'error' && (
            <p className="text-xs text-destructive">
              {t('summary.statusError')}: {status.message}
            </p>
          )}
          {result &&
            SECTIONS.map(({ key, tkey }) => (
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
