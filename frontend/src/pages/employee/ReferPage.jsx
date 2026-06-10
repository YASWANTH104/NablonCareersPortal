import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus, Briefcase, MapPin, X, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { jobsApi } from '@/api/jobs';
import { referralsApi } from '@/api/referrals';

const schema = z.object({
  candidate_name: z.string().min(2, 'Required'),
  candidate_email: z.string().email('Valid email required'),
  candidate_phone: z.string().optional(),
  relationship: z.string().optional(),
  note: z.string().optional(),
});

function ReferModal({ job, onClose }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
  });

  const mut = useMutation({
    mutationFn: (data) => referralsApi.create({ ...data, job_id: job.id }),
    onSuccess: () => {
      toast.success('Referral submitted!');
      queryClient.invalidateQueries({ queryKey: ['my-referrals'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to submit'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-surface-200">
          <div>
            <h2 className="font-display font-semibold text-gray-900">Refer a Candidate</h2>
            <p className="text-sm text-gray-500 mt-0.5">{job.title}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Full Name *</label>
              <input
                {...register('candidate_name')}
                className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Jane Doe"
              />
              {errors.candidate_name && <p className="text-xs text-red-500 mt-1">{errors.candidate_name.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
              <input
                {...register('candidate_email')}
                type="email"
                className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="jane@example.com"
              />
              {errors.candidate_email && <p className="text-xs text-red-500 mt-1">{errors.candidate_email.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input
                {...register('candidate_phone')}
                className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Relationship</label>
              <input
                {...register('relationship')}
                className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Ex-colleague, Friend..."
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Why are you referring them?</label>
            <textarea
              {...register('note')}
              rows={3}
              className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              placeholder="Brief note about the candidate's strengths..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mut.isPending}
              className="px-5 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
            >
              {mut.isPending ? 'Submitting...' : 'Submit Referral'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ReferPage() {
  const [search, setSearch] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['jobs-public', { search }],
    queryFn: () => jobsApi.listPublic({ search, limit: 50 }).then((r) => r.data),
    keepPreviousData: true,
  });

  const jobs = data?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-gray-900">Refer a Candidate</h1>
        <p className="text-gray-500 text-sm mt-1">
          Know someone great? Pick a role and submit a referral — you'll be notified when they progress.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search open roles..."
          className="w-full pl-9 pr-4 py-2.5 border border-surface-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* Job list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-surface-100 animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No open positions found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-white rounded-xl border border-surface-200 p-4 flex items-center justify-between hover:border-brand-200 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm truncate">{job.title}</p>
                <div className="flex items-center gap-3 mt-1">
                  {job.location_type && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <MapPin className="w-3 h-3" /> {job.location_type}
                    </span>
                  )}
                  {job.employment_type && (
                    <span className="text-xs text-gray-400">{job.employment_type}</span>
                  )}
                  {job.department_name && (
                    <span className="text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                      {job.department_name}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedJob(job)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-xs font-medium rounded-lg hover:bg-brand-600 transition-colors ml-4 flex-shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" /> Refer
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedJob && (
        <ReferModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  );
}
