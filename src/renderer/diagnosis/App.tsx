import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayShell } from '../shared/OverlayShell';
import { ANALYSIS_KEY } from '../shared/queryClient';
import type { AnalysisResult } from '../../shared/types';

function confidenceLabel(c: number): string {
  if (c >= 0.7) return '높음';
  if (c >= 0.4) return '중간';
  return '낮음';
}

export default function DiagnosisApp() {
  const { data } = useQuery<AnalysisResult | null>({
    queryKey: ANALYSIS_KEY,
    queryFn: () => null
  });

  const items = data?.differentialDiagnoses ?? [];
  const redFlags = data?.redFlags ?? [];

  return (
    <OverlayShell
      title="감별진단"
      badge={
        <Badge variant="outline" className="gap-1">
          <Activity className="h-2.5 w-2.5" />
          {items.length}
        </Badge>
      }
    >
      {redFlags.length > 0 && (
        <div className="m-2 mb-0 rounded-md border border-red-500/40 bg-red-500/15 p-2 text-xs">
          <div className="mb-1 flex items-center gap-1 font-semibold text-red-200">
            <AlertTriangle className="h-3 w-3" /> Red flag
          </div>
          <ul className="ml-4 list-disc space-y-0.5 text-red-100/90">
            {redFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {items.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              아직 분석할 발화가 부족합니다.
            </p>
          )}
          {items.map((d, i) => (
            <Card key={`${d.name}-${i}`}>
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="truncate">
                    {i + 1}. {d.name}
                    {d.nameEn && (
                      <span className="ml-1 text-muted-foreground">({d.nameEn})</span>
                    )}
                  </CardTitle>
                  {d.icd10 && (
                    <p className="text-[10px] text-muted-foreground">
                      ICD-10 · {d.icd10}
                    </p>
                  )}
                </div>
                <Badge variant={d.confidence >= 0.7 ? 'default' : 'secondary'}>
                  {confidenceLabel(d.confidence)} · {Math.round(d.confidence * 100)}%
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="text-xs leading-relaxed text-foreground/80">
                  {d.reasoning}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
