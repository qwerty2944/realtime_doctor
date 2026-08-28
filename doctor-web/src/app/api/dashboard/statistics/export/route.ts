/**
 * POST /api/dashboard/statistics/export
 *
 * Records that a doctor exported the statistics CSV (spec section 8).
 *
 * The file itself is built in the browser from data it already holds, so this route
 * moves no data -- it exists purely so the export leaves a trail. Aggregates are
 * de-identified, but "who pulled clinic-wide numbers, when, and for which period"
 * is exactly the question an audit log is asked after the fact.
 *
 * The audit write here is blocking: unlike the intake-start entry, nothing clinical
 * is interrupted by failing it, and the caller withholds the download when it fails.
 */

import { GENERIC_SERVER_ERROR, jsonError, parseJsonBody } from '@/lib/api';
import { logStatisticsExport } from '@/lib/audit';
import { requireDoctorForApi } from '@/lib/auth/doctor';
import { z } from 'zod';

import { DATE_PATTERN } from '@/lib/stats/period';

const exportRequestSchema = z.object({
  from: z.string().regex(DATE_PATTERN, '조회 기간이 올바르지 않습니다.'),
  to: z.string().regex(DATE_PATTERN, '조회 기간이 올바르지 않습니다.'),
  /** Row count in the exported file, so the entry says how much was taken. */
  rowCount: z.number().int().min(0).max(1_000_000),
});

export async function POST(request: Request): Promise<Response> {
  const auth = await requireDoctorForApi();
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(
    request,
    exportRequestSchema,
    '내보내기 요청이 올바르지 않습니다.',
  );
  if (!parsed.ok) return parsed.response;

  try {
    await logStatisticsExport({
      userId: auth.doctor.id,
      from: parsed.data.from,
      to: parsed.data.to,
      rowCount: parsed.data.rowCount,
    });

    return Response.json({ recorded: true });
  } catch (error) {
    console.error('[POST /api/dashboard/statistics/export] Failed to record the export.', error);
    return jsonError(500, GENERIC_SERVER_ERROR);
  }
}
