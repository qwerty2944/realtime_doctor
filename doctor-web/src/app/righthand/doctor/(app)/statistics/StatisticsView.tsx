'use client';

/**
 * Statistics tab (spec section 4-2).
 *
 * Charts, a period filter and a CSV export over de-identified aggregates. Nothing
 * on this screen or in the export identifies a patient: the API returns counts
 * keyed by day, diagnosis and chief complaint only.
 */

import { useCallback, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type PieLabelRenderProps,
} from 'recharts';
import { AlertTriangle, Download, Loader2, Timer, Users } from 'lucide-react';

import type { StatisticsResponse } from '@/app/api/dashboard/statistics/route';
import { Button } from '@/components/ui';
import { buildStatisticsCsv, statisticsCsvFilename } from '@/lib/stats/csv';
import {
  formatRange,
  isValidDate,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  seoulToday,
  type PeriodPreset,
} from '@/lib/stats/period';
import type { StatisticsData } from '@/lib/stats/queries';

/**
 * Chart palette mirrored from the TDS tokens in globals.css (recharts needs literal
 * colour values, so these cannot be Tailwind utilities). The guide's rule is to
 * emphasise one meaningful series and let the rest recede: the action blue and the
 * danger red carry meaning; greys are neutral supporting tones.
 */
const CHART = {
  grid: '#e2e5ec', // line-default
  axis: '#8b95a1', // grey-500
  action: '#2456e6', // action — brand cobalt, primary emphasis
  danger: '#f04452', // status-danger / red-500 — red-flag emphasis
  neutralBar: '#d1d6db', // grey-300 — receding bars
} as const;

/** First slice is the emphasised action cobalt; the tail recedes into greys. */
const PIE_COLORS = ['#2456e6', '#6b7684', '#8b95a1', '#b0b8c1', '#d1d6db', '#e5e8eb'];

const MAX_DIAGNOSIS_BARS = 10;
const MAX_COMPLAINT_SLICES = 6;

