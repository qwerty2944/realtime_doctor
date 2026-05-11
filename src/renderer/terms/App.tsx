import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayShell } from '../shared/OverlayShell';
import { ANALYSIS_KEY } from '../shared/queryClient';
import type { AnalysisResult } from '../../shared/types';

export default function TermsApp() {
  const { data } = useQuery<AnalysisResult | null>({
    queryKey: ANALYSIS_KEY,
    queryFn: () => null
  });

  const items = data?.medicalTerms ?? [];

  return (
    <OverlayShell
      title="의학용어"
      badge={
        <Badge variant="outline" className="gap-1">
          <BookOpen className="h-2.5 w-2.5" />
          {items.length}
        </Badge>
      }
    >
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {items.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              대화에서 의학용어가 등장하면 여기에 풀이됩니다.
            </p>
          )}
          {items.map((t, i) => (
            <Card key={`${t.term}-${i}`}>
              <CardHeader>
                <CardTitle>
                  {t.term}
                  {t.termEn && (
                    <span className="ml-1 text-muted-foreground">({t.termEn})</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-xs leading-relaxed">{t.definition}</p>
                {t.contextQuote && (
                  <p className="border-l-2 border-white/20 pl-2 text-[11px] italic text-muted-foreground">
                    "{t.contextQuote}"
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
