import { useCallback, useEffect, useState } from 'react';
import { ClipboardCopy, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { useT } from '../shared/i18n';
import {
  monthlyReportToCsv,
  type MonthlyCareActivityReport
} from '../../shared/careActivities';

/**
 * 월간 행위 기록 (B4).
 *
 * **왜 앱 안인가.** 다른 후보는 admin-web 이었지만 아직 배포되지 않았고,
 * 배포된다 해도 이 숫자를 보려고 브라우저를 따로 여는 사람은 원장 본인이다 —
 * 파일럿에서 우리가 얻으려는 것이 바로 그 사람의 실제 사용 기록이라 마찰을
 * 늘릴 이유가 없다. 데이터는 RLS 로 자기 행만 보이고, 앱은 이미 그 세션을
 * 들고 있다. admin-web 이 배포되면 같은 테이블을 읽는 화면을 하나 더 붙이는
 * 것은 독립적인 작업이다.
 *
 * **끼어들지 않는다.** dock 의 버튼을 눌렀을 때만 열린다.
 *
 * [HARD] 금액·환산 수익을 그리지 않는다. 세는 것은 건수뿐이고, CSV 로 그대로
 * 꺼낼 수 있다 — 설득하는 리포트가 아니라 세는 리포트다.
 */

/** 'YYYY-MM' (로컬 기준). */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, (m ?? 1) - 1 + delta, 1);
  return monthKey(d);
}

export function CareActivityReportDialog({
  onPopoverOpenChange
}: {
  onPopoverOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [report, setReport] = useState<MonthlyCareActivityReport | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback((m: string) => {
    window.api.careActivities
      .report(m)
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    load(month);
  }, [open, month, load]);

  const copyCsv = () => {
    if (!report) return;
    navigator.clipboard.writeText(monthlyReportToCsv(report));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          title={t('care.reportTitle')}
        >
          <ClipboardList className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('care.reportTitle')}</DialogTitle>
          <DialogDescription>{t('care.reportDesc')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            {t('care.reportPrev')}
          </Button>
          <span className="font-mono text-sm tabular-nums">{month}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={month >= monthKey(new Date())}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            {t('care.reportNext')}
          </Button>
        </div>

        {report && report.rows.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {t('care.reportEmpty')}
          </p>
        )}

        {report && report.rows.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1 text-left">{t('care.reportColActivity')}</th>
                <th className="py-1 text-right">{t('care.reportColRule')}</th>
                <th className="py-1 text-right">{t('care.reportColCount')}</th>
                <th className="py-1 text-right">{t('care.reportColSessions')}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr
                  key={`${row.activityCode}-${row.engineVersion}-${row.ruleVersion}`}
                  className="border-t border-border/50"
                >
                  <td className="py-1 pr-2">
                    <span className="block truncate">{row.label}</span>
                    <span className="block font-mono text-[9px] text-muted-foreground">
                      {row.activityCode}
                    </span>
                  </td>
                  {/* 규칙 버전이 줄마다 보인다 — 지난달과 이번달이 다른 규칙에서
                      나왔다면 그 사실이 숫자보다 먼저 눈에 들어와야 한다. */}
                  <td className="py-1 text-right font-mono tabular-nums text-muted-foreground">
                    {row.engineVersion} / {t('care.ruleVersion')}
                    {row.ruleVersion}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums">{row.count}</td>
                  <td className="py-1 text-right font-mono tabular-nums text-muted-foreground">
                    {row.sessionCount}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-1 font-medium">{t('care.reportTotal')}</td>
                <td />
                <td className="py-1 text-right font-mono tabular-nums">
                  {report.totalCount}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-muted-foreground">
                  {report.sessionCount}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        <p className="text-[10px] leading-snug text-muted-foreground">
          {t('care.reportNote')}
        </p>

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={!report || report.rows.length === 0}
            onClick={copyCsv}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            {copied ? t('care.reportCopied') : t('care.reportCopyCsv')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CareActivityReportDialog;
