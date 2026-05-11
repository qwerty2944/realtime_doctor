import { useQuery } from '@tanstack/react-query';
import { HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayShell } from '../shared/OverlayShell';
import { ANALYSIS_KEY } from '../shared/queryClient';
import type { AnalysisResult } from '../../shared/types';

export default function QuestionsApp() {
  const { data } = useQuery<AnalysisResult | null>({
    queryKey: ANALYSIS_KEY,
    queryFn: () => null
  });

  const items = data?.suggestedQuestions ?? [];

  return (
    <OverlayShell
      title="다음 질문"
      badge={
        <Badge variant="outline" className="gap-1">
          <HelpCircle className="h-2.5 w-2.5" />
          {items.length}
        </Badge>
      }
    >
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {items.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              감별을 좁히는 데 유용한 질문이 여기에 추천됩니다.
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
