/**
 * GET /api/dashboard/statistics?preset=&from=&to=
 *
 * Aggregates for the statistics tab (spec section 4-2). The period filter is
 * interactive, so the tab re-fetches here instead of reloading the page.
 *
 * Reads run through the cookie-backed client, not the service role: the statistics
 * functions are SECURITY INVOKER, so the signed-in doctor's RLS policies still
 * apply. Everything returned is de-identified aggregate data.
 */

import type { NextRequest } from 'next/server';

import { GENERIC_SERVER_ERROR, jsonError } from '@/lib/api';
import { requireDoctorForApi } from '@/lib/auth/doctor';
import {
  isValidDate,
  PERIOD_PRESETS,
  resolvePeriod,
  type PeriodPreset,
} from '@/lib/stats/period';
import { loadStatistics, type StatisticsData } from '@/lib/stats/queries';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type StatisticsResponse = StatisticsData;

function readPreset(value: string | null): PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(value ?? '')
    ? (value as PeriodPreset)
    : 'today';
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireDoctorForApi();
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const preset = readPreset(params.get('preset'));

  const from = params.get('from');
  const to = params.get('to');

  if (preset === 'custom' && (!isValidDate(from) || !isValidDate(to))) {
    return jsonError(400, '조회 기간을 올바르게 선택해 주세요.');
  }

  const range = resolvePeriod(preset, { from: from ?? undefined, to: to ?? undefined });

  try {
    const supabase = await createSupabaseServerClient();
    const data = await loadStatistics(supabase, range);

    return Response.json(data satisfies StatisticsResponse);
  } catch (error) {
    console.error(
      `[GET /api/dashboard/statistics] Failed for ${range.from}..${range.to}.`,
      error,
    );
    return jsonError(500, GENERIC_SERVER_ERROR);
  }
}
