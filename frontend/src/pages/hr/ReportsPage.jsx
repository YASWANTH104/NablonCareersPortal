import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts';
import {
  BarChart2, TrendingUp, UserCheck, Clock, Building2, Activity, LineChart, Inbox, Briefcase,
} from 'lucide-react';
import { reportsApi } from '@/api/reports';
import ReportExportBar from '@/components/shared/ReportExportBar';

const DAYS_OPTIONS = [
  { label: 'Today', value: 1 },
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last 6 months', value: 182 },
  { label: 'Last 12 months', value: 365 },
];

const TABS = [
  { key: 'pipeline',  label: 'Pipeline Now',         icon: Activity },
  { key: 'funnel',    label: 'Hiring Funnel',        icon: TrendingUp },
  { key: 'trend',     label: 'Trend',                icon: LineChart },
  { key: 'job',       label: 'By Job',               icon: Briefcase },
  { key: 'source',    label: 'Source Analysis',      icon: BarChart2 },
  { key: 'referral',  label: 'Referral Performance', icon: UserCheck },
  { key: 'tth',       label: 'Time to Hire',         icon: Clock },
  { key: 'agency',    label: 'Agency Performance',   icon: Building2 },
];

// Categorical — one fixed hue per source identity. Validated:
// node scripts/validate_palette.js "#6366f1,#10b981,#f59e0b,#8b5cf6" --mode light → ALL PASS
const SOURCE_LABELS = {
  direct: 'Direct', referral: 'Referral', agency: 'Agency',
  talent_acquisition: 'Talent Acquisition',
};
const SOURCE_COLORS = {
  direct: '#6366f1', referral: '#10b981', agency: '#f59e0b', talent_acquisition: '#8b5cf6',
};
const sourceLabel = (s) => SOURCE_LABELS[s] ?? s;
const sourceColor = (s) => SOURCE_COLORS[s] ?? '#94a3b8';

