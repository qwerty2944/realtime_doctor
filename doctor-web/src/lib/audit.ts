/**
 * Audit trail for the recorded actions the web dashboard performs: exporting the
 * statistics CSV, and taking a copy of the desktop app installer.
 *
 * This module used to write to a web-owned `audit_logs` table with a `doctor_id`
 * foreign key onto a web-owned `doctors` table. Neither exists in the app's
 * Supabase project, so the write is repointed at `public.web_stats_export_audit`
 * (migration `0014_web_statistics.sql`), whose owner column is a plain
 * `auth.users` reference.
 *
 * The service-role client is used because neither audit table grants anything to
 * `authenticated`: an audit row a client can suppress, forge or edit is not an
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

export interface AppDownloadAuditEntry {
  /** The doctor the URL was minted for. Resolved from the verified session. */
  userId: string;
  /** Stable artifact key, e.g. 'mac-universal'. */
  artifactKey: string;
  appVersion: string;
  storagePath: string;
  /** Digest published for this artifact at grant time. */
  sha256: string;
  urlTtlSeconds: number;
  /** Null when the forwarded address is absent or unparseable. */
  requestIp: string | null;
  userAgent: string | null;
}

/**
 * Record that a signed installer URL was minted for a doctor.
 *
 * The installers carry the owner's API keys, so an untraceable copy is the thing
 * this whole gate exists to prevent. Failures therefore throw and the caller
 * discards the URL rather than handing out a download nobody can attribute --
 * the same posture as the statistics export, and for a stronger reason.
 *
 * The row attests to a GRANT, not to a completed transfer: the bytes move
 * directly between the browser and Storage, and this server never sees them.
 */
export async function logAppDownload(entry: AppDownloadAuditEntry): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from('web_app_download_audit').insert({
    user_id: entry.userId,
    artifact_key: entry.artifactKey,
    app_version: entry.appVersion,
    storage_path: entry.storagePath,
    sha256: entry.sha256,
    url_ttl_seconds: entry.urlTtlSeconds,
    request_ip: entry.requestIp,
    user_agent: entry.userAgent,
  });

  if (error) {
    throw new Error(
      `Failed to record the app download for ${entry.userId} (${entry.artifactKey}): ${error.message}`,
    );
  }
}
