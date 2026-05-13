'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

export function DailyCostLine({
  data
}: {
  data: { date: string; cost: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid stroke="#22304a" strokeDasharray="3 3" />
        <XAxis dataKey="date" stroke="#7a8aa8" tickLine={false} fontSize={11} />
        <YAxis stroke="#7a8aa8" tickLine={false} fontSize={11} width={50} />
        <Tooltip
          contentStyle={{
            background: '#101a2f',
            border: '1px solid #22304a',
            borderRadius: 6,
            fontSize: 12
          }}
          formatter={(v: number) => `$${v.toFixed(4)}`}
        />
        <Line
          type="monotone"
          dataKey="cost"
          stroke="#18b6c8"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ProviderCallsBar({
  data
}: {
  data: { provider: string; calls: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid stroke="#22304a" strokeDasharray="3 3" />
        <XAxis
          dataKey="provider"
          stroke="#7a8aa8"
          tickLine={false}
          fontSize={11}
        />
        <YAxis stroke="#7a8aa8" tickLine={false} fontSize={11} width={50} />
        <Tooltip
          contentStyle={{
            background: '#101a2f',
            border: '1px solid #22304a',
            borderRadius: 6,
            fontSize: 12
          }}
        />
        <Bar dataKey="calls" fill="#18b6c8" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailySessionsLine({
  data
}: {
  data: { date: string; sessions: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid stroke="#22304a" strokeDasharray="3 3" />
        <XAxis dataKey="date" stroke="#7a8aa8" tickLine={false} fontSize={11} />
        <YAxis stroke="#7a8aa8" tickLine={false} fontSize={11} width={36} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: '#101a2f',
            border: '1px solid #22304a',
            borderRadius: 6,
            fontSize: 12
          }}
          formatter={(v: number) => `${v} 세션`}
        />
        <Line
          type="monotone"
          dataKey="sessions"
          stroke="#a78bfa"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TaskCostBar({
  data
}: {
  data: { task: string; cost: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid stroke="#22304a" strokeDasharray="3 3" />
        <XAxis dataKey="task" stroke="#7a8aa8" tickLine={false} fontSize={11} />
        <YAxis stroke="#7a8aa8" tickLine={false} fontSize={11} width={50} />
        <Tooltip
          contentStyle={{
            background: '#101a2f',
            border: '1px solid #22304a',
            borderRadius: 6,
            fontSize: 12
          }}
          formatter={(v: number) => `$${v.toFixed(4)}`}
        />
        <Bar dataKey="cost" fill="#18b6c8" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
