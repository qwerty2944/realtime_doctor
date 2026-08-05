import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  ExternalLink,
  BookOpen,
  Loader2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayShell } from '../shared/OverlayShell';
import { AnalyzeButton } from '../shared/AnalyzeButton';
import { ANALYSIS_KEY } from '../shared/queryClient';
import {
  patientDifferentials,
  patientRedFlags,
  usePatientDetail
} from '../shared/patientMode';
import { useLang, useT } from '../shared/i18n';
import type {
  AnalysisResult,
  DifferentialDiagnosis,
  EvidenceReference,
  EvidenceStatus
} from '../../shared/types';

function confidenceLabel(c: number, lang: 'ko' | 'en'): string {
  if (c >= 0.7) return lang === 'en' ? 'High' : '높음';
  if (c >= 0.4) return lang === 'en' ? 'Medium' : '중간';
  return lang === 'en' ? 'Low' : '낮음';
}

/** 참고문헌 한 줄. 폭 380px 창이라 제목은 두 줄까지만 보이고 잘린다. */
function ReferenceRow({ reference }: { reference: EvidenceReference }) {
  const t = useT();
  const meta = [reference.journal, reference.year].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      title={`${reference.title}\n${t('evidence.openHint')}`}
      // 카드 onClick(선택 토글)까지 올라가면 링크를 열면서 카드가 접힌다.
      onClick={(e) => {
        e.stopPropagation();
        void window.api.evidence.open(reference.url);
      }}
      className="group w-full rounded border border-border/60 bg-background/40 p-1.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <span className="flex items-start gap-1">
        <span className="line-clamp-2 flex-1 text-[11px] leading-snug text-foreground/90">
          {reference.title}
        </span>
        <ExternalLink className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground group-hover:text-primary" />
      </span>
      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
        {meta && <span>{meta} · </span>}PMID {reference.pmid}
      </span>
    </button>
  );
}

/**
 * 문헌근거 섹션.
 *
 * 카드가 **선택(펼침)됐을 때만** 마운트된다 — 감별진단이 5~6개씩 뜨는데 렌더마다
 * 전부 조회하면 PubMed 를 초당 3회 제한 안에서 줄세우느라 화면이 한참 비어 있고,
 * 실제로는 의사가 들여다보는 한두 개만 필요하다.
 * 조회는 react-query 캐시에 남으므로 카드를 접었다 펴도 재조회하지 않는다.
 */
function EvidenceSection({ diagnosis }: { diagnosis: DifferentialDiagnosis }) {
  const t = useT();
  const term = (diagnosis.nameEn ?? '').trim() || diagnosis.name.trim();

  const { data, isFetching, refetch } = useQuery<EvidenceStatus>({
    queryKey: ['evidence', term.toLowerCase()],
    queryFn: () => window.api.evidence.request(diagnosis.name, diagnosis.nameEn ?? null),
    // 진단명이 비어 있으면 검색할 것이 없다.
    enabled: term !== ''
  });

  // 문진 결과가 이미 근거를 들고 있으면 그것을 그대로 쓴다.
  const preloaded = diagnosis.references;
  const status: EvidenceStatus | undefined =
    preloaded && preloaded.length > 0
      ? { state: 'ready', references: preloaded, cached: true }
      : data;

  return (
    <div
      className="mt-2 border-t border-border/50 pt-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <BookOpen className="h-2.5 w-2.5" />
        {t('evidence.title')}
        {status?.state === 'ready' && status.cached && (
          <span className="font-normal normal-case">· {t('evidence.cached')}</span>
        )}
      </div>

      {(isFetching || !status) && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('evidence.loading')}
        </p>
      )}

      {!isFetching && status?.state === 'error' && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-amber-300/90">
            {status.message === 'rate-limited'
              ? t('evidence.rateLimited')
              : t('evidence.error')}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] hover:border-primary/50 hover:text-primary"
          >
            {t('evidence.retry')}
          </button>
        </div>
      )}

      {!isFetching && status?.state === 'ready' && status.references.length === 0 && (
        <p className="text-[11px] text-muted-foreground">{t('evidence.empty')}</p>
      )}

      {!isFetching && status?.state === 'ready' && status.references.length > 0 && (
        <div className="space-y-1">
          {status.references.map((reference) => (
            <ReferenceRow key={reference.pmid} reference={reference} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DiagnosisApp() {
  const t = useT();
  const lang = useLang();
  // 검토할 진단 선택(UI 강조용). 같은 카드를 다시 누르면 해제.
  const [selected, setSelected] = useState<number | null>(null);
  const { data } = useQuery<AnalysisResult | null>({
    queryKey: ANALYSIS_KEY,
    queryFn: () => null
  });
  // 환자가 선택돼 있으면 실시간 분석 대신 그 환자의 문진 감별진단을 본다.
  const patient = usePatientDetail();

  const items = patient
    ? patientDifferentials(patient)
    : data?.differentialDiagnoses ?? [];
  const redFlags = patient
    ? patientRedFlags(patient, t('patients.redFlagFallback'))
    : data?.redFlags ?? [];
  const emptyMessage = patient
    ? patient.intakeResult
      ? t('patient.noData')
      : t('patient.noIntake')
    : t('diagnosis.empty');

  return (
    <OverlayShell
      title={t('window.diagnosis')}
      shortcutId="toggleDiagnosis"
      patientName={patient?.patient.name}
      badge={
        <Badge variant="outline" className="gap-1">
          <Activity className="h-2.5 w-2.5" />
          {items.length}
        </Badge>
      }
      actions={<AnalyzeButton label={lang === 'en' ? 'Analyze' : '분석'} />}
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
              {emptyMessage}
            </p>
          )}
          {items.map((d, i) => (
            <Card
              key={`${d.name}-${i}`}
              onClick={() => setSelected((prev) => (prev === i ? null : i))}
              className={
                'cursor-pointer transition-colors ' +
                (selected === i
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : 'hover:border-primary/40')
              }
            >
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-1 truncate">
                    {selected === i && (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className="truncate">
                      {i + 1}. {d.name}
                      {d.nameEn && (
                        <span className="ml-1 text-muted-foreground">({d.nameEn})</span>
                      )}
                    </span>
                  </CardTitle>
                  {d.icd10 && (
                    <p className="text-[10px] text-muted-foreground">
                      ICD-10 · {d.icd10}
                    </p>
                  )}
                </div>
                {/* 문진 결과는 확률을 주지 않는다 — 없으면 순위 배지로 대체. */}
                {typeof d.confidence === 'number' ? (
                  <Badge variant={d.confidence >= 0.7 ? 'default' : 'secondary'}>
                    {confidenceLabel(d.confidence, lang)} ·{' '}
                    {Math.round(d.confidence * 100)}%
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    {t('patient.rankPrefix')} {i + 1}
                  </Badge>
                )}
              </CardHeader>
              {(d.reasoning || selected === i) && (
                <CardContent>
                  {d.reasoning && (
                    <p className="text-xs leading-relaxed text-foreground/80">
                      {d.reasoning}
                    </p>
                  )}
                  {/* 근거 조회는 카드를 펼쳤을 때만 — 지연 로딩 트리거. */}
                  {selected === i && <EvidenceSection diagnosis={d} />}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
