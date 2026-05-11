import { PRICING } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

export default function PricingPage() {
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
            {Object.entries(PRICING.gemini).map(([model, p]) => (
              <tr key={model} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2 font-mono">{model}</td>
                <td className="px-3 py-2 text-right font-mono">
                  ${p.input_per_1m.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  ${p.output_per_1m.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
