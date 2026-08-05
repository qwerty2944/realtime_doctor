import Link from 'next/link';

/**
 * 대기실 태블릿의 홈 화면.
 *
 * 실제 운영에서는 태블릿이 `/intake?k=<슬러그>` 를 직접 열도록 설정하므로
 * 이 화면은 거의 보이지 않는다. 그래도 두는 이유는, 환자가 뒤로가기를 눌러
 * 여기로 떨어졌을 때 "빈 화면" 이 아니라 다시 시작할 버튼을 보게 하기 위해서다.
 * 여기서 `k` 를 붙여줄 수는 없으므로(어느 의사인지 모른다) 안내만 한다.
 */
export const dynamic = 'force-static';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold">사전 문진</h1>
        <p className="text-xl leading-relaxed text-slate-600">
          진료 전에 몇 가지만 여쭤봅니다. 편하게 답해 주시면 됩니다.
        </p>
      </div>

      <Link
        href="/intake"
        className="flex min-h-touch items-center justify-center rounded-2xl bg-blue-600 px-8 py-5 text-2xl font-semibold text-white transition-colors hover:bg-blue-700"
      >
        문진 시작하기
      </Link>

      <p className="text-base leading-relaxed text-slate-500">
        시작 화면이 열리지 않으면 접수처에 말씀해 주세요.
      </p>
    </main>
  );
}
