import { fmtDate, fmtTime } from './format';

export interface SummaryLike {
  chief_complaint: string;
  history_of_present_illness: string;
  pertinent_findings: string;
  investigations_mentioned: string;
  clinical_impression: string;
  plan: string;
  generated_at: string;
}

export interface DictationLike {
  template: string;
  sections: unknown;
  generated_at: string;
}

export interface ChunkLike {
  speaker: string;
  text: string;
  timestamp_ms: number;
}

export interface AnalysisLike {
  differential_diagnoses: unknown;
  medical_terms: unknown;
  suggested_questions: unknown;
  red_flags: unknown;
  updated_at: string;
}

export interface SessionMeta {
  id: string;
  started_at: string;
  ended_at: string | null;
  transcribe_provider: string | null;
}

const speakerLabel = (s: string): string =>
  s === 'doctor' ? '의사' : s === 'patient' ? '환자' : '?';

export function summaryToMarkdown(s: SummaryLike): string {
  return [
    `# 임상 노트`,
    `_생성 ${fmtDate(s.generated_at)}_`,
    ``,
    `## 주호소 (CC)`,
    s.chief_complaint || '—',
    ``,
    `## 현병력 (HPI)`,
    s.history_of_present_illness || '—',
    ``,
    `## 관련 소견`,
    s.pertinent_findings || '—',
    ``,
    `## 검사·약물 언급`,
    s.investigations_mentioned || '—',
    ``,
    `## 임상 인상 (Impression)`,
    s.clinical_impression || '—',
    ``,
    `## 계획 (Plan)`,
    s.plan || '—'
  ].join('\n');
}

export function dictationToMarkdown(d: DictationLike): string {
  const sections = Array.isArray(d.sections)
    ? (d.sections as Array<{ heading?: string; body?: string }>)
    : [];
  const lines = [
    `# 받아쓰기 (${d.template.toUpperCase()})`,
    `_생성 ${fmtDate(d.generated_at)}_`,
    ''
  ];
  for (const s of sections) {
    lines.push(`## ${s.heading ?? ''}`);
    lines.push(s.body ?? '');
    lines.push('');
  }
  return lines.join('\n');
}

export function transcriptToMarkdown(chunks: ChunkLike[]): string {
  const lines = ['# 전사', ''];
  for (const c of chunks) {
    lines.push(`**[${speakerLabel(c.speaker)} · ${fmtTime(c.timestamp_ms)}]** ${c.text}`);
  }
  return lines.join('\n');
}

export function analysisToMarkdown(a: AnalysisLike): string {
  const flags = Array.isArray(a.red_flags) ? (a.red_flags as string[]) : [];
  const dd = Array.isArray(a.differential_diagnoses)
    ? (a.differential_diagnoses as Array<{
        name?: string;
        nameEn?: string;
        icd10?: string;
        confidence?: number;
        reasoning?: string;
      }>)
    : [];
  const terms = Array.isArray(a.medical_terms)
    ? (a.medical_terms as Array<{ term?: string; termEn?: string; definition?: string }>)
    : [];
  const qs = Array.isArray(a.suggested_questions)
    ? (a.suggested_questions as Array<{ question?: string; rationale?: string }>)
    : [];

  const lines: string[] = ['# 분석', `_업데이트 ${fmtDate(a.updated_at)}_`, ''];
  if (flags.length > 0) {
    lines.push('## ⚠ Red flags');
    for (const f of flags) lines.push(`- ${f}`);
    lines.push('');
  }
  if (dd.length > 0) {
    lines.push('## 감별진단');
    const sorted = [...dd].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    for (const d of sorted) {
      const pct = Math.round((d.confidence ?? 0) * 100);
      const icd = d.icd10 ? ` _(${d.icd10})_` : '';
      lines.push(`- **${d.name ?? '—'}**${icd} — ${pct}%`);
      if (d.reasoning) lines.push(`  - ${d.reasoning}`);
    }
    lines.push('');
  }
  if (terms.length > 0) {
    lines.push('## 의학용어');
    for (const t of terms) {
      const en = t.termEn ? ` (${t.termEn})` : '';
      lines.push(`- **${t.term ?? ''}**${en} — ${t.definition ?? ''}`);
    }
    lines.push('');
  }
  if (qs.length > 0) {
    lines.push('## 다음 질문');
    for (const q of qs) {
      lines.push(`- ${q.question ?? ''}${q.rationale ? ` — _${q.rationale}_` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function sessionToMarkdown(opts: {
  session: SessionMeta;
  analysis: AnalysisLike | null;
  summaries: SummaryLike[];
  dictations: DictationLike[];
  chunks: ChunkLike[];
}): string {
  const { session, analysis, summaries, dictations, chunks } = opts;
  const parts: string[] = [
    `# 진료 세션`,
    `- 시작: ${fmtDate(session.started_at)}`,
    `- 종료: ${session.ended_at ? fmtDate(session.ended_at) : '진행 중'}`,
    `- 공급자: ${session.transcribe_provider ?? '—'}`,
    `- ID: ${session.id}`,
    ''
  ];
  if (analysis) parts.push(analysisToMarkdown(analysis), '');
  for (const s of summaries) parts.push(summaryToMarkdown(s), '');
  for (const d of dictations) parts.push(dictationToMarkdown(d), '');
  if (chunks.length > 0) parts.push(transcriptToMarkdown(chunks));
  return parts.join('\n');
}

export function downloadMarkdown(name: string, body: string): void {
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.md') ? name : `${name}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyMarkdown(body: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(body);
    return true;
  } catch {
    return false;
  }
}
