import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayShell } from '../shared/OverlayShell';
import { AnalyzeButton } from '../shared/AnalyzeButton';
import { ANALYSIS_KEY } from '../shared/queryClient';
import { patientTerms, usePatientDetail } from '../shared/patientMode';
import { useLang, useT } from '../shared/i18n';
import type { AnalysisResult } from '../../shared/types';

export default function TermsApp() {
  const t = useT();
  const lang = useLang();
  const { data } = useQuery<AnalysisResult | null>({
    queryKey: ANALYSIS_KEY,
    queryFn: () => null
  });
  // 문진 결과에 용어가 없으면 실시간 용어를 남기지 않고 비운다 (질문 창과 동일 규칙).
  const patient = usePatientDetail();

  const items = patient ? patientTerms(patient) : data?.medicalTerms ?? [];
  const emptyMessage = patient
    ? patient.intakeResult
      ? t('patient.noData')
      : t('patient.noIntake')
    : t('terms.empty');

  return (
    <OverlayShell
      title={t('window.terms')}
      shortcutId="toggleTerms"
      patientName={patient?.patient.name}
      badge={
        <Badge variant="outline" className="gap-1">
          <BookOpen className="h-2.5 w-2.5" />
          {items.length}
        </Badge>
      }
      actions={<AnalyzeButton label={lang === 'en' ? 'Extract' : '추출'} />}
    >
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {items.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </p>
          )}
          {items.map((term, i) => (
            <Card key={`${term.term}-${i}`}>
              <CardHeader>
                <CardTitle>
                  {term.term}
                  {term.termEn && term.termEn !== term.term && (
                    <span className="ml-1 text-muted-foreground">({term.termEn})</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {term.definition && (
                  <p className="text-xs leading-relaxed">{term.definition}</p>
                )}
                {term.contextQuote && (
                  <p className="border-l-2 border-white/20 pl-2 text-[11px] italic text-muted-foreground">
                    "{term.contextQuote}"
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
