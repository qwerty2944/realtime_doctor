import { QueryClient } from '@tanstack/react-query';
import type { AnalysisResult } from '../../shared/types';

export const ANALYSIS_KEY = ['analysis'] as const;

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false
      }
    }
  });

  client.setQueryData<AnalysisResult | null>(ANALYSIS_KEY, null);

  window.api.onAnalysisUpdate((payload) => {
    client.setQueryData<AnalysisResult>(ANALYSIS_KEY, payload);
  });

  return client;
}
