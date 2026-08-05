import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  CornerDownRight,
  ExternalLink,
  BookOpen,
  HelpCircle,
  Loader2,
  Quote
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayShell } from '../shared/OverlayShell';
import { AnalyzeButton } from '../shared/AnalyzeButton';
import { ANALYSIS_KEY } from '../shared/queryClient';
import {
  patientDifferentialsPartitioned,
  patientRedFlags,
  usePatientDetail
} from '../shared/patientMode';
import { useLang, useT } from '../shared/i18n';
import type {
  AnalysisResult,
  DifferentialDiagnosis,
  EvidenceReference,
  EvidenceStatus,
  SupportingFinding,
  UnverifiedDifferential
} from '../../shared/types';

/**
 * 환자 근거 섹션 (E1).
 *
 * 문헌근거(`EvidenceSection`)와 **의도적으로 다르게 생겼다**. 이쪽은 이 환자가
 * 실제로 한 말이고 저쪽은 이 진단을 일반적으로 어떻게 판단하는지다. 둘이 같은
 * 모양이면 의사는 "이 환자에게서 관찰된 것"과 "논문에 이렇게 쓰여 있다"를
 * 구분하지 못한다. 그래서 색(emerald vs 기본), 아이콘, 위치를 전부 나눈다.
 *
 * 각 항목의 인용문은 모델이 쓴 문장이 아니라 검증기가 원문에서 꺼낸 값이다.
 */
function FindingsSection({ findings }: { findings: SupportingFinding[] }) {
  const t = useT();
  return (
    <div
      className="mt-2 rounded border border-emerald-400/30 bg-emerald-500/10 p-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/90">
        <Quote className="h-2.5 w-2.5" />
        {t('findings.title')}
      </div>
      <ul className="space-y-1">
        {findings.map((f, i) => (
          <li key={`${f.utteranceId}-${i}`}>
            <button
              type="button"
              title={`"${f.quote}"\n${t('findings.hint')}`}
              onClick={() => window.api.focusUtterance(f.utteranceId)}
              className="group w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-emerald-400/15"
            >
              <span className="flex items-start gap-1">
                <CornerDownRight className="mt-0.5 h-2.5 w-2.5 shrink-0 text-emerald-300/70" />
                <span className="flex-1">
                  <span className="block text-[11px] leading-snug text-emerald-50/95">
                    {f.finding}
                  </span>
                  {/* 원문 그대로. 모델이 옮겨 적으며 바꾼 문장이 아니다. */}
                  <span className="mt-0.5 block truncate text-[10px] italic text-emerald-200/70">
                    “{f.quote}”
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 근거 미확인 감별진단 (E1).
 *
 * 조용히 버리지 않는다 — 화면에서 사라지면 의사는 그 진단이 검토조차 안 됐다고
 * 오해한다. 정상 목록과 섞이지 않도록 흐리게, 아래에, 이유를 붙여 그린다.
 *
 * TODO(E2): 이 목록은 questions 창의 "확인 요청 큐" 로도 흘러가야 한다.
 * 지금은 감별진단 창 안에만 있다.
 */
function UnverifiedSection({ items }: { items: UnverifiedDifferential[] }) {
  const t = useT();
  return (
    <div className="mt-3 border-t border-dashed border-border pt-2 opacity-70">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <HelpCircle className="h-2.5 w-2.5" />
        {t('findings.unverifiedTitle')} · {items.length}
      </div>
      <p className="mb-1.5 text-[10px] leading-snug text-muted-foreground">
        {t('findings.unverifiedNote')}
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li
            key={`${item.diagnosis.name}-${i}`}
            className="rounded border border-dashed border-border/70 bg-muted/20 px-1.5 py-1"
          >
            <div className="truncate text-[11px] text-foreground/70 line-through decoration-muted-foreground/50">
              {item.diagnosis.name}
              {item.diagnosis.nameEn && (
                <span className="ml-1 text-muted-foreground">
                  ({item.diagnosis.nameEn})
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {item.reason === 'unresolved-source'
                ? t('findings.reasonUnresolved')
                : t('findings.reasonNoFindings')}
              {item.rejectedSources.length > 0 && (
                <span>
                  {' · '}
                  {t('findings.rejectedSources')}: {item.rejectedSources.join(', ')}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
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

  // 두 모드가 같은 모양으로 나온다: 근거가 확인된 것과 못 한 것.
  // 실시간 경로는 main 이 이미 갈라서 보냈고, 환자 모드는 여기서 같은 검증기를 돈다.
  const partitioned = patient ? patientDifferentialsPartitioned(patient) : null;
  const items = partitioned
    ? partitioned.supported
    : data?.differentialDiagnoses ?? [];
  const unverified = partitioned
    ? partitioned.unverified
    : data?.unverifiedDiagnoses ?? [];
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
          {items.length === 0 && unverified.length === 0 && (
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
                {/* 확신도 퍼센트는 없앴다 (E1). 순서만 남긴다. */}
                <Badge variant="secondary">
                  {t('patient.rankPrefix')} {i + 1}
                </Badge>
              </CardHeader>
              <CardContent>
                {d.reasoning && (
                  <p className="text-xs leading-relaxed text-foreground/80">
                    {d.reasoning}
                  </p>
                )}
                {/* 환자 근거는 항상 보인다 — 진단을 읽는 순간 함께 읽혀야 한다. */}
                {d.supportingFindings && d.supportingFindings.length > 0 && (
                  <FindingsSection findings={d.supportingFindings} />
                )}
                {/* 문헌근거 조회는 카드를 펼쳤을 때만 — 지연 로딩 트리거. */}
                {selected === i && <EvidenceSection diagnosis={d} />}
              </CardContent>
            </Card>
          ))}
          {unverified.length > 0 && <UnverifiedSection items={unverified} />}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
