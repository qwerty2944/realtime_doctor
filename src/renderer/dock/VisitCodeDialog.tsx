import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QrCode } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { useT } from '../shared/i18n';
import type { IssuedVisitCode, VisitCodeSettings } from '../../shared/types';

/**
 * 방문 코드 발급 (L1).
 *
 * **왜 dock 인가.** 스태프가 쓰는 표면이 이 앱뿐이다 — admin-web 은 아직
 * 배포되지 않았고, 배포돼도 환자를 앞에 두고 브라우저를 따로 여는 흐름은
 * 마찰이 가장 큰 지점에 마찰을 더한다. 0005 의 기기 한도 다이얼로그와
 * B4/B5 의 리포트·검토 다이얼로그가 dock 에 있는 것과 같은 이유다.
 *
 * **왜 dock 의 다른 버튼들과 나란히, 그리고 눈에 띄게.** 이건 하루에 수십 번
 * 눌리는 버튼이다. 설정 팝오버 안쪽에 넣으면 두 번 클릭이 되고, 두 번 클릭은
 * 접수처가 "그냥 슬러그로 열어두자" 를 고르게 만든다 — 그 순간 L1 이 통째로
 * 사라진다.
 *
 * 화면이 지켜야 하는 것 두 가지:
 *   1. **책상 건너에서 읽힌다.** 코드는 화면에서 가장 큰 글자이고, 4-3 으로
 *      끊어 고정폭으로 그린다.
 *   2. **QR 이 우선이다.** 어르신에게 7자를 받아 적게 하는 것보다 찍게 하는
 *      쪽이 실패가 적다. 다만 키오스크 주소가 설정되지 않았으면 QR 을 그리지
 *      않는다 — 열리지 않는 QR 은 환자 앞에서 실패하고 접수처는 원인을 모른다.
 *
 * 평문 코드는 어디에도 저장되지 않는다(발급 RPC 의 반환값에만 존재한다).
 * 그래서 다이얼로그를 닫으면 화면에서도 버린다 — 다시 보려면 새로 발급한다.
 */

/** 남은 시간을 `M:SS` 로. 만료된 뒤에는 null. */
function remaining(expiresAt: string, nowMs: number): string | null {
  const left = Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000);
  if (!Number.isFinite(left) || left <= 0) return null;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/**
 * QR 을 SVG 문자열로. 캔버스를 쓰지 않는 이유는 확대·인쇄에서 뭉개지지 않아야
 * 하기 때문이고, 이미지 파일을 만들지 않는 이유는 코드가 담긴 파일을 디스크에
 * 남기지 않기 위해서다.
 *
 * 오류정정 레벨 M: 태블릿 카메라가 각도를 두고 찍는 상황을 감당하면서 셀이
 * 지나치게 촘촘해지지 않는 지점이다.
 */
function QrSvg({ value, size }: { value: string; size: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const parts: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) parts.push(`M${col},${row}h1v1h-1z`);
      }
    }
    return { d: parts.join(''), count };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={value}
      width={size}
      height={size}
      viewBox={`0 0 ${path.count} ${path.count}`}
      shapeRendering="crispEdges"
      className="rounded-md bg-white p-2"
    >
      <path d={path.d} fill="#000000" />
    </svg>
  );
}

/** 알림톡 발송 상태. 미설정은 실패와 다른 값이다 — 화면 문구가 다르다. */
type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string };

