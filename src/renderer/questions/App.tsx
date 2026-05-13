import { useQuery } from '@tanstack/react-query';
import { HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayShell } from '../shared/OverlayShell';
import { AnalyzeButton } from '../shared/AnalyzeButton';
import { ANALYSIS_KEY } from '../shared/queryClient';
import { useLang, useT } from '../shared/i18n';
import type { AnalysisResult } from '../../shared/types';

export default function QuestionsApp() {
  const t = useT();
  const lang = useLang();
  const { data } = useQuery<AnalysisResult | null>({
    queryKey: ANALYSIS_KEY,
    queryFn: () => null
  });

  const items = data?.suggestedQuestions ?? [];

  return (
    <OverlayShell
      title={t('window.questions')}
      shortcutId="toggleQuestions"
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
              {t('questions.empty')}
            </p>
          )}
          {items.map((q, i) => (
            <Card key={`${q.question}-${i}`}>
              <CardHeader>
                <CardTitle className="leading-snug">{q.question}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[11px] text-muted-foreground">{q.rationale}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
