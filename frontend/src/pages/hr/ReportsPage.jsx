import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { BarChart2, TrendingUp, UserCheck, Clock } from 'lucide-react';
import { reportsApi } from '@/api/reports';

const DAYS_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '6 months', value: 180 },
  { label: '1 year', value: 365 },
];

const TABS = [
  { key: 'funnel',    label: 'Hiring Funnel',       icon: TrendingUp },
  { key: 'source',    label: 'Source Analysis',      icon: BarChart2 },
  { key: 'referral',  label: 'Referral Performance', icon: UserCheck },
  { key: 'tth',       label: 'Time to Hire',         icon: Clock },
];

const PIE_COLORS = ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff', '#f0abfc', '#fca5a5'];
const BAR_COLORS = ['#6366f1', '#818cf8', '#93c5fd', '#67e8f9', '#6ee7b7', '#fde68a', '#fca5a5', '#86efac'];

const STAGE_LABELS = {
  applied: 'Applied', screening: 'Screening', assessment: 'Assessment',
  interview_1: 'Interview 1', interview_2: 'Interview 2',
  final_interview: 'Final', offer: 'Offer', hired: 'Hired',
};

const STATUS_LABELS = {
  pending: 'Pending', invited: 'Invited', applied: 'Applied',
  in_progress: 'In Progress', hired: 'Hired', rejected: 'Rejected', expired: 'Expired',
};

function EmptyState({ text }) {
  return (
    <div className="h-64 flex items-center justify-center text-gray-300 text-sm">{text}</div>
  );
}

function HiringFunnelReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-funnel', days],
    queryFn: () => reportsApi.hiringFunnel({ days }).then((r) => r.data),
  });

  const chartData = (data ?? []).filter((d) => d.count > 0);

  if (isLoading) return <EmptyState text="Loading..." />;
  if (!chartData.length) return <EmptyState text="No data for this period" />;

  return (
    <div className="space-y-6">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="stage"
            tickFormatter={(s) => STAGE_LABELS[s] ?? s}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            interval={0} angle={-30} textAnchor="end" height={52}
          />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
          <Tooltip
            labelFormatter={(s) => STAGE_LABELS[s] ?? s}
            formatter={(v) => [v, 'Candidates']}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {chartData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {chartData.map((d) => (
          <div key={d.stage} className="bg-surface-50 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-gray-900">{d.count}</p>
            <p className="text-xs text-gray-500 mt-0.5">{STAGE_LABELS[d.stage] ?? d.stage}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceAnalysisReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-source', days],
    queryFn: () => reportsApi.sourceAnalysis({ days }).then((r) => r.data),
  });

  if (isLoading) return <EmptyState text="Loading..." />;
  if (!data?.length) return <EmptyState text="No data for this period" />;

  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="source" cx="50%" cy="50%" outerRadius={110} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v, name) => [v, name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>

      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={d.source} className="flex items-center justify-between p-3 bg-surface-50 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-sm capitalize text-gray-700">{d.source}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-24 bg-surface-200 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${(d.count / total) * 100}%`, background: PIE_COLORS[i % PIE_COLORS.length] }}
                />
              </div>
              <span className="text-sm font-semibold text-gray-900 w-8 text-right">{d.count}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReferralPerformanceReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-referral', days],
    queryFn: () => reportsApi.referralPerformance({ days }).then((r) => r.data),
  });

  if (isLoading) return <EmptyState text="Loading..." />;
  if (!data?.total) return <EmptyState text="No referrals in this period" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-surface-50 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-gray-900">{data.total}</p>
          <p className="text-sm text-gray-500 mt-1">Total Referrals</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-green-700">
            {data.by_status.find((s) => s.status === 'hired')?.count ?? 0}
          </p>
          <p className="text-sm text-green-600 mt-1">Hired</p>
        </div>
        <div className="bg-yellow-50 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-yellow-700">{data.bonus_paid}</p>
          <p className="text-sm text-yellow-600 mt-1">Bonuses Paid</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data.by_status.filter((d) => d.count > 0)} margin={{ bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="status" tickFormatter={(s) => STATUS_LABELS[s] ?? s} tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
          <Tooltip labelFormatter={(s) => STATUS_LABELS[s] ?? s} formatter={(v) => [v, 'Referrals']} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TimeToHireReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-tth', days],
    queryFn: () => reportsApi.timeToHire({ days }).then((r) => r.data),
  });

  if (isLoading) return <EmptyState text="Loading..." />;
  if (!data?.length) return <EmptyState text="No hired candidates in this period" />;

  return (
    <div className="space-y-6">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} unit="d" />
          <YAxis dataKey="department" type="category" tick={{ fontSize: 11, fill: '#94a3b8' }} width={100} />
          <Tooltip
            formatter={(v, name) => [`${v} days`, name === 'avg_days' ? 'Avg' : name === 'min_days' ? 'Min' : 'Max']}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Bar dataKey="min_days" fill="#bbf7d0" name="Min" radius={[0, 0, 0, 0]} />
          <Bar dataKey="avg_days" fill="#6366f1" name="Avg" radius={[0, 4, 4, 0]} />
          <Bar dataKey="max_days" fill="#c7d2fe" name="Max" radius={[0, 4, 4, 0]} />
          <Legend />
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200">
              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Department</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Avg Days</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Min Days</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Max Days</th>
              <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Hires</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {data.map((row) => (
              <tr key={row.department} className="hover:bg-surface-50">
                <td className="py-2.5 px-3 font-medium text-gray-900">{row.department}</td>
                <td className="py-2.5 px-3 text-right text-brand-600 font-semibold">{row.avg_days}d</td>
                <td className="py-2.5 px-3 text-right text-gray-500">{row.min_days}d</td>
                <td className="py-2.5 px-3 text-right text-gray-500">{row.max_days}d</td>
                <td className="py-2.5 px-3 text-right text-gray-600">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState('funnel');
  const [days, setDays] = useState(90);

  return (
    <div>
      {/* Header row: tabs + date range picker */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex gap-1 bg-surface-100 rounded-xl p-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="text-xs border border-surface-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {DAYS_OPTIONS.map(({ label, value }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-6">
        {activeTab === 'funnel'   && <HiringFunnelReport days={days} />}
        {activeTab === 'source'   && <SourceAnalysisReport days={days} />}
        {activeTab === 'referral' && <ReferralPerformanceReport days={days} />}
        {activeTab === 'tth'      && <TimeToHireReport days={days} />}
      </div>
    </div>
  );
}
