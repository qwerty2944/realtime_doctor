import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ClipboardCopy,
  Loader2,
  NotebookPen,
  Pencil,
  Sparkles
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { OverlayShell } from '../shared/OverlayShell';
import { useLang, useT } from '../shared/i18n';
import type {
  DictationResult,
  DictationSection,
  DictationStatus,
  DictationTemplate
} from '../../shared/types';

const TEMPLATE_LABELS: Record<DictationTemplate, string> = {
  soap: 'SOAP',
  apso: 'APSO',
  hp: 'H&P',
  narrative: 'Narrative'
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function sectionsToMarkdown(sections: DictationSection[]): string {
  return sections.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n');
}

export default function DictationApp() {
  const t = useT();
  const lang = useLang();
  const [template, setTemplate] = useState<DictationTemplate>('soap');
  const [status, setStatus] = useState<DictationStatus>({ state: 'idle' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DictationSection[] | null>(null);
  const [serverResult, setServerResult] = useState<DictationResult | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api.getLastDictationTemplate().then((t) => {
      if (!cancelled) setTemplate(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return window.api.onDictationUpdate((s) => {
      setStatus(s);
      if (s.state === 'ready') {
        setServerResult(s.result);
        setDraft(s.result.sections);
        setDirty(false);
      }
    });
  }, []);

  const runMutation = useMutation({
    mutationFn: async () => {
      const msg =
        lang === 'en'
          ? 'Your edits will be lost. Continue?'
          : '편집한 내용이 사라집니다. 계속할까요?';
      if (dirty && !confirm(msg)) {
        throw new Error('cancelled');
      }
      return window.api.requestDictation(template);
    },
    onSuccess: (s) => {
      setStatus(s);
      if (s.state === 'ready') {
        setServerResult(s.result);
        setDraft(s.result.sections);
        setDirty(false);
      }
    }
  });

  const pending = status.state === 'pending' || runMutation.isPending;
  const hasContent = draft && draft.length > 0;

  const updateSection = (
    index: number,
    field: 'heading' | 'body',
    value: string
  ) => {
    if (!draft) return;
    const next = draft.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    setDraft(next);
    setDirty(true);
  };

  const revertEdits = () => {
    if (!serverResult) return;
    const msg =
      lang === 'en'
        ? 'Discard your edits and restore the original?'
        : '편집한 내용을 모두 버리고 원본으로 되돌릴까요?';
    if (!confirm(msg)) return;
    setDraft(serverResult.sections);
    setDirty(false);
  };

  const copy = () => {
    if (!draft) return;
    navigator.clipboard.writeText(sectionsToMarkdown(draft));
  };

  return (
    <OverlayShell
      title={t('window.dictation')}
      shortcutId="toggleDictation"
      badge={
        serverResult ? (
          <Badge variant="outline" className="gap-1 font-mono tabular-nums">
            <NotebookPen className="h-2.5 w-2.5" />
            {formatTime(serverResult.generatedAt)}
            {dirty && <span className="ml-1 text-yellow-300">●</span>}
          </Badge>
        ) : undefined
      }
      actions={
        <div className="flex items-center gap-1" data-no-drag>
          <Select
            value={template}
            onValueChange={(v) => setTemplate(v as DictationTemplate)}
          >
            <SelectTrigger className="h-7 w-24 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="soap">SOAP</SelectItem>
              <SelectItem value="apso">APSO</SelectItem>
              <SelectItem value="hp">H&P</SelectItem>
              <SelectItem value="narrative">Narrative</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" disabled={pending} onClick={() => runMutation.mutate()}>
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {t('dictation.run')}
          </Button>
          {hasContent && (
            <>
              <Button
                size="icon"
                variant={editing ? 'default' : 'ghost'}
                onClick={() => setEditing((v) => !v)}
                title={
                  editing
                    ? lang === 'en'
                      ? 'Exit edit mode'
                      : '편집 종료'
                    : lang === 'en'
                      ? 'Edit'
                      : '편집'
                }
              >
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={copy}
                title={lang === 'en' ? 'Copy' : '복사'}
              >
                <ClipboardCopy />
              </Button>
            </>
          )}
        </div>
      }
    >
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3 text-sm leading-relaxed">
          {status.state === 'idle' && !pending && !hasContent && (
            <p className="text-xs text-muted-foreground">
              {lang === 'en'
                ? 'Pick a template and press "Regenerate" to produce EMR-ready chart-note prose. You can edit the result with the ✏️ edit button.'
                : '템플릿을 고르고 "정리"를 누르면 EMR에 붙여 넣을 수 있는 의무기록 prose가 생성됩니다. 결과는 ✏️ 편집 버튼으로 직접 수정할 수 있습니다.'}
            </p>
          )}
          {pending && (
            <p className="text-xs text-muted-foreground">
              {lang === 'en'
                ? `Generating in ${TEMPLATE_LABELS[template]} format…`
                : `${TEMPLATE_LABELS[template]} 형식으로 정리 중…`}
            </p>
          )}
          {status.state === 'error' && (
            <p className="text-xs text-destructive">
              {t('dictation.statusError')}: {status.message}
            </p>
          )}
          {hasContent && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {lang === 'en' ? 'Template' : '템플릿'} ·{' '}
                  {TEMPLATE_LABELS[serverResult?.template ?? template] ??
                    template}
                  {dirty && (
                    <span className="ml-2 text-yellow-300">
                      {lang === 'en' ? 'Edited (unsaved)' : '편집됨 (저장 안 됨)'}
                    </span>
                  )}
                </span>
                {dirty && (
                  <button
                    onClick={revertEdits}
                    className="text-xs underline-offset-2 hover:underline"
                  >
                    {lang === 'en' ? 'Revert' : '원본 복원'}
                  </button>
                )}
              </div>
              {draft.map((s, i) => (
                <div key={i} className="space-y-1">
                  {editing ? (
                    <input
                      value={s.heading}
                      onChange={(e) => updateSection(i, 'heading', e.target.value)}
                      className="w-full rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  ) : (
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.heading}
                    </div>
                  )}
                  <Separator />
                  {editing ? (
                    <textarea
                      value={s.body}
                      onChange={(e) => updateSection(i, 'body', e.target.value)}
                      className="min-h-[60px] w-full resize-y rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{s.body}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}