export function VisitCodeDialog({
  onPopoverOpenChange
}: {
  onPopoverOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedVisitCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<VisitCodeSettings | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [slugDraft, setSlugDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 남은 시간 카운트다운. 다이얼로그가 열려 있고 코드가 있을 때만 돈다.
  useEffect(() => {
    if (!open || !issued) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, issued]);

  const errorText = useCallback(
    (code: string) => {
      switch (code) {
        case 'signed-out':
          return t('visitCode.errorSignedOut');
        case 'too-many-live':
          return t('visitCode.errorTooMany');
        case 'invalid-input':
          return t('visitCode.errorInvalidInput');
        default:
          return t('visitCode.errorFailed');
      }
    },
    [t]
  );

  /**
   * 발급 결과 하나를 화면에 반영한다. 익명 코드와 환자 등록형이 같은 상태를
   * 쓰므로(같은 코드·같은 QR·같은 카운트다운) 반영 경로도 하나다.
   */
  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof window.api.visitCode.issue>>) => {
      if (result.ok) {
        setIssued(result.issued);
        setSend({ kind: 'idle' });
        setCopied(false);
        setNowMs(Date.now());
      } else {
        setIssued(null);
        setError(errorText(result.error));
      }
    },
    [errorText]
  );

  const issue = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.visitCode.issue();
      if (!mounted.current) return;
      applyResult(result);
    } catch {
      if (mounted.current) setError(errorText('failed'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [applyResult, errorText]);

  /** 환자 등록 + 그 환자의 링크 발급. 이름이 비어 있으면 서버까지 가지 않는다. */
  const registerPatient = useCallback(async () => {
    if (nameDraft.trim() === '') {
      setError(errorText('invalid-input'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.visitCode.issueForPatient({
        name: nameDraft.trim(),
        phone: phoneDraft.trim() === '' ? null : phoneDraft.trim()
      });
      if (!mounted.current) return;
      applyResult(result);
    } catch {
      if (mounted.current) setError(errorText('failed'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [applyResult, errorText, nameDraft, phoneDraft]);

  const alimtalkErrorText = useCallback(
    (code: string) => {
      switch (code) {
        case 'not-configured':
          return t('visitCode.alimtalkNotConfigured');
        case 'no-phone':
          return t('visitCode.alimtalkNoPhone');
        case 'no-kiosk-url':
          return t('visitCode.alimtalkNoKioskUrl');
        case 'signed-out':
          return t('visitCode.errorSignedOut');
        default:
          return t('visitCode.alimtalkFailed');
      }
    },
    [t]
  );

  const sendAlimtalk = useCallback(async () => {
    if (!issued?.url) return;
    setSend({ kind: 'sending' });
    try {
      const result = await window.api.visitCode.sendAlimtalk(issued.id, issued.url);
      if (!mounted.current) return;
      if (result.ok) {
        setSend({ kind: 'sent' });
      } else {
        // 서버가 한 문장을 돌려줬으면 그걸 그대로 보여준다. 우리가 다시 쓰면
        // 실제 실패 사유가 화면에서 사라진다.
        setSend({ kind: 'error', message: result.message ?? alimtalkErrorText(result.error) });
      }
    } catch {
      if (mounted.current) setSend({ kind: 'error', message: alimtalkErrorText('failed') });
    }
  }, [alimtalkErrorText, issued]);

  const copyLink = useCallback(() => {
    if (!issued?.url) return;
    void navigator.clipboard.writeText(issued.url);
    setCopied(true);
  }, [issued]);

  const saveSettings = useCallback(async () => {
    const next = await window.api.visitCode.setSettings({
      kioskUrl: urlDraft,
      kioskSlug: slugDraft.trim() === '' ? null : slugDraft
    });
    setSettings(next);
    setUrlDraft(next.kioskUrl);
    setSlugDraft(next.kioskSlug ?? '');
  }, [urlDraft, slugDraft]);

  const left = issued ? remaining(issued.expiresAt, nowMs) : null;
  const expired = issued !== null && left === null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onPopoverOpenChange(next);
        setOpen(next);
        if (next) {
          setIssued(null);
          setError(null);
          setSend({ kind: 'idle' });
          setCopied(false);
          setNameDraft('');
          setPhoneDraft('');
          void window.api.visitCode.getSettings().then((s) => {
            setSettings(s);
            setUrlDraft(s.kioskUrl);
            setSlugDraft(s.kioskSlug ?? '');
          });
        } else {
          // 닫으면 화면에서도 버린다. 평문 코드는 아무 데도 저장되지 않는다.
          setIssued(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          title={t('visitCode.title')}
        >
          <QrCode className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('visitCode.patientTitle')}</DialogTitle>
          <DialogDescription>{t('visitCode.patientDesc')}</DialogDescription>
        </DialogHeader>

        {/* 환자 등록. 기본 경로이므로 맨 위에 있고, 빠른 코드는 아래로 내렸다. */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-muted-foreground" htmlFor="visit-code-patient-name">
            {t('visitCode.patientName')}
          </label>
          <Input
            id="visit-code-patient-name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={60}
            className="h-9"
          />
          <label className="text-[11px] text-muted-foreground" htmlFor="visit-code-patient-phone">
            {t('visitCode.patientPhone')}
          </label>
          <Input
            id="visit-code-patient-phone"
            value={phoneDraft}
            onChange={(e) => setPhoneDraft(e.target.value)}
            inputMode="tel"
            placeholder="01012345678"
            maxLength={20}
            className="h-9"
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t('visitCode.patientPhoneHint')}
          </p>
          <Button onClick={() => void registerPatient()} disabled={busy}>
            {issued?.patientId ? t('visitCode.registerAgain') : t('visitCode.register')}
          </Button>
        </div>

        {issued && !expired && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card/60 p-4">
            {issued.patientName && (
              <p className="text-sm font-medium">
                {t('visitCode.issuedFor')}: {issued.patientName}
              </p>
            )}

            {/* 화면에서 가장 큰 글자. 책상 건너에서 읽혀야 한다. */}
            <p className="font-mono text-5xl font-bold tracking-[0.2em] tabular-nums">
              {issued.formatted}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('visitCode.expiresIn')} {left}
            </p>

            {issued.url ? (
              <>
                <QrSvg value={issued.url} size={200} />
                <p className="text-center text-[11px] leading-snug text-muted-foreground">
                  {t('visitCode.qrHint')}
                </p>
                <div className="flex w-full flex-wrap justify-center gap-2">
                  <Button size="sm" variant="outline" onClick={copyLink}>
                    {copied ? t('visitCode.copied') : t('visitCode.copyLink')}
                  </Button>
                  {/* 번호가 없으면 버튼 자체를 렌더링하지 않는다 — 누를 때마다
                      실패하는 버튼은 없느니만 못하다. */}
                  {issued.patientPhone && (
                    <Button
                      size="sm"
                      onClick={() => void sendAlimtalk()}
                      disabled={send.kind === 'sending'}
                    >
                      {send.kind === 'sending'
                        ? t('visitCode.sending')
                        : t('visitCode.sendAlimtalk')}
                    </Button>
                  )}
                </div>
                {send.kind === 'sent' && (
                  <p className="text-center text-[11px] text-emerald-300">
                    {t('visitCode.sent')}
                  </p>
                )}
                {send.kind === 'error' && (
                  <p className="text-center text-[11px] leading-snug text-amber-300">
                    {send.message}
                  </p>
                )}
              </>
            ) : (
              <p className="text-center text-xs leading-snug text-amber-300">
                {t('visitCode.noKioskUrl')}
              </p>
            )}
          </div>
        )}

        {expired && (
          <p className="rounded-lg border border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">
            {t('visitCode.expired')}
          </p>
        )}

        {error && <p className="text-xs text-rose-300">{error}</p>}

        {/* 빠른 코드(환자 미지정). 남겨는 두되 기본 경로가 아니라는 것이
            자리와 크기로 드러나야 한다. */}
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs font-medium">{t('visitCode.quickTitle')}</p>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t('visitCode.quickHint')}
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => void issue()} disabled={busy}>
              {t('visitCode.issue')}
            </Button>
          </div>
        </div>

        <p className="text-[10px] leading-snug text-muted-foreground">
          {t('visitCode.note')}
        </p>

        {/* 설정. 자주 바뀌지 않으므로 아래에 둔다. */}
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs font-medium">{t('visitCode.settingsTitle')}</p>
          <label className="text-[11px] text-muted-foreground" htmlFor="visit-code-url">
            {t('visitCode.kioskUrl')}
          </label>
          <Input
            id="visit-code-url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://example.com/righthand/patient"
            className="h-8 text-xs"
          />
          <label className="text-[11px] text-muted-foreground" htmlFor="visit-code-slug">
            {t('visitCode.kioskSlug')}
          </label>
          <Input
            id="visit-code-slug"
            value={slugDraft}
            onChange={(e) => setSlugDraft(e.target.value)}
            placeholder="main"
            className="h-8 text-xs"
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t('visitCode.settingsHint')}
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={
                settings !== null &&
                urlDraft.trim().replace(/\/+$/, '') === settings.kioskUrl &&
                (slugDraft.trim() === '' ? null : slugDraft.trim().toLowerCase()) ===
                  settings.kioskSlug
              }
              onClick={() => void saveSettings()}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default VisitCodeDialog;
