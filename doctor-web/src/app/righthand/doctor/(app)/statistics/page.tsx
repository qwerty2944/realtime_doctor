import StatisticsView from '@/app/righthand/doctor/(app)/statistics/StatisticsView';
import { resolvePeriod } from '@/lib/stats/period';
import { loadStatistics } from '@/lib/stats/queries';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata = { title: '통계' };

// Today's numbers change as patients finish intake; a cached render would show a
// doctor a clinic day that already moved on.
export const dynamic = 'force-dynamic';

export default async function StatisticsPage() {
  const supabase = await createSupabaseServerClient();

  // Rendered server-side for the default period so the tab opens with data rather
  // than a spinner; changing the period re-fetches through the API route.
  const range = resolvePeriod('today');
  const initialData = await loadStatistics(supabase, range);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="t3 font-semibold text-content-primary">통계</h1>
        <p className="mt-1 t-meta text-content-tertiary">
          환자 식별정보가 포함되지 않은 집계 데이터입니다.
        </p>
      </div>

      <StatisticsView initialData={initialData} />
    </main>
  );
}
