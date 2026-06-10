import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCheck, ChevronDown, RefreshCw, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
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

const STATUS_OPTIONS = ['pending', 'invited', 'applied', 'in_progress', 'hired', 'rejected', 'expired'];
const STATUS_TABS = ['all', ...STATUS_OPTIONS];

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function StatusDropdown({ current, onSelect, isPending }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium disabled:opacity-50"
      >
        Change <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-20 bg-white border border-surface-200 rounded-lg shadow-lg w-36 py-1">
          {STATUS_OPTIONS.filter((s) => s !== current).map((s) => (
            <button
              key={s}
              onClick={() => { onSelect(s); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-50 capitalize"
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReferralsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['referrals', { status: activeTab === 'all' ? undefined : activeTab, page }],
    queryFn: () =>
      referralsApi.list({ status: activeTab === 'all' ? undefined : activeTab, page, limit: 20 })
        .then((r) => r.data),
  });

  const referrals = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['referrals'] });

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => referralsApi.updateStatus(id, status),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: () => toast.error('Failed to update status'),
  });

  const resendMut = useMutation({
    mutationFn: (id) => referralsApi.resend(id),
    onSuccess: () => { toast.success('Invitation resent'); invalidate(); },
    onError: () => toast.error('Failed to resend'),
  });

  const bonusMut = useMutation({
    mutationFn: ({ id, data }) => referralsApi.updateBonus(id, data),
    onSuccess: () => { toast.success('Bonus updated'); invalidate(); },
    onError: () => toast.error('Failed to update bonus'),
  });

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 flex-wrap bg-surface-100 rounded-xl p-1 mb-5 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'all' ? 'All' : tab === 'in_progress' ? 'In Progress' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : referrals.length === 0 ? (
          <div className="p-12 text-center">
            <UserCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No referrals found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Candidate</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Referred By</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Bonus</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {referrals.map((r) => (
                <tr key={r.id} className="hover:bg-surface-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.candidate_name}</p>
                    <p className="text-xs text-gray-400">{r.candidate_email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{r.job_title}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{r.referrer_name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      <StatusDropdown
                        current={r.status}
                        onSelect={(status) => statusMut.mutate({ id: r.id, status })}
                        isPending={statusMut.isPending}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {format(new Date(r.created_at), 'dd MMM yy')}
                  </td>
                  <td className="px-4 py-3">
                    {r.bonus_eligible ? (
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${r.bonus_paid ? 'text-green-600' : 'text-yellow-600'}`}>
                          {r.bonus_paid ? 'Paid' : 'Eligible'}
                        </span>
                        {!r.bonus_paid && (
                          <button
                            onClick={() => bonusMut.mutate({ id: r.id, data: { bonus_paid: true } })}
                            disabled={bonusMut.isPending}
                            className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                            title="Mark bonus paid"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => resendMut.mutate(r.id)}
                      disabled={resendMut.isPending}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 transition-colors disabled:opacity-40"
                      title="Resend invite"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Resend
                    </button>
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
              <span className="px-3 py-1.5 text-xs text-gray-600">{page} / {pages}</span>
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
