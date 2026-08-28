import { useQuery } from '@tanstack/react-query';
import { HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayShell } from '../shared/OverlayShell';
import { AnalyzeButton } from '../shared/AnalyzeButton';
import { ANALYSIS_KEY } from '../shared/queryClient';
import { patientQuestions, usePatientDetail } from '../shared/patientMode';
import { useLang, useT } from '../shared/i18n';
import type { AnalysisResult } from '../../shared/types';

export default function QuestionsApp() {
  const t = useT();
  const lang = useLang();
  const { data } = useQuery<AnalysisResult | null>({
    queryKey: ANALYSIS_KEY,
    queryFn: () => null
  });
  // 환자 모드에서는 문진이 추천 질문을 실어 보낸 경우에만 표시한다. 없으면
  // 실시간 질문을 남겨두지 않고 "해당 데이터 없음" 으로 비운다 (다른 환자의
  // 데이터를 이 환자 것으로 읽는 사고를 막는다).
  const patient = usePatientDetail();

  const items = patient ? patientQuestions(patient) : data?.suggestedQuestions ?? [];
  const emptyMessage = patient
    ? patient.intakeResult
      ? t('patient.noData')
      : t('patient.noIntake')
    : t('questions.empty');

  return (
    <OverlayShell
      title={t('window.questions')}
      shortcutId="toggleQuestions"
      patientName={patient?.patient.name}
      badge={
        <Badge variant="outline" className="gap-1">
          <HelpCircle className="h-2.5 w-2.5" />
          {items.length}
        </Badge>
      }
      actions={<AnalyzeButton label={lang === 'en' ? 'Suggest' : '추천'} />}
    >
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {items.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </p>
          )}
          {items.map((q, i) => (
            <Card key={`${q.question}-${i}`}>
              <CardHeader>
                <CardTitle className="leading-snug">{q.question}</CardTitle>
              </CardHeader>
              {q.rationale && (
                <CardContent>
                  <p className="text-[11px] text-muted-foreground">{q.rationale}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
