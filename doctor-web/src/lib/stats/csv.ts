/**
 * CSV export for the statistics tab (spec section 4-2).
 *
 * Pure string building, no server import: the browser already holds the data it is
 * looking at, so exporting it does not need a second query.
 *
 * De-identification: the input {@link StatisticsData} carries only aggregates, so
 * there is no identifier here to omit. Do not extend this file to accept per-session
 * rows without revisiting that.
 */

import { formatRange } from '@/lib/stats/period';
import type { StatisticsData } from '@/lib/stats/queries';

/**
 * Excel decides a UTF-8 file is in the local ANSI code page unless it starts with a
 * byte order mark, which turns every Korean label into mojibake. The BOM is the fix
 * and is why this cannot be a plain `join('\n')`.
 */
export const UTF8_BOM = '﻿';

/**
 * Quote a CSV field.
 *
 * Always quoted rather than only when necessary: a Korean chief complaint may
 * legitimately contain a comma, and a leading `=`, `+`, `-` or `@` would otherwise
 * be interpreted by Excel as a formula.
 */
function csvField(value: string | number): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvField).join(',');
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}분 ${remainder}초`;
}

/**
 * Render the whole view as one CSV.
 *
 * Sections are separated by a blank line and each carries its own header row. A
 * single flat table would need a "section" column repeated on every line, which
 * reads worse in Excel than four labelled blocks.
 */
export function buildStatisticsCsv(data: StatisticsData): string {
  const lines: string[] = [];

  lines.push(csvRow(['통계 기간', formatRange(data.range)]));
  lines.push(csvRow(['비고', '환자 식별정보가 포함되지 않은 집계 데이터입니다.']));
  lines.push('');

  lines.push(csvRow(['요약']));
  lines.push(csvRow(['항목', '값']));
  lines.push(csvRow(['문진 완료 건수', data.summary.encounterCount]));
  lines.push(csvRow(['레드플래그 건수', data.summary.redFlagCount]));
  lines.push(csvRow(['평균 문진 소요 시간', formatDuration(data.summary.avgDurationSeconds)]));
  lines.push(csvRow(['소요 시간 집계 대상 건수', data.summary.measuredEncounters]));
  lines.push('');

  lines.push(csvRow(['날짜별 내원 추이']));
  lines.push(csvRow(['날짜', '문진 완료 건수', '레드플래그 건수']));
  for (const point of data.daily) {
    lines.push(csvRow([point.day, point.encounterCount, point.redFlagCount]));
  }
  lines.push('');

  // No "확정 진단 건수" column: the native app records no clinician-confirmed
  // diagnosis anywhere (see the migration header), so the figure would be a
  // permanent zero presented as a measurement.
  lines.push(csvRow(['질환별 분포']));
  lines.push(csvRow(['진단명', '건수']));
  for (const slice of data.diagnoses) {
    lines.push(csvRow([slice.diagnosis, slice.encounterCount]));
  }
  lines.push('');

  lines.push(csvRow(['주소증별 분포']));
  lines.push(csvRow(['주소증', '건수']));
  for (const slice of data.chiefComplaints) {
    lines.push(csvRow([slice.chiefComplaint, slice.encounterCount]));
  }

  // CRLF: the line ending Excel expects on every platform.
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

export function statisticsCsvFilename(data: StatisticsData): string {
  return `righthand-statistics-${data.range.from}_${data.range.to}.csv`;
}
