/**
 * Audit trail for the one recorded action the web dashboard still performs:
 * exporting the statistics CSV.
 *
 * This module used to write to a web-owned `audit_logs` table with a `doctor_id`
 * foreign key onto a web-owned `doctors` table. Neither exists in the app's
 * Supabase project, so the write is repointed at `public.web_stats_export_audit`
 * (migration `0014_web_statistics.sql`), whose owner column is a plain
 * `auth.users` reference.
 *
 * The service-role client is used because `web_stats_export_audit` grants nothing
 * to `authenticated`: an audit row a client can suppress, forge or edit is not an
 * audit row.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface StatisticsExportAuditEntry {
  /** The doctor who pulled the file. Resolved from the verified session. */
  userId: string;
  /** Inclusive period bounds of the export, YYYY-MM-DD in Asia/Seoul. */
  from: string;
  to: string;
  /** Rows in the produced file, so the entry says how much was taken. */
  rowCount: number;
}

/**
 * Record a statistics CSV export.
 *
 * Failures throw rather than being swallowed. The aggregates are de-identified,
 * but "who pulled clinic-wide numbers, when, and for which period" is exactly the
 * question an audit log is asked after the fact, and nothing clinical is
 * interrupted by refusing an export — so the caller withholds the download.
 */
export async function logStatisticsExport(entry: StatisticsExportAuditEntry): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from('web_stats_export_audit').insert({
    user_id: entry.userId,
    period_from: entry.from,
    period_to: entry.to,
    row_count: entry.rowCount,
  });

  if (error) {
    throw new Error(
      `Failed to record the statistics export for ${entry.userId} (${entry.from}..${entry.to}): ${error.message}`,
    );
  }
}
