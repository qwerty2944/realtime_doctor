import { ACTIVE_GEMINI_MODELS, PRICING, isUnpriced } from '@/lib/pricing';
import { requireAdmin } from '@/lib/admin-gate';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">가격표</h1>
        <p className="mt-1 text-xs text-foreground/50">
          소스 코드(<code className="text-foreground/70">admin-web/lib/pricing.ts</code>)에
          하드코딩된 단가. 변경 시 redeploy 필요.
        </p>
      </div>

      <Section title="Gemini (per 1M tokens)">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground/50">
              <th className="px-3 py-2 text-left">모델</th>
              <th className="px-3 py-2 text-right">입력</th>
              <th className="px-3 py-2 text-right">출력</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(PRICING.gemini).map(([model, p]) => {
              const active = (ACTIVE_GEMINI_MODELS as readonly string[]).includes(model);
              return (
                <tr key={model} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-mono">
                    {model}
                    {active && (
                      <span className="ml-2 rounded bg-accent/20 px-1.5 py-0.5 font-sans text-[10px] text-accent">
                        사용 중
                      </span>
                    )}
                  </td>
                  {isUnpriced(p) ? (
                    <td className="px-3 py-2 text-right text-amber-400" colSpan={2}>
                      미산정 — 단가 미등록
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right font-mono">
                        ${p.input_per_1m.toFixed(3)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        ${p.output_per_1m.toFixed(3)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-foreground/50">
          &quot;사용 중&quot; 은 <code className="text-foreground/70">ACTIVE_GEMINI_MODELS</code>{' '}
          목록이고, 이 목록의 모델은 가격표에 항목이 없으면 typecheck 가 깨진다. 항목은
          있으나 단가가 없는 모델(미산정)은 비용 합계에서 제외되고 각 화면에 경고로
          표시된다.
        </p>
      </Section>

      <Section title="OpenAI Realtime (per minute audio)">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground/50">
              <th className="px-3 py-2 text-left">모델</th>
              <th className="px-3 py-2 text-right">분당 USD</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(PRICING['openai-realtime']).map(([model, p]) => (
              <tr key={model} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2 font-mono">{model}</td>
                <td className="px-3 py-2 text-right font-mono">
                  ${p.audio_per_minute_usd.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="CLOVA">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-foreground/50">
              <th className="px-3 py-2 text-left">모델</th>
              <th className="px-3 py-2 text-right">단가</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/40">
              <td className="px-3 py-2 font-mono">clova-csr</td>
              <td className="px-3 py-2 text-right font-mono">
                ${PRICING.clova['clova-csr'].per_chunk_usd.toFixed(4)} / 청크
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-mono">clova-stream</td>
              <td className="px-3 py-2 text-right font-mono">
                ${PRICING.clova['clova-stream'].per_minute_usd.toFixed(4)} / 분
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}
