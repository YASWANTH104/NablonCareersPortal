import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import {
  Briefcase, Users, Clock, Calendar,
  TrendingUp, TrendingDown, Minus, UserCheck, Award,
} from 'lucide-react';
import { format } from 'date-fns';
import { dashboardApi } from '@/api/dashboard';

const STAGE_LABELS = {
  applied: 'Applied',
  screening: 'Screening',
  assessment: 'Assessment',
  interview_1: 'Interview 1',
  interview_2: 'Interview 2',
  interview_3: 'Interview 3',
  final_interview: 'Final',
  offer: 'Offer',
  hired: 'Hired',
};

const FUNNEL_COLORS = [
  '#6366f1', '#818cf8', '#93c5fd', '#67e8f9',
  '#6ee7b7', '#bbf7d0', '#fde68a', '#fca5a5', '#86efac',
];

function StatCard({ label, value, sub, icon: Icon, color, trend }) {
  return (
    <div className="bg-white rounded-xl border border-surface-200 p-5">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            {trend > 0 ? <TrendingUp className="w-3.5 h-3.5 text-green-500" />
              : trend < 0 ? <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              : <Minus className="w-3.5 h-3.5 text-gray-300" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-3">{value ?? '—'}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => dashboardApi.stats().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: funnel } = useQuery({
    queryKey: ['dashboard-funnel'],
    queryFn: () => dashboardApi.funnel().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: tth } = useQuery({
    queryKey: ['dashboard-tth'],
    queryFn: () => dashboardApi.timeToHire().then((r) => r.data),
  });

  const { data: activity } = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: () => dashboardApi.activity(8).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const weekTrend = stats && stats.applications_last_week > 0
    ? Math.round(((stats.applications_this_week - stats.applications_last_week) / stats.applications_last_week) * 100)
    : 0;

  const funnelData = (funnel ?? []).filter((f) => f.count > 0);

  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Open Positions" value={stats?.open_jobs} icon={Briefcase} color="text-brand-600 bg-brand-50" />
        <StatCard
          label="Apps This Week"
          value={stats?.applications_this_week}
          sub={`${stats?.applications_last_week ?? 0} last week`}
          icon={Users}
          color="text-indigo-600 bg-indigo-50"
          trend={weekTrend}
        />
        <StatCard label="Pending Reviews" value={stats?.pending_reviews} sub="Applied & screening" icon={Clock} color="text-yellow-600 bg-yellow-50" />
        <StatCard label="Interviews Today" value={stats?.interviews_today} icon={Calendar} color="text-green-600 bg-green-50" />
        <StatCard label="Total Referrals" value={stats?.total_referrals} icon={UserCheck} color="text-purple-600 bg-purple-50" />
        <StatCard label="Total Hired" value={stats?.hired_total} icon={Award} color="text-emerald-600 bg-emerald-50" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline funnel */}
        <div className="bg-white rounded-xl border border-surface-200 p-5">
          <div className="mb-4">
            <h2 className="font-display font-semibold text-gray-900">Pipeline Funnel</h2>
            <p className="text-xs text-gray-500 mt-0.5">Applications by stage</p>
          </div>
          {funnelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={funnelData} margin={{ left: -10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="stage"
                  tickFormatter={(s) => STAGE_LABELS[s] ?? s}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={52}
                />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
                <Tooltip
                  formatter={(v) => [v, 'Candidates']}
                  labelFormatter={(s) => STAGE_LABELS[s] ?? s}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {funnelData.map((_, i) => (
                    <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-gray-300 text-sm">
              No pipeline data yet
            </div>
          )}
        </div>

        {/* Time to hire */}
        <div className="bg-white rounded-xl border border-surface-200 p-5">
          <div className="mb-4">
            <h2 className="font-display font-semibold text-gray-900">Time to Hire</h2>
            <p className="text-xs text-gray-500 mt-0.5">Average days from application to hire by department</p>
          </div>
          {tth && tth.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={tth} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} unit="d" />
                <YAxis dataKey="department" type="category" tick={{ fontSize: 10, fill: '#94a3b8' }} width={90} />
                <Tooltip
                  formatter={(v) => [`${v} days`, 'Avg']}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="avg_days" fill="#6366f1" radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="avg_days"
                    position="right"
                    style={{ fontSize: 10, fill: '#64748b' }}
                    formatter={(v) => `${v}d`}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-gray-300 text-sm">
              No hired candidates yet
            </div>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-xl border border-surface-200 p-5">
        <div className="mb-4">
          <h2 className="font-display font-semibold text-gray-900">Recent Activity</h2>
          <p className="text-xs text-gray-500 mt-0.5">Latest stage changes across all candidates</p>
        </div>
        {!activity || activity.length === 0 ? (
          <p className="text-sm text-gray-400">No activity yet.</p>
        ) : (
          <div className="space-y-3">
            {activity.map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-brand-600 font-semibold text-xs">
                    {item.candidate_name?.charAt(0)?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-900">{item.candidate_name}</span>
                  <span className="text-gray-400 mx-1">moved</span>
                  {item.from_stage && (
                    <>
                      <span className="text-gray-500">{STAGE_LABELS[item.from_stage] ?? item.from_stage}</span>
                      <span className="text-gray-300 mx-1">→</span>
                    </>
                  )}
                  <span className="text-brand-600 font-medium">
                    {STAGE_LABELS[item.to_stage] ?? item.to_stage}
                  </span>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {format(new Date(item.created_at), 'dd MMM, HH:mm')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
