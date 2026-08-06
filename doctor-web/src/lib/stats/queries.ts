/**
 * Statistics reads. SERVER ONLY.
 *
 * Every figure comes from the SQL functions in `supabase/migrations-app/
 * 0014_web_statistics.sql`, which aggregate on the database side over the native
 * app's `encounters` + `intake_results`. Nothing here re-aggregates in JS, and
 * nothing here selects a patient identifier — the functions do not return one, so
 * the de-identification requirement holds structurally rather than by remembering
 * to omit a column.
 *
 * The functions are `f_web_`-prefixed and SECURITY DEFINER. The prefix keeps them
 * distinct from the app's own objects; SECURITY DEFINER means the per-clinician
 * scope is a `user_id = auth.uid()` predicate written inside each function rather
 * than an RLS policy, so these calls return this doctor's numbers and no one
 * else's. See the migration header.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { addDays, dayCount, type DateRange } from '@/lib/stats/period';

export interface DailyPoint {
  day: string;
  encounterCount: number;
  redFlagCount: number;
}

export interface DiagnosisSlice {
  diagnosis: string;
  encounterCount: number;
}

export interface ChiefComplaintSlice {
  chiefComplaint: string;
  encounterCount: number;
}

export interface StatsSummary {
  encounterCount: number;
  redFlagCount: number;
  avgDurationSeconds: number;
  /** Encounters that had a stored intake result and so contributed to the average. */
  measuredEncounters: number;
}

export interface StatisticsData {
  range: DateRange;
  summary: StatsSummary;
  daily: DailyPoint[];
  diagnoses: DiagnosisSlice[];
  chiefComplaints: ChiefComplaintSlice[];
}

/** A range wider than this would put more points on the line chart than pixels. */
const MAX_RANGE_DAYS = 366;

function toNumber(value: unknown): number {
  // Postgres bigint arrives as a string through PostgREST when it exceeds the
  // safe-integer range, and the client is not consistent about it either way.
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

async function callRpc(
  supabase: SupabaseClient,
  fn: string,
  range: DateRange,
): Promise<unknown[]> {
  const { data, error } = await supabase.rpc(fn, { p_from: range.from, p_to: range.to });

  if (error) {
    throw new Error(`Statistics function ${fn} failed for ${range.from}..${range.to}: ${error.message}`);
  }

  return Array.isArray(data) ? data : data === null ? [] : [data];
}

/**
 * Fill days with no encounters.
 *
 * The SQL functions only return days that have rows, which would make the line
 * chart skip empty days and draw a straight line across a closed weekend as though
 * patients had arrived during it.
 */
function fillMissingDays(range: DateRange, points: DailyPoint[]): DailyPoint[] {
  const byDay = new Map(points.map((point) => [point.day, point]));
  const filled: DailyPoint[] = [];

  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    filled.push(byDay.get(day) ?? { day, encounterCount: 0, redFlagCount: 0 });
  }

  return filled;
}

/** Everything the statistics tab renders, for one period. */
export async function loadStatistics(
  supabase: SupabaseClient,
  range: DateRange,
): Promise<StatisticsData> {
  if (dayCount(range) > MAX_RANGE_DAYS) {
    throw new Error(`Requested range spans more than ${MAX_RANGE_DAYS} days.`);
  }

  const [summaryRows, dailyRows, diagnosisRows, complaintRows] = await Promise.all([
    callRpc(supabase, 'f_web_stats_summary', range),
    callRpc(supabase, 'f_web_stats_daily', range),
    callRpc(supabase, 'f_web_stats_diagnosis', range),
    callRpc(supabase, 'f_web_stats_chief_complaint', range),
  ]);

  const summaryRow = (summaryRows[0] ?? {}) as Record<string, unknown>;

  return {
    range,
    summary: {
      encounterCount: toNumber(summaryRow.encounter_count),
      redFlagCount: toNumber(summaryRow.red_flag_count),
      avgDurationSeconds: toNumber(summaryRow.avg_duration_seconds),
      measuredEncounters: toNumber(summaryRow.measured_encounters),
    },
    daily: fillMissingDays(
      range,
      (dailyRows as Record<string, unknown>[]).map((row) => ({
        day: String(row.day ?? ''),
        encounterCount: toNumber(row.encounter_count),
        redFlagCount: toNumber(row.red_flag_count),
      })),
    ),
    diagnoses: (diagnosisRows as Record<string, unknown>[]).map((row) => ({
      diagnosis: String(row.diagnosis ?? '미분류'),
      encounterCount: toNumber(row.encounter_count),
    })),
    chiefComplaints: (complaintRows as Record<string, unknown>[]).map((row) => ({
      chiefComplaint: String(row.chief_complaint ?? '미기재'),
      encounterCount: toNumber(row.encounter_count),
    })),
  };
}