// Ordinal — funnel stages are a sequence, so color is one hue in monotone steps
// (bucketed into 4 bands; 8 individually-distinguishable steps don't clear the
// contrast + gap floor on a white surface). Validated:
// node scripts/validate_palette.js "#818cf8,#6366f1,#4338ca,#312e81" --mode light --ordinal → ALL PASS
const STAGE_LABELS = {
  applied: 'Applied', screening: 'Screening', assessment: 'Assessment',
  tr1: 'Round 1 (TR1)', tr2: 'Round 2 (TR2)', hr: 'HR Round',
  offer: 'Offer', hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
const FUNNEL_STAGE_COLOR = {
  applied: '#818cf8', screening: '#818cf8',
  assessment: '#6366f1', tr1: '#6366f1',
  tr2: '#4338ca', hr: '#4338ca',
  offer: '#312e81', hired: '#312e81',
};

// Sequential — min/avg/max are one measure (days to hire) at three aggregation
// levels, so one hue light→dark, not three unrelated colors. Validated:
// node scripts/validate_palette.js "#818cf8,#6366f1,#4338ca" --mode light --ordinal → ALL PASS
const TTH_COLORS = { min: '#818cf8', avg: '#6366f1', max: '#4338ca' };

// Status — reserved, fixed meaning (never reused for "series N").
const STATUS_LABELS = {
  pending: 'Pending', invited: 'Invited', applied: 'Applied',
  in_progress: 'In Progress', hired: 'Hired', rejected: 'Rejected', expired: 'Expired',
};
const STATUS_COLORS = {
  pending: '#f59e0b', invited: '#f59e0b', applied: '#3b82f6',
  in_progress: '#3b82f6', hired: '#22c55e', rejected: '#f87171', expired: '#f87171',
};

function EmptyState({ text, icon: Icon = Inbox }) {
  return (
    <div className="h-64 flex flex-col items-center justify-center text-gray-300 gap-2">
      <Icon className="w-8 h-8 opacity-40" />
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  );
}

function SectionHeading({ title, subtitle }) {
  return (
    <div className="mb-4">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

const gridProps = { stroke: '#eef0f3', vertical: false };
const tickProps = { fontSize: 11, fill: '#94a3b8' };
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #eef0f3' };

function PipelineSnapshotReport() {
  const { data, isLoading } = useQuery({
    queryKey: ['report-pipeline-snapshot'],
    queryFn: () => reportsApi.pipelineSnapshot().then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <EmptyState text="Loading…" icon={Activity} />;

  const stages = data?.stages ?? [];
  const activeStages = stages.filter((s) => !['rejected', 'withdrawn', 'hired'].includes(s.stage));
  const totalActive = activeStages.reduce((s, d) => s + d.count, 0);
  if (!stages.some((s) => s.count > 0)) return <EmptyState text="No applications yet" icon={Activity} />;

  return (
    <div className="space-y-8">
      <div>
        <SectionHeading
          title="Candidates in each stage right now"
          subtitle={`${totalActive} candidates currently in the active pipeline`}
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
          {stages.map((d) => (
            <div
              key={d.stage}
              className={`rounded-lg p-3 text-center ${
                ['tr1', 'tr2', 'hr'].includes(d.stage) ? 'bg-brand-50 border border-brand-100' : 'bg-surface-50'
              }`}
            >
              <p className="text-xl font-bold text-gray-900">{d.count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{STAGE_LABELS[d.stage] ?? d.stage}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionHeading title="By source" subtitle="Where today's active pipeline is coming from" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {(data?.sources ?? []).map((s) => (
            <div key={s.source} className="bg-surface-50 rounded-lg p-3 text-center">
              <div className="w-2.5 h-2.5 rounded-full mx-auto mb-1.5" style={{ background: sourceColor(s.source) }} />
              <p className="text-xl font-bold text-gray-900">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{sourceLabel(s.source)}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-surface-100">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Source</th>
                {(data?.stages ?? []).map((s) => (
                  <th key={s.stage} className="text-right py-2 px-2 text-xs font-medium text-gray-500 whitespace-nowrap">
                    {STAGE_LABELS[s.stage] ?? s.stage}
                  </th>
                ))}
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {(data?.matrix ?? []).map((row) => (
                <tr key={row.source} className="hover:bg-surface-50">
                  <td className="py-2.5 px-3 font-medium text-gray-900 whitespace-nowrap">{sourceLabel(row.source)}</td>
                  {row.by_stage.map((s) => (
                    <td key={s.stage} className={`py-2.5 px-2 text-right ${s.count ? 'text-gray-800' : 'text-gray-300'}`}>
                      {s.count}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right font-semibold text-brand-600">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TrendReport({ days }) {
  const autoBucket = days <= 31 ? 'day' : days <= 182 ? 'week' : 'month';
  const [bucketOverride, setBucketOverride] = useState('');
  const [showTable, setShowTable] = useState(false);
  const bucket = bucketOverride || autoBucket;

  const { data, isLoading } = useQuery({
    queryKey: ['report-trend', days, bucket],
    queryFn: () => reportsApi.applicationsTrend({ days, bucket }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <EmptyState text="Loading…" icon={LineChart} />;
  if (!data?.length) return <EmptyState text="No applications in this period" icon={LineChart} />;

  const sources = [...new Set(data.map((r) => r.source))];
  const zeroRow = () => Object.fromEntries(sources.map((s) => [s, 0]));
  const byBucket = {};
  data.forEach((r) => {
    // Zero-fill every source per bucket up front — a stacked Area chart renders
    // wrong (broken/misaligned bands) if a source is simply absent from a bucket
    // instead of explicitly 0, since undefined breaks the stack computation.
    byBucket[r.bucket] = byBucket[r.bucket] ?? { bucket: r.bucket, ...zeroRow() };
    byBucket[r.bucket][r.source] = r.count;
  });
  const chartData = Object.values(byBucket).sort((a, b) => a.bucket.localeCompare(b.bucket));
  const total = data.reduce((s, r) => s + r.count, 0);
  const bucketWord = bucket === 'day' ? 'daily' : bucket === 'week' ? 'weekly' : 'monthly';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Applications received over time</p>
          <p className="text-xs text-gray-400 mt-0.5">
            <span className="font-semibold text-gray-600">{total}</span> total · grouped {bucketWord} · split by source
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTable((s) => !s)}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 border border-surface-300 rounded-lg px-2.5 py-1.5 bg-white"
          >
            {showTable ? 'View chart' : 'View table'}
          </button>
          <select
            value={bucket}
            onChange={(e) => setBucketOverride(e.target.value)}
            className="text-xs border border-surface-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
      </div>

      {showTable ? (
        <div className="overflow-x-auto rounded-lg border border-surface-100">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Period</th>
                {sources.map((s) => (
                  <th key={s} className="text-right py-2 px-3 text-xs font-medium text-gray-500">{sourceLabel(s)}</th>
                ))}
                <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {chartData.map((row) => (
                <tr key={row.bucket} className="hover:bg-surface-50">
                  <td className="py-2 px-3 font-medium text-gray-900 whitespace-nowrap">{row.bucket}</td>
                  {sources.map((s) => (
                    <td key={s} className="py-2 px-3 text-right text-gray-700">{row[s] ?? 0}</td>
                  ))}
                  <td className="py-2 px-3 text-right font-semibold text-brand-600">
                    {sources.reduce((sum, s) => sum + (row[s] ?? 0), 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={chartData} margin={{ bottom: 10 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="bucket" tick={tickProps} />
            <YAxis tick={tickProps} allowDecimals={false} />
            <Tooltip
              formatter={(v, name) => [v, sourceLabel(name)]}
              contentStyle={tooltipStyle}
            />
            <Legend formatter={(v) => sourceLabel(v)} />
            {sources.map((s) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stackId="1"
                stroke={sourceColor(s)}
                fill={sourceColor(s)}
                fillOpacity={0.35}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function HiringFunnelReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-funnel', days],
    queryFn: () => reportsApi.hiringFunnel({ days }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  const chartData = (data ?? []).filter((d) => d.count > 0);

  if (isLoading) return <EmptyState text="Loading…" icon={TrendingUp} />;
  if (!chartData.length) return <EmptyState text="No data for this period" icon={TrendingUp} />;

  return (
    <div className="space-y-6">
      <SectionHeading
        title="How candidates move through the pipeline"
        subtitle="Darker bars mean later stages — lighter is earlier in the funnel"
      />
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ bottom: 20 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="stage"
            tickFormatter={(s) => STAGE_LABELS[s] ?? s}
            tick={tickProps}
            interval={0} angle={-30} textAnchor="end" height={52}
          />
          <YAxis tick={tickProps} allowDecimals={false} />
          <Tooltip
            labelFormatter={(s) => STAGE_LABELS[s] ?? s}
            formatter={(v) => [v, 'Candidates']}
            contentStyle={tooltipStyle}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {chartData.map((d) => <Cell key={d.stage} fill={FUNNEL_STAGE_COLOR[d.stage] ?? '#6366f1'} />)}
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
    placeholderData: keepPreviousData,
  });

  const { data: funnelData } = useQuery({
    queryKey: ['report-source-funnel', days],
    queryFn: () => reportsApi.sourceFunnel({ days }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <EmptyState text="Loading…" icon={BarChart2} />;
  if (!data?.length) return <EmptyState text="No data for this period" icon={BarChart2} />;

  const total = data.reduce((s, d) => s + d.count, 0);
  const pieData = data.map((d) => ({ ...d, name: sourceLabel(d.source) }));

  return (
    <div className="space-y-8">
      <div>
        <SectionHeading title="Where applications come from" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={100}>
                {pieData.map((d) => <Cell key={d.source} fill={sourceColor(d.source)} />)}
              </Pie>
              <Tooltip formatter={(v, name) => [v, name]} contentStyle={tooltipStyle} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>

          <div className="space-y-2 self-center">
            {data.map((d) => (
              <div key={d.source} className="flex items-center justify-between p-3 bg-surface-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: sourceColor(d.source) }} />
                  <span className="text-sm text-gray-700">{sourceLabel(d.source)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 bg-surface-200 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${(d.count / total) * 100}%`, background: sourceColor(d.source) }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-900 w-8 text-right">{d.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {funnelData?.length > 0 && (
        <div>
          <SectionHeading title="Pipeline quality by source" subtitle="Applications, outcomes, and conversion for each source" />
          <div className="overflow-x-auto rounded-lg border border-surface-100">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Source</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Applications</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Hired</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Rejected</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500">Conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {funnelData.map((row) => (
                  <tr key={row.source} className="hover:bg-surface-50">
                    <td className="py-2.5 px-3 font-medium text-gray-900">{sourceLabel(row.source)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-700">{row.total}</td>
                    <td className="py-2.5 px-3 text-right text-green-600 font-semibold">{row.hired}</td>
                    <td className="py-2.5 px-3 text-right text-red-400">{row.rejected}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-brand-600">{row.conversion_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ReferralPerformanceReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-referral', days],
    queryFn: () => reportsApi.referralPerformance({ days }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <EmptyState text="Loading…" icon={UserCheck} />;
  if (!data?.total) return <EmptyState text="No referrals in this period" icon={UserCheck} />;

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
        <div className="bg-amber-50 rounded-xl p-4 text-center">
          <p className="text-3xl font-bold text-amber-700">{data.bonus_paid}</p>
          <p className="text-sm text-amber-600 mt-1">Bonuses Paid</p>
        </div>
      </div>

      <div>
        <SectionHeading title="Referrals by status" />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.by_status.filter((d) => d.count > 0)} margin={{ bottom: 10 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="status" tickFormatter={(s) => STATUS_LABELS[s] ?? s} tick={tickProps} />
            <YAxis tick={tickProps} allowDecimals={false} />
            <Tooltip labelFormatter={(s) => STATUS_LABELS[s] ?? s} formatter={(v) => [v, 'Referrals']} contentStyle={tooltipStyle} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.by_status.filter((d) => d.count > 0).map((d) => (
                <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? '#94a3b8'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TimeToHireReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-tth', days],
    queryFn: () => reportsApi.timeToHire({ days }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <EmptyState text="Loading…" icon={Clock} />;
  if (!data?.length) return <EmptyState text="No hired candidates in this period" icon={Clock} />;

  return (
    <div className="space-y-6">
      <SectionHeading title="Days to hire by department" subtitle="Minimum, average, and maximum time from application to hire" />
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid {...gridProps} horizontal={false} vertical />
          <XAxis type="number" tick={tickProps} unit="d" />
          <YAxis dataKey="department" type="category" tick={tickProps} width={100} />
          <Tooltip
            formatter={(v, name) => [`${v} days`, name === 'avg_days' ? 'Avg' : name === 'min_days' ? 'Min' : 'Max']}
            contentStyle={tooltipStyle}
          />
          <Bar dataKey="min_days" fill={TTH_COLORS.min} name="Min" radius={[0, 4, 4, 0]} />
          <Bar dataKey="avg_days" fill={TTH_COLORS.avg} name="Avg" radius={[0, 4, 4, 0]} />
          <Bar dataKey="max_days" fill={TTH_COLORS.max} name="Max" radius={[0, 4, 4, 0]} />
          <Legend />
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto rounded-lg border border-surface-100">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50">
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

const STAGE_SHORT = {
  applied: 'Applied', screening: 'Screen', assessment: 'Assess', tr1: 'TR1', tr2: 'TR2',
  hr: 'HR', offer: 'Offer', hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
const stageBarColor = (stage) =>
  FUNNEL_STAGE_COLOR[stage] ?? (stage === 'hired' ? '#22c55e' : stage === 'rejected' ? '#f87171' : '#94a3b8');

function JobPerformanceReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-job', days],
    queryFn: () => reportsApi.jobPerformance({ days }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <EmptyState text="Loading…" icon={Briefcase} />;
  if (!data?.length) return <EmptyState text="No applications to any job in this period" icon={Briefcase} />;

  const totalApps = data.reduce((s, j) => s + j.total_applications, 0);
  const totalHired = data.reduce((s, j) => s + j.hired, 0);
  const avgConv = totalApps > 0 ? Math.round((totalHired / totalApps) * 100) : 0;
  const chartData = data.slice(0, 12); // keep the bar chart readable

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{data.length}</p>
          <p className="text-xs text-gray-500 mt-1">Jobs with Applicants</p>
        </div>
        <div className="bg-surface-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{totalApps}</p>
          <p className="text-xs text-gray-500 mt-1">Total Applications</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{totalHired}</p>
          <p className="text-xs text-green-600 mt-1">Total Hired</p>
        </div>
        <div className="bg-brand-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-brand-700">{avgConv}%</p>
          <p className="text-xs text-brand-600 mt-1">Avg Conversion</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-100">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50">
              <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500">Job</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">Applications</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">In Progress</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">Hired</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">Rejected</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">Conversion</th>
              <th className="py-2.5 px-3 text-xs font-medium text-gray-500">Pipeline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {data.map((j) => (
              <tr key={j.job_id} className="hover:bg-surface-50">
                <td className="py-3 px-3">
                  <p className="font-medium text-gray-900">{j.title}</p>
                  <p className="text-xs text-gray-400">{j.department || 'No department'}</p>
                </td>
                <td className="py-3 px-3 text-right font-semibold text-gray-900">{j.total_applications}</td>
                <td className="py-3 px-3 text-right text-amber-600">{j.in_progress}</td>
                <td className="py-3 px-3 text-right text-green-600 font-semibold">{j.hired}</td>
                <td className="py-3 px-3 text-right text-red-400">{j.rejected}</td>
                <td className="py-3 px-3 text-right">
                  <span className={`font-semibold ${j.conversion_rate >= 20 ? 'text-green-600' : j.conversion_rate >= 10 ? 'text-amber-600' : 'text-gray-500'}`}>
                    {j.conversion_rate}%
                  </span>
                </td>
                <td className="py-3 px-3">
                  {j.total_applications > 0 && (
                    <div className="flex gap-0.5 h-4 min-w-[80px]">
                      {j.by_stage.filter((s) => s.count > 0).map((s) => (
                        <div
                          key={s.stage}
                          title={`${STAGE_SHORT[s.stage] ?? s.stage}: ${s.count}`}
                          className="rounded-sm"
                          style={{
                            width: `${(s.count / j.total_applications) * 100}%`,
                            minWidth: 4,
                            background: stageBarColor(s.stage),
                          }}
                        />
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <SectionHeading title="Applications vs. hired per job" subtitle={data.length > 12 ? 'Top 12 by application volume' : undefined} />
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ bottom: 40 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="title" tick={tickProps} interval={0} angle={-25} textAnchor="end" height={70} />
            <YAxis tick={tickProps} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="total_applications" name="Applications" fill="#818cf8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="hired" name="Hired" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Legend />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AgencyPerformanceReport({ days }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-agency', days],
    queryFn: () => reportsApi.agencyPerformance({ days }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isLoading) return <EmptyState text="Loading…" icon={Building2} />;
  if (!data?.length) return <EmptyState text="No agency submissions in this period" icon={Building2} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{data.length}</p>
          <p className="text-xs text-gray-500 mt-1">Active Agencies</p>
        </div>
        <div className="bg-surface-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{data.reduce((s, a) => s + a.total_submitted, 0)}</p>
          <p className="text-xs text-gray-500 mt-1">Total Submitted</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{data.reduce((s, a) => s + a.hired, 0)}</p>
          <p className="text-xs text-green-600 mt-1">Total Hired</p>
        </div>
        <div className="bg-brand-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-brand-700">
            {data.reduce((s, a) => s + a.total_submitted, 0) > 0
              ? `${Math.round((data.reduce((s, a) => s + a.hired, 0) / data.reduce((s, a) => s + a.total_submitted, 0)) * 100)}%`
              : '0%'}
          </p>
          <p className="text-xs text-brand-600 mt-1">Avg Conversion</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-100">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50">
              <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500">Agency</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">Submitted</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">In Progress</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">Hired</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">Rejected</th>
              <th className="text-right py-2.5 px-3 text-xs font-medium text-gray-500">Conversion</th>
              <th className="py-2.5 px-3 text-xs font-medium text-gray-500">Pipeline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {data.map((a) => (
              <tr key={a.agency_id} className="hover:bg-surface-50">
                <td className="py-3 px-3">
                  <p className="font-medium text-gray-900">{a.agency_name}</p>
                  <p className="text-xs text-gray-400">{a.contact_email}</p>
                </td>
                <td className="py-3 px-3 text-right font-semibold text-gray-900">{a.total_submitted}</td>
                <td className="py-3 px-3 text-right text-amber-600">{a.in_progress}</td>
                <td className="py-3 px-3 text-right text-green-600 font-semibold">{a.hired}</td>
                <td className="py-3 px-3 text-right text-red-400">{a.rejected}</td>
                <td className="py-3 px-3 text-right">
                  <span className={`font-semibold ${a.conversion_rate >= 20 ? 'text-green-600' : a.conversion_rate >= 10 ? 'text-amber-600' : 'text-gray-500'}`}>
                    {a.conversion_rate}%
                  </span>
                </td>
                <td className="py-3 px-3">
                  {a.total_submitted > 0 && (
                    <div className="flex gap-0.5 h-4">
                      {a.by_stage.filter((s) => s.count > 0).map((s) => (
                        <div
                          key={s.stage}
                          title={`${STAGE_SHORT[s.stage] ?? s.stage}: ${s.count}`}
                          className="rounded-sm"
                          style={{
                            width: `${(s.count / a.total_submitted) * 100}%`,
                            minWidth: 4,
                            background: FUNNEL_STAGE_COLOR[s.stage] ?? (s.stage === 'hired' ? '#22c55e' : s.stage === 'rejected' ? '#f87171' : '#94a3b8'),
                          }}
                        />
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <SectionHeading title="Submitted vs. hired per agency" />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ bottom: 20 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="agency_name" tick={tickProps} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis tick={tickProps} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="total_submitted" name="Submitted" fill="#818cf8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="hired" name="Hired" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Legend />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [days, setDays] = useState(90);

  // Mirrors TrendReport's own autoBucket default — a manual bucket override
  // toggled inside that tab isn't reflected here (known limitation: export
  // uses the auto bucket, not whatever the user picked inside the tab).
  const autoBucket = days <= 31 ? 'day' : days <= 182 ? 'week' : 'month';
  const extraParams = activeTab === 'pipeline' ? {} : activeTab === 'trend' ? { days, bucket: autoBucket } : { days };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Hiring pipeline, sourcing, and performance analytics</p>
      </div>

      {/* Tabs + date range picker */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex gap-1 bg-surface-100 rounded-xl p-1 overflow-x-auto max-w-full">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {activeTab !== 'pipeline' && (
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="text-xs border border-surface-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {DAYS_OPTIONS.map(({ label, value }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          )}
          <ReportExportBar
            report={activeTab}
            reportLabel={TABS.find((t) => t.key === activeTab)?.label ?? activeTab}
            extraParams={extraParams}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6">
        {activeTab === 'pipeline' && <PipelineSnapshotReport />}
        {activeTab === 'funnel'   && <HiringFunnelReport days={days} />}
        {activeTab === 'trend'    && <TrendReport days={days} />}
        {activeTab === 'job'      && <JobPerformanceReport days={days} />}
        {activeTab === 'source'   && <SourceAnalysisReport days={days} />}
        {activeTab === 'referral' && <ReferralPerformanceReport days={days} />}
        {activeTab === 'tth'      && <TimeToHireReport days={days} />}
        {activeTab === 'agency'   && <AgencyPerformanceReport days={days} />}
      </div>
    </div>
  );
}
