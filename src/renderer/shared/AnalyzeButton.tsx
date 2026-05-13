import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { ANALYSIS_KEY } from './queryClient';
import type { AnalysisResult } from '../../shared/types';

export function AnalyzeButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const requestedAtRef = useRef<number>(0);
  const { data } = useQuery<AnalysisResult | null>({
    queryKey: ANALYSIS_KEY,
    queryFn: () => null
  });

  // main 의 명시적 trigger (정지 후 자동 실행 포함) 가 모든 창에 spinner 띄우도록.
  useEffect(() => {
    return window.api.onAnalysisPending((pending) => {
      if (pending) {
        requestedAtRef.current = Date.now();
        setBusy(true);
      } else {
        setBusy(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!busy) return;
    if (!data?.updatedAt) return;
    if (data.updatedAt < requestedAtRef.current) return;
    setBusy(false);
  }, [busy, data?.updatedAt]);

  const onClick = async () => {
    if (busy) return;
    requestedAtRef.current = Date.now();
    setBusy(true);
    try {
      await window.api.requestAnalysis();
    } catch {
      setBusy(false);
      return;
    }
    setTimeout(() => setBusy(false), 30_000);
  };

  return (
    <div data-no-drag>
      <Button size="sm" onClick={onClick} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {label}
      </Button>
    </div>
  );
}