export default function StatisticsView({ initialData }: { initialData: StatisticsData }) {
  const [data, setData] = useState<StatisticsData>(initialData);
  const [preset, setPreset] = useState<PeriodPreset>('today');
  const [customFrom, setCustomFrom] = useState(seoulToday());
  const [customTo, setCustomTo] = useState(seoulToday());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatistics = useCallback(
    async (nextPreset: PeriodPreset, from: string, to: string) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ preset: nextPreset });
        if (nextPreset === 'custom') {
          params.set('from', from);
          params.set('to', to);
        }

        const response = await fetch(`/api/dashboard/statistics?${params.toString()}`);

        if (!response.ok) {
          setError(await readError(response));
          return;
        }

        setData((await response.json()) as StatisticsResponse);
      } catch (caught) {
        console.error('[statistics] Failed to load statistics.', caught);
        setError('연결에 문제가 있습니다. 잠시 후 다시 시도해 주세요.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const selectPreset = (next: PeriodPreset) => {
    setPreset(next);
    // 사용자 지정 waits for 조회; the bounds are not meaningful until both are set.
    if (next !== 'custom') void fetchStatistics(next, customFrom, customTo);
  };

  const applyCustom = () => {
    if (!isValidDate(customFrom) || !isValidDate(customTo)) {
      setError('조회 기간을 올바르게 선택해 주세요.');
      return;
    }
    void fetchStatistics('custom', customFrom, customTo);
  };

  const handleExport = async () => {
    // Spec section 8: the export is recorded before the file is produced. The
    // aggregates are de-identified, but "who pulled clinic-wide numbers and for
    // which period" is exactly what an audit log is asked after the fact.
    //
    // A failed audit write blocks the download rather than being ignored: unlike
    // the patient-facing intake path, nothing clinical is interrupted by refusing
    // an export, so an unrecorded export is not worth allowing.
    const recorded = await fetch('/api/dashboard/statistics/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: data.range.from,
        to: data.range.to,
        rowCount:
          data.daily.length + data.diagnoses.length + data.chiefComplaints.length,
      }),
    }).catch((caught: unknown) => {
      console.error('[statistics] Failed to record the CSV export.', caught);
      return null;
    });

    if (!recorded || !recorded.ok) {
      setError('내보내기 기록을 저장하지 못해 다운로드를 중단했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    setError('');

    const csv = buildStatisticsCsv(data);
    // The BOM must survive to the file, so the Blob is built from the string as-is
    // with an explicit UTF-8 charset rather than re-encoded.
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = statisticsCsvFilename(data);
    link.click();

    URL.revokeObjectURL(url);
  };

  const diagnosisBars = data.diagnoses.slice(0, MAX_DIAGNOSIS_BARS);
  const complaintSlices = collapseTail(data.chiefComplaints, MAX_COMPLAINT_SLICES);

  return (
    <div className="flex flex-col gap-6">
      {/* Period filter */}
      <section className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line-default bg-surface-default px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1">
            {PERIOD_PRESETS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => selectPreset(item)}
                aria-pressed={preset === item}
                className={`rounded-lg border px-3 py-1.5 t6 transition-colors ${
                  preset === item
                    ? 'border-action bg-action text-white'
                    : 'border-line-strong text-content-secondary hover:bg-surface-canvas'
                }`}
              >
                {PERIOD_LABELS[item]}
              </button>
            ))}
          </div>

          {preset === 'custom' ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 t7 text-content-tertiary">
                시작일
                <input
                  type="date"
                  value={customFrom}
                  max={seoulToday()}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="rounded-lg border border-line-strong bg-surface-default px-2 py-1.5 t6 text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                />
              </label>
              <label className="flex flex-col gap-1 t7 text-content-tertiary">
                종료일
                <input
                  type="date"
                  value={customTo}
                  max={seoulToday()}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="rounded-lg border border-line-strong bg-surface-default px-2 py-1.5 t6 text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                />
              </label>
              <Button size="sm" onClick={applyCustom}>
                조회
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {loading ? (
            <span className="flex items-center gap-1.5 t7 text-content-tertiary">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              불러오는 중
            </span>
          ) : (
            <span className="t7 text-content-tertiary">{formatRange(data.range)}</span>
          )}

          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-1.5 t6 text-content-secondary transition-colors hover:bg-surface-canvas disabled:opacity-50"
          >
            <Download aria-hidden="true" className="size-4" />
            CSV 내보내기
          </button>
        </div>
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-danger bg-status-danger-weak px-4 py-3 t6 text-status-danger"
        >
          {error}
        </p>
      ) : null}

      {/*
        Summary tiles. There is deliberately no "확정 진단" tile: the native app
        stores no clinician-confirmed diagnosis (its decision trail, migration
        0012, explicitly refuses to record adoption or override), so the figure
        would be a permanent zero dressed up as a measurement.
      */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          icon={<Users aria-hidden="true" className="size-4" />}
          label="문진 완료"
          value={`${data.summary.encounterCount}건`}
          detail={formatRange(data.range)}
        />
        <Tile
          icon={<AlertTriangle aria-hidden="true" className="size-4" />}
          label="레드플래그 발생"
          value={`${data.summary.redFlagCount}건`}
          detail={
            data.summary.encounterCount === 0
              ? '해당 기간 문진 없음'
              : `전체의 ${Math.round((data.summary.redFlagCount / data.summary.encounterCount) * 100)}%`
          }
        />
        <Tile
          icon={<Timer aria-hidden="true" className="size-4" />}
          label="평균 문진 소요 시간"
          value={formatDuration(data.summary.avgDurationSeconds)}
          detail={`집계 대상 ${data.summary.measuredEncounters}건`}
        />
      </section>

      {/* Visit trend */}
      <ChartCard title="날짜별 내원 추이" empty={data.daily.length === 0}>
        <LineChart data={data.daily} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={shortDay} stroke={CHART.axis} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={CHART.axis} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="encounterCount"
            name="문진 완료"
            stroke={CHART.action}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="redFlagCount"
            name="레드플래그"
            stroke={CHART.danger}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Diagnosis distribution */}
        <ChartCard
          title="질환별 분포"
          note="AI 1순위 감별진단 기준 (의사 확정 진단은 기록되지 않습니다)"
          empty={diagnosisBars.length === 0}
        >
          <BarChart
            data={diagnosisBars}
            layout="vertical"
            margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke={CHART.axis} />
            <YAxis
              type="category"
              dataKey="diagnosis"
              width={120}
              tick={{ fontSize: 11 }}
              stroke={CHART.axis}
            />
            <Tooltip />
            {/* Emphasise only the leading diagnosis (rows arrive sorted); the rest
                recede into neutral grey per the palette guide. */}
            <Bar dataKey="encounterCount" name="건수" radius={[0, 3, 3, 0]}>
              {diagnosisBars.map((row, index) => (
                <Cell
                  key={row.diagnosis}
                  fill={index === 0 ? CHART.action : CHART.neutralBar}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>

        {/* Chief complaint distribution */}
        <ChartCard title="주소증별 분포" empty={complaintSlices.length === 0}>
          <PieChart>
            <Pie
              data={complaintSlices}
              dataKey="encounterCount"
              nameKey="chiefComplaint"
              outerRadius={90}
              label={renderSliceLabel}
              labelLine={false}
            >
              {complaintSlices.map((slice, index) => (
                <Cell key={slice.chiefComplaint} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ChartCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

function Tile({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line-default bg-surface-default px-4 py-3">
      <span className="flex items-center gap-1.5 t7 text-content-tertiary">
        {icon}
        {label}
      </span>
      <span className="t2 font-bold text-content-primary">{value}</span>
      <span className="t7 text-content-tertiary">{detail}</span>
    </div>
  );
}

function ChartCard({
  title,
  note,
  empty,
  children,
}: {
  title: string;
  note?: string;
  empty: boolean;
  children: React.ReactElement;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line-default bg-surface-default px-4 py-4">
      <div>
        <h2 className="t5 font-semibold text-content-primary">{title}</h2>
        {note ? <p className="mt-0.5 t7 text-content-tertiary">{note}</p> : null}
      </div>

      {empty ? (
        <p className="px-4 py-16 text-center t6 text-content-tertiary">
          해당 기간에 표시할 데이터가 없습니다.
        </p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/** Pie slice label. `name` is populated by Pie from `nameKey`. */
function renderSliceLabel(props: PieLabelRenderProps): string {
  return String(props.name ?? '');
}

/** MM-DD; the year is already stated by the period label above the chart. */
function shortDay(day: string): string {
  return day.slice(5);
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '-';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes === 0 ? `${remainder}초` : `${minutes}분 ${remainder}초`;
}

/**
 * Keep the largest slices and fold the rest into 기타.
 *
 * A pie with thirty slices communicates nothing, and the long tail of one-off chief
 * complaints is exactly that.
 */
function collapseTail(
  slices: StatisticsData['chiefComplaints'],
  limit: number,
): StatisticsData['chiefComplaints'] {
  if (slices.length <= limit) return slices;

  const head = slices.slice(0, limit - 1);
  const tailCount = slices
    .slice(limit - 1)
    .reduce((total, slice) => total + slice.encounterCount, 0);

  return [...head, { chiefComplaint: '기타', encounterCount: tailCount }];
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // Fall through to the generic message.
  }
  return '통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
