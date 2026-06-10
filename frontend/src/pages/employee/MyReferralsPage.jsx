import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, UserCheck, Clock, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { referralsApi } from '@/api/referrals';

const STATUS_CONFIG = {
  pending:     { label: 'Pending',     dot: 'bg-gray-400',   text: 'text-gray-600',   bg: 'bg-gray-100' },
  invited:     { label: 'Invited',     dot: 'bg-blue-400',   text: 'text-blue-700',   bg: 'bg-blue-50' },
  applied:     { label: 'Applied',     dot: 'bg-indigo-400', text: 'text-indigo-700', bg: 'bg-indigo-50' },
  in_progress: { label: 'In Progress', dot: 'bg-yellow-400', text: 'text-yellow-700', bg: 'bg-yellow-50' },
  hired:       { label: 'Hired',       dot: 'bg-green-500',  text: 'text-green-700',  bg: 'bg-green-50' },
  rejected:    { label: 'Rejected',    dot: 'bg-red-400',    text: 'text-red-600',    bg: 'bg-red-50' },
  expired:     { label: 'Expired',     dot: 'bg-surface-300',text: 'text-gray-400',   bg: 'bg-surface-100' },
};

const STATUS_TABS = ['all', 'pending', 'invited', 'applied', 'in_progress', 'hired', 'rejected'];

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export default function MyReferralsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['my-referrals', { status: activeTab === 'all' ? undefined : activeTab, page }],
    queryFn: () =>
      referralsApi.mine({ status: activeTab === 'all' ? undefined : activeTab, page, limit: 20 })
        .then((r) => r.data),
  });

  const referrals = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  // Summary stats
  const { data: allData } = useQuery({
    queryKey: ['my-referrals-all'],
    queryFn: () => referralsApi.mine({ limit: 100 }).then((r) => r.data),
  });
  const all = allData?.items ?? [];
  const hiredCount = all.filter((r) => r.status === 'hired').length;
  const bonusEligible = all.filter((r) => r.bonus_eligible && !r.bonus_paid).length;

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Referred', value: all.length, icon: UserCheck, color: 'text-brand-600 bg-brand-50' },
          { label: 'In Progress', value: all.filter((r) => ['invited','applied','in_progress'].includes(r.status)).length, icon: TrendingUp, color: 'text-blue-600 bg-blue-50' },
          { label: 'Hired', value: hiredCount, icon: Award, color: 'text-green-600 bg-green-50' },
          { label: 'Bonus Pending', value: bonusEligible, icon: Clock, color: 'text-yellow-600 bg-yellow-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-surface-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-100 rounded-xl p-1 mb-5 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'in_progress' ? 'In Progress' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : referrals.length === 0 ? (
          <div className="p-12 text-center">
            <Award className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No referrals yet in this category.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Candidate</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Referred</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Bonus</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {referrals.map((r) => (
                <tr key={r.id} className="hover:bg-surface-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.candidate_name}</p>
                    <p className="text-xs text-gray-400">{r.candidate_email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.job_title}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {format(new Date(r.created_at), 'dd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3">
                    {r.bonus_eligible ? (
                      <span className={`text-xs font-medium ${r.bonus_paid ? 'text-green-600' : 'text-yellow-600'}`}>
                        {r.bonus_paid ? 'Paid' : r.bonus_amount ? `₹${Number(r.bonus_amount).toLocaleString()} pending` : 'Eligible'}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-200">
            <p className="text-xs text-gray-500">{total} total</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-surface-300 rounded-lg disabled:opacity-40 hover:bg-surface-50"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-600">
                {page} / {pages}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page === pages}
                className="px-3 py-1.5 text-xs border border-surface-300 rounded-lg disabled:opacity-40 hover:bg-surface-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
