import { buildConsentItems } from '@/lib/intake/consent';
import { resolveKiosk } from '@/lib/intake/kiosk';
import { selectLlmProvider } from '@/lib/llm';
import { isVoiceInputEnabled } from '@/lib/stt/clova';

import IntakeFlow from './IntakeFlow';

export const metadata = { title: '문진' };

/**
 * 요청마다 렌더링한다. 사전 렌더링하지 않는다.
 *
 * 아래 AI 동의는 LLM_PROVIDER 에서 가져온 처리자 이름을 적는다. 사전 렌더링을
 * 하면 그 이름이 빌드 시점에 정적 HTML 로 굳어버려서, 재빌드 없이 프로바이더를
 * 바꾸면 모든 환자에게 틀린 처리자를 명시한 동의서를 보여주게 된다. 이 페이지는
 * 싸지만, 법적 고지의 정확성은 그렇지 않다.
 *
 * 키오스크 해석도 여기서 미리 한다. 담당 의사에 연결되지 않은 태블릿은 환자가
 * 개인정보를 다 입력한 뒤 마지막에 실패하는 게 아니라, 첫 화면에서 바로
 * 접수처로 안내되어야 한다.
 */
export const dynamic = 'force-dynamic';

export default async function IntakePage({
  searchParams
}: {
  searchParams: Promise<{ k?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawKiosk = Array.isArray(params.k) ? params.k[0] : params.k;

  const resolution = resolveKiosk(rawKiosk);
  if (!resolution.ok) {
    console.error(
      `[intake] Refusing to render the intake flow: kiosk="${rawKiosk ?? ''}" ${resolution.reason}.`
    );
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 px-6 py-12">
        <h1 className="text-3xl font-bold">문진을 시작할 수 없습니다</h1>
        <p className="text-xl leading-relaxed text-slate-600">
          이 태블릿이 담당 의사와 연결되어 있지 않습니다. 접수처에 말씀해 주세요.
        </p>
      </main>
    );
  }

  // 서버측: AI 동의는 이 배포가 실제로 환자의 답변을 보내는 처리자를 이름으로
  // 적어야 한다.
  const consentItems = buildConsentItems(selectLlmProvider(process.env.LLM_PROVIDER));

  return (
    <main className="min-h-dvh bg-slate-50">
      {/* 담당 의사 uuid 는 클라이언트에 내려보내지 않는다. 슬러그만 보낸다 —
          서버가 다시 해석하므로 클라이언트가 의사를 바꿔치기할 수 없다. */}
      <IntakeFlow
        consentItems={consentItems}
        kioskSlug={resolution.slug}
        // CLOVA 자격증명이 없는 배포에서는 녹음 버튼을 아예 렌더링하지 않는다.
        // 눌렀더니 매번 실패하는 버튼은 없느니만 못하다.
        voiceEnabled={isVoiceInputEnabled()}
      />
    </main>
  );
}
