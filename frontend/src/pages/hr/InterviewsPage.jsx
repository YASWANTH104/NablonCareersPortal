import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, isToday, isTomorrow, isThisWeek, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import {
  Calendar, Clock, Video, Phone, MapPin, Users, ExternalLink,
  UserCheck, Star, CheckCircle2, Loader2, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import { interviewsApi } from '@/api/interviews';
import { useAuthStore } from '@/store/authStore';
import { HR_ROLES, ROLES } from '@/utils/permissions';

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 120, label: '2 hr' },
];

const rescheduleSchema = z.object({
  scheduled_at: z.string().min(1, 'Required'),
  duration_mins: z.coerce.number(),
  meeting_link: z.string().min(1, 'Meeting link is required').url('Enter a valid URL'),
});

function RescheduleDialog({ interview, onClose, onSuccess }) {
  const existingDate = interview.scheduled_at
    ? new Date(interview.scheduled_at).toISOString().slice(0, 16)
    : '';

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(rescheduleSchema),
    defaultValues: {
      scheduled_at: existingDate,
      duration_mins: interview.duration_mins ?? 60,
      meeting_link: interview.meeting_link ?? '',
    },
  });

  const updateMut = useMutation({
    mutationFn: (data) =>
      interviewsApi.update(interview.id, {
        scheduled_at: new Date(data.scheduled_at).toISOString(),
        duration_mins: Number(data.duration_mins),
        meeting_link: data.meeting_link || undefined,
        status: 'rescheduled',
      }),
    onSuccess: () => {
      toast.success('Interview rescheduled');
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to reschedule'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-2 mb-5">
          <RefreshCw className="w-4 h-4 text-brand-500" />
          <h3 className="font-display font-bold text-gray-900">Reschedule Interview</h3>
        </div>
        <p className="text-xs text-gray-500 -mt-3 mb-5 pl-6">
          {interview.title || `Round ${interview.round_number}`}
        </p>
        <form onSubmit={handleSubmit((v) => updateMut.mutate(v))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Date & Time *</label>
              <input
                {...register('scheduled_at')}
                type="datetime-local"
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {errors.scheduled_at && <p className="mt-1 text-xs text-red-500">{errors.scheduled_at.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
              <select
                {...register('duration_mins')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Meeting link <span className="text-red-500">*</span>
            </label>
            <input
              {...register('meeting_link')}
              type="url"
              placeholder="https://meet.google.com/..."
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {errors.meeting_link && <p className="mt-1 text-xs text-red-500">{errors.meeting_link.message}</p>}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={updateMut.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
            >
              {updateMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Reschedule
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'scheduled', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS = {
  scheduled:   'bg-blue-100 text-blue-700',
  completed:   'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-700',
  no_show:     'bg-orange-100 text-orange-700',
  rescheduled: 'bg-yellow-100 text-yellow-700',
};

const TYPE_ICONS = {
  video:     Video,
  phone:     Phone,
  onsite:    MapPin,
  technical: Users,
  hr:        Users,
  panel:     Users,
};

const RECOMMENDATION_LABELS = {
  strong_yes: { label: 'Strong Yes', color: 'text-green-700 bg-green-50' },
  yes:        { label: 'Yes', color: 'text-emerald-700 bg-emerald-50' },
  neutral:    { label: 'Neutral', color: 'text-gray-700 bg-gray-100' },
  no:         { label: 'No', color: 'text-orange-700 bg-orange-50' },
  strong_no:  { label: 'Strong No', color: 'text-red-700 bg-red-50' },
};

function dateGroupLabel(dateStr) {
  const d = parseISO(dateStr);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isThisWeek(d)) return format(d, 'EEEE');
  return format(d, 'MMMM d, yyyy');
}

function groupByDate(interviews) {
  const groups = {};
  interviews.forEach((interview) => {
    const day = interview.scheduled_at.split('T')[0];
    if (!groups[day]) groups[day] = [];
    groups[day].push(interview);
  });
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

// ── Inline Feedback Form ──────────────────────────────────────────────────────

function InlineFeedbackForm({ interviewId, onSuccess, onCancel }) {
  const { register, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm();
  const selectedRating = watch('overall_rating');

  const submitMut = useMutation({
    mutationFn: (data) => interviewsApi.submitFeedback(interviewId, data),
    onSuccess: () => { toast.success('Feedback submitted'); onSuccess(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to submit feedback'),
  });

  const onSubmit = (values) => {
    const payload = {};
    Object.entries(values).forEach(([k, v]) => {
      if (v !== '' && v !== undefined && v !== null) {
        payload[k] = typeof v === 'string' && !isNaN(v) && v !== '' ? Number(v) : v;
      }
    });
    submitMut.mutate(payload);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-4 pt-4 border-t border-surface-100 space-y-3">
      <h4 className="text-xs font-semibold text-gray-700">Submit Feedback</h4>

      {/* Overall rating */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Overall Rating</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setValue('overall_rating', n)} className="p-0.5">
              <Star className={`w-5 h-5 ${n <= (selectedRating ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Recommendation */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Recommendation</label>
        <select
          {...register('recommendation')}
          className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Select…</option>
          {Object.entries(RECOMMENDATION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Notes</label>
        <textarea
          {...register('notes')}
          rows={2}
          placeholder="Key observations…"
          className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting || submitMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
        >
          {(isSubmitting || submitMut.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Submit
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Interview Card ────────────────────────────────────────────────────────────

function InterviewCard({ interview, onCandidateClick, canComplete, canCancel, onComplete, onReschedule, onRefetch }) {
  const TypeIcon = TYPE_ICONS[interview.interview_type] ?? Calendar;
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAllFeedback, setShowAllFeedback] = useState(false);

  const hasFeedback = interview.feedback?.length > 0;

  return (
    <div className="bg-white rounded-xl border border-surface-200 p-4 hover:border-brand-200 hover:shadow-sm transition-all">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
          <TypeIcon className="w-5 h-5 text-indigo-500" />
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {interview.title || `Round ${interview.round_number}`}
            </p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[interview.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {interview.status}
            </span>
            {interview.interview_type && (
              <span className="text-xs text-gray-500 capitalize bg-surface-100 px-2 py-0.5 rounded-full">
                {interview.interview_type}
              </span>
            )}
          </div>

          {interview.candidate_name && (
            <button
              onClick={() => onCandidateClick(interview.application_id)}
              className="text-sm text-brand-600 hover:text-brand-700 mt-0.5 text-left"
            >
              {interview.candidate_name}
            </button>
          )}

          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              {format(parseISO(interview.scheduled_at), 'h:mm a')}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-gray-400" />
              {interview.duration_mins} min
            </span>
            {interview.panelists?.length > 0 && (
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                {interview.panelists.length} panelist{interview.panelists.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {interview.meeting_link && ['scheduled', 'rescheduled'].includes(interview.status) && (
            <a
              href={interview.meeting_link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
            >
              Join <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {canComplete && ['scheduled', 'rescheduled'].includes(interview.status) && (
            <button
              onClick={() => onComplete(interview.id)}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition-colors"
            >
              <CheckCircle2 className="w-3 h-3" /> Complete
            </button>
          )}
          {canCancel && ['scheduled', 'rescheduled'].includes(interview.status) && (
            <button
              onClick={() => onReschedule(interview)}
              className="flex items-center gap-1 px-3 py-1.5 border border-brand-200 text-xs text-brand-600 font-medium rounded-lg hover:bg-brand-50 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Reschedule
            </button>
          )}
          <button
            onClick={() => onCandidateClick(interview.application_id)}
            className="px-3 py-1.5 border border-surface-200 text-xs text-gray-600 rounded-lg hover:bg-surface-50 transition-colors"
          >
            View application
          </button>
        </div>
      </div>

      {interview.location && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 pl-14">
          <MapPin className="w-3.5 h-3.5 text-gray-400" />
          {interview.location}
        </div>
      )}

      {interview.notes && (
        <p className="mt-2 text-xs text-gray-500 bg-surface-50 rounded-lg p-2.5 pl-14">
          {interview.notes}
        </p>
      )}

      {/* Feedback section */}
      {hasFeedback && (
        <div className="mt-3 pt-3 border-t border-surface-100 pl-14">
          <button
            onClick={() => setShowAllFeedback((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            {interview.feedback.length} feedback{interview.feedback.length !== 1 ? 's' : ''} submitted
            {showAllFeedback ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showAllFeedback && (
            <div className="mt-2 space-y-2">
              {interview.feedback.map((fb) => {
                const rec = RECOMMENDATION_LABELS[fb.recommendation];
                return (
                  <div key={fb.id} className="bg-surface-50 rounded-lg p-2.5 text-xs space-y-1">
                    {rec && (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${rec.color}`}>
                        {rec.label}
                      </span>
                    )}
                    {fb.overall_rating && (
                      <div className="flex gap-0.5 mt-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`w-3 h-3 ${i < fb.overall_rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`} />
                        ))}
                      </div>
                    )}
                    {fb.notes && <p className="text-gray-600">{fb.notes}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add feedback / inline form */}
      {(['scheduled', 'rescheduled', 'completed'].includes(interview.status)) && canComplete && (
        <div className="pl-14">
          {showFeedback ? (
            <InlineFeedbackForm
              interviewId={interview.id}
              onSuccess={() => { setShowFeedback(false); onRefetch(); }}
              onCancel={() => setShowFeedback(false)}
            />
          ) : (
            <button
              onClick={() => setShowFeedback(true)}
              className="mt-3 text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              + Add feedback
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── View Tabs ─────────────────────────────────────────────────────────────────

const VIEW_TABS = [
  { value: 'all', label: 'All Interviews' },
  { value: 'mine', label: 'My Interviews', icon: UserCheck },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InterviewsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [viewMode, setViewMode] = useState('all');
  const [activeTab, setActiveTab] = useState('scheduled');
  const [page, setPage] = useState(1);
  const [rescheduleFor, setRescheduleFor] = useState(null);

  const isInterviewer = user?.role === ROLES.INTERVIEWER;
  const isHR = HR_ROLES.includes(user?.role);
  const canComplete = isHR || isInterviewer;
  const canCancel = isHR;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['hr-interviews', { viewMode, status: activeTab, page }],
    queryFn: () => {
      const params = { status: activeTab || undefined, page, limit: 50 };
      const fn = viewMode === 'mine' ? interviewsApi.mine : interviewsApi.list;
      return fn(params).then((r) => r.data);
    },
    keepPreviousData: true,
  });

  const completeMut = useMutation({
    mutationFn: (id) => interviewsApi.complete(id),
    onSuccess: () => {
      toast.success('Interview marked as completed');
      qc.invalidateQueries({ queryKey: ['hr-interviews'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to complete interview'),
  });

  const interviews = data?.items ?? [];
  const grouped = groupByDate(interviews);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">Interviews</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.total ?? 0} interview{data?.total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* View tabs (All / My Interviews) — hidden for pure interviewer since they only see theirs */}
      {!isInterviewer && (
        <div className="flex gap-1 bg-surface-100 rounded-xl p-1 mb-4 w-fit">
          {VIEW_TABS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => { setViewMode(value); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 bg-surface-100 rounded-xl p-1 mb-6 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setActiveTab(tab.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-surface-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-20">
          <Calendar className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            {activeTab === 'scheduled' ? 'No upcoming interviews' : activeTab ? `No ${activeTab} interviews` : 'No interviews found'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([dateKey, dayInterviews]) => (
            <div key={dateKey}>
              <h2 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {dateGroupLabel(dayInterviews[0].scheduled_at)}
                <span className="text-gray-300 font-normal">·</span>
                <span className="text-gray-400 font-normal">{format(parseISO(dateKey), 'MMMM d')}</span>
              </h2>
              <div className="space-y-3">
                {dayInterviews.map((interview) => (
                  <InterviewCard
                    key={interview.id}
                    interview={interview}
                    onCandidateClick={(appId) => navigate(`/hr/applicants/${appId}?tab=interviews`)}
                    canComplete={canComplete}
                    canCancel={canCancel}
                    onComplete={(id) => completeMut.mutate(id)}
                    onReschedule={(iv) => setRescheduleFor(iv)}
                    onRefetch={refetch}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">{page} / {data.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="text-sm px-3 py-1.5 border border-surface-200 rounded-lg text-gray-600 hover:bg-surface-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {rescheduleFor && (
        <RescheduleDialog
          interview={rescheduleFor}
          onClose={() => setRescheduleFor(null)}
          onSuccess={() => {
            setRescheduleFor(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
