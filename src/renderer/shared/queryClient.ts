import { QueryClient } from '@tanstack/react-query';
import type { AnalysisResult, PatientDetail } from '../../shared/types';
import { PATIENT_KEY } from './patientMode';

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

  // 선택된 환자. 실시간 캐시와 분리된 키라 녹취 중에 환자를 골라도 진행 중인
  // 분석 상태가 파괴되지 않는다. 창이 나중에 떠도 getActive 로 스스로 채운다.
  client.setQueryData<PatientDetail | null>(PATIENT_KEY, null);
  void window.api.patients
    .getActive()
    .then((detail) => {
      // broadcast 가 먼저 도착했으면 그 값을 덮어쓰지 않는다.
      if (client.getQueryData(PATIENT_KEY) == null) {
        client.setQueryData<PatientDetail | null>(PATIENT_KEY, detail);
      }
    })
    .catch(() => {});
  window.api.patients.onActiveChange((detail) => {
    client.setQueryData<PatientDetail | null>(PATIENT_KEY, detail);
  });

  return client;
}
