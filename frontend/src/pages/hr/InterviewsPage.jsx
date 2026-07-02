import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, isToday, isTomorrow, isThisWeek, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import {
  Calendar, Clock, Video, Phone, MapPin, Users, ExternalLink,
  UserCheck, Star, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, RefreshCw, History,
  X, FileText, Linkedin, Github, Globe, Briefcase, GraduationCap, Building2,
} from 'lucide-react';
import { interviewsApi } from '@/api/interviews';
import { applicationsApi } from '@/api/applications';
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

// ── Shared components ─────────────────────────────────────────────────────────

const SCORE_DIMENSIONS = [
  { key: 'technical_score',       label: 'Technical' },
  { key: 'communication_score',   label: 'Communication' },
  { key: 'cultural_fit_score',    label: 'Culture Fit' },
  { key: 'problem_solving_score', label: 'Problem Solving' },
];

function ScoreSelector({ value, onChange }) {
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          className={`w-7 h-7 rounded-full border-2 text-xs font-bold transition-all ${
            value != null && n <= value
              ? 'bg-brand-500 border-brand-500 text-white'
              : 'border-surface-300 text-gray-400 hover:border-brand-400 hover:text-brand-500'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function InterviewFeedbackCard({ fb }) {
  const rec = RECOMMENDATION_LABELS[fb.recommendation];
  const scores = [
    { label: 'Technical',       val: fb.technical_score },
    { label: 'Communication',   val: fb.communication_score },
    { label: 'Culture Fit',     val: fb.cultural_fit_score },
    { label: 'Problem Solving', val: fb.problem_solving_score },
  ].filter((s) => s.val != null);

  return (
    <div className="bg-surface-50 rounded-xl border border-surface-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        {fb.overall_rating && (
          <div className="flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className={`w-3.5 h-3.5 ${i < fb.overall_rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`} />
            ))}
          </div>
        )}
        {rec && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rec.color}`}>
            {rec.label}
          </span>
        )}
      </div>

      {scores.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {scores.map(({ label, val }) => (
            <div key={label} className="bg-white rounded-lg p-2 text-center border border-surface-100">
              <p className="text-sm font-bold text-gray-900">{val}<span className="text-xs text-gray-400 font-normal">/5</span></p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {(fb.strengths || fb.weaknesses) && (
        <div className="grid grid-cols-2 gap-3 text-xs mb-3">
          {fb.strengths && (
            <div>
              <p className="font-semibold text-green-700 mb-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Strengths
              </p>
              <p className="text-gray-700">{fb.strengths}</p>
            </div>
          )}
          {fb.weaknesses && (
            <div>
              <p className="font-semibold text-orange-700 mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Areas to improve
              </p>
              <p className="text-gray-700">{fb.weaknesses}</p>
            </div>
          )}
        </div>
      )}

      {fb.notes && <p className="text-xs text-gray-600 bg-white rounded-lg p-2.5 border border-surface-100">{fb.notes}</p>}
    </div>
  );
}

// ── Feedback Form ─────────────────────────────────────────────────────────────

function InlineFeedbackForm({ interviewId, onSuccess, onCancel }) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm();
  const [overallRating,  setOverallRating]  = useState(null);
  const [recommendation, setRecommendation] = useState('');
  const [scores, setScores] = useState({
    technical_score: null, communication_score: null,
    cultural_fit_score: null, problem_solving_score: null,
  });

  const submitMut = useMutation({
    mutationFn: (data) => interviewsApi.submitFeedback(interviewId, data),
    onSuccess: () => { toast.success('Feedback submitted'); onSuccess(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to submit feedback'),
  });

  const onSubmit = (textValues) => {
    const payload = { ...textValues };
    if (overallRating)  payload.overall_rating  = overallRating;
    if (recommendation) payload.recommendation  = recommendation;
    Object.entries(scores).forEach(([k, v]) => { if (v != null) payload[k] = v; });
    Object.keys(payload).forEach((k) => { if (payload[k] === '' || payload[k] == null) delete payload[k]; });
    submitMut.mutate(payload);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-4 pt-4 border-t border-surface-100 space-y-5">
      <h4 className="text-sm font-semibold text-gray-900">Submit Feedback</h4>

      {/* Overall rating */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Overall Rating</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setOverallRating(overallRating === n ? null : n)} className="p-0.5">
              <Star className={`w-5 h-5 ${n <= (overallRating ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} />
            </button>
          ))}
        </div>
      </div>

      {/* Recommendation — pill buttons */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Recommendation</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(RECOMMENDATION_LABELS).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => setRecommendation(recommendation === k ? '' : k)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                recommendation === k
                  ? v.color + ' border-transparent'
                  : 'bg-white text-gray-500 border-surface-300 hover:border-gray-400'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scores — dot selectors */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {SCORE_DIMENSIONS.map(({ key, label }) => (
          <div key={key}>
            <p className="text-xs font-medium text-gray-600 mb-1.5">{label}</p>
            <ScoreSelector
              value={scores[key]}
              onChange={(v) => setScores((s) => ({ ...s, [key]: v }))}
            />
          </div>
        ))}
      </div>

      {/* Text fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Strengths</label>
          <textarea
            {...register('strengths')}
            rows={2}
            className="w-full px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Areas to improve</label>
          <textarea
            {...register('weaknesses')}
            rows={2}
            className="w-full px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Additional notes</label>
        <textarea
          {...register('notes')}
          rows={2}
          className="w-full px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting || submitMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
        >
          {(isSubmitting || submitMut.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Submit feedback
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Candidate Profile Drawer ──────────────────────────────────────────────────

const STAGE_COLORS = {
  applied:    'bg-gray-100 text-gray-700',
  screening:  'bg-blue-100 text-blue-700',
  interview:  'bg-indigo-100 text-indigo-700',
  offer:      'bg-green-100 text-green-700',
  hired:      'bg-emerald-100 text-emerald-700',
  rejected:   'bg-red-100 text-red-700',
  withdrawn:  'bg-orange-100 text-orange-700',
};

function CandidateDrawer({ applicationId, isHR, onClose }) {
  const { data: app, isLoading } = useQuery({
    queryKey: ['application-brief', applicationId],
    queryFn: () => applicationsApi.getById(applicationId).then((r) => r.data),
    enabled: !!applicationId,
  });

  const candidate = app?.applicant;
  const profile = app?.candidate_profile;
  const initials = candidate?.full_name
    ?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() ?? '?';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
          <h2 className="font-display font-bold text-gray-900 text-base">Candidate Profile</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          </div>
        ) : !app ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Could not load candidate details.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">

            {/* Identity */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg flex-shrink-0">
                {candidate?.avatar_url
                  ? <img src={candidate.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                  : initials}
              </div>
              <div>
                <p className="font-display font-bold text-gray-900 text-lg leading-tight">{candidate?.full_name}</p>
                <p className="text-sm text-gray-500">{candidate?.email}</p>
              </div>
            </div>

            {/* Application meta */}
            <div className="bg-surface-50 rounded-xl p-4 space-y-2">
              {app.job_title && (
                <div className="flex items-center gap-2 text-sm">
                  <Briefcase className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 font-medium">{app.job_title}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STAGE_COLORS[app.stage] ?? 'bg-gray-100 text-gray-700'}`}>
                  {app.stage}
                </span>
                <span className="text-xs text-gray-400">Applied {format(parseISO(app.applied_at), 'MMM d, yyyy')}</span>
              </div>
            </div>

            {/* Profile brief */}
            {profile && (
              <div className="space-y-2.5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Profile</p>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  {profile.total_experience && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Briefcase className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span>{profile.total_experience} experience</span>
                    </div>
                  )}
                  {profile.current_company && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span>{profile.current_designation ? `${profile.current_designation} at ` : ''}{profile.current_company}</span>
                    </div>
                  )}
                  {profile.current_location && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span>{profile.current_location}</span>
                    </div>
                  )}
                  {profile.education && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <GraduationCap className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span>{profile.education}</span>
                    </div>
                  )}
                </div>
                {profile.skills && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {profile.skills.split(',').map((s) => s.trim()).filter(Boolean).map((skill) => (
                      <span key={skill} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full font-medium">
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Resume + links */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents & Links</p>
              <div className="space-y-2">
                <a
                  href={app.resume_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-semibold hover:bg-brand-600 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  View Resume
                  <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-70" />
                </a>
                {app.linkedin_url && (
                  <a href={app.linkedin_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 border border-surface-200 rounded-lg text-sm text-gray-700 hover:bg-surface-50 transition-colors">
                    <Linkedin className="w-4 h-4 text-blue-600" /> LinkedIn
                    <ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
                  </a>
                )}
                {app.portfolio_url && (
                  <a href={app.portfolio_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 border border-surface-200 rounded-lg text-sm text-gray-700 hover:bg-surface-50 transition-colors">
                    <Globe className="w-4 h-4 text-purple-500" /> Portfolio
                    <ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
                  </a>
                )}
                {app.github_url && (
                  <a href={app.github_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 border border-surface-200 rounded-lg text-sm text-gray-700 hover:bg-surface-50 transition-colors">
                    <Github className="w-4 h-4 text-gray-800" /> GitHub
                    <ExternalLink className="w-3.5 h-3.5 ml-auto text-gray-400" />
                  </a>
                )}
              </div>
            </div>

            {/* Cover letter */}
            {app.cover_letter && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cover Letter</p>
                <p className="text-sm text-gray-700 bg-surface-50 rounded-xl p-4 leading-relaxed whitespace-pre-line">
                  {app.cover_letter}
                </p>
              </div>
            )}

            {/* HR-only: full profile link */}
            {isHR && (
              <a
                href={`/hr/applicants/${applicationId}`}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-brand-200 text-brand-600 rounded-lg text-sm font-semibold hover:bg-brand-50 transition-colors"
              >
                Open Full Application
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Interview Card ────────────────────────────────────────────────────────────

function InterviewCard({ interview, onCandidateClick, canComplete, canCancel, onComplete, onReschedule, onRefetch }) {
  const TypeIcon = TYPE_ICONS[interview.interview_type] ?? Calendar;
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAllFeedback, setShowAllFeedback] = useState(false);
  const [showPrevRounds, setShowPrevRounds] = useState(false);

  const hasFeedback = interview.feedback?.length > 0;
  const hasPrevRounds = interview.previous_rounds_feedback?.length > 0;

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

      {/* Previous rounds feedback — visible to TR2 and HR interviewers */}
      {hasPrevRounds && (
        <div className="mt-3 pt-3 border-t border-surface-100 pl-14">
          <button
            onClick={() => setShowPrevRounds((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
          >
            <History className="w-3.5 h-3.5" />
            Previous round feedback ({interview.previous_rounds_feedback.reduce((s, r) => s + r.feedback.length, 0)})
            {showPrevRounds ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showPrevRounds && (
            <div className="mt-3 space-y-4">
              {interview.previous_rounds_feedback.map((round) => (
                <div key={round.round_number}>
                  <p className="text-xs font-semibold text-gray-500 mb-2">
                    Round {round.round_number}{round.interview_title ? ` — ${round.interview_title}` : ''}
                  </p>
                  {round.feedback.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No feedback submitted yet</p>
                  ) : (
                    <div className="space-y-2">
                      {round.feedback.map((fb) => (
                        <InterviewFeedbackCard key={fb.id} fb={fb} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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
              {interview.feedback.map((fb) => (
                <InterviewFeedbackCard key={fb.id} fb={fb} />
              ))}
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
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [viewMode, setViewMode] = useState('all');
  const [activeTab, setActiveTab] = useState('scheduled');
  const [page, setPage] = useState(1);
  const [rescheduleFor, setRescheduleFor] = useState(null);
  const [confirmCompleteId, setConfirmCompleteId] = useState(null);
  const [candidateDrawerAppId, setCandidateDrawerAppId] = useState(null);

  const isInterviewer = user?.role === ROLES.INTERVIEWER;
  const isHR = HR_ROLES.includes(user?.role);
  const canComplete = isHR || isInterviewer;
  const canCancel = isHR;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['hr-interviews', { viewMode: isInterviewer ? 'mine' : viewMode, status: activeTab, page }],
    queryFn: () => {
      const params = { status: activeTab || undefined, page, limit: 50 };
      const fn = (viewMode === 'mine' || isInterviewer) ? interviewsApi.mine : interviewsApi.list;
      return fn(params).then((r) => r.data);
    },
    keepPreviousData: true,
  });

  const completeMut = useMutation({
    mutationFn: (id) => interviewsApi.complete(id),
    onSuccess: () => {
      setConfirmCompleteId(null);
      toast.success('Interview marked as completed');
      qc.invalidateQueries({ queryKey: ['hr-interviews'] });
      qc.invalidateQueries({ queryKey: ['application-interviews'] });
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
                    onCandidateClick={(appId) => setCandidateDrawerAppId(appId)}
                    canComplete={canComplete}
                    canCancel={canCancel}
                    onComplete={(id) => setConfirmCompleteId(id)}
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

      {candidateDrawerAppId && (
        <CandidateDrawer
          applicationId={candidateDrawerAppId}
          isHR={isHR}
          onClose={() => setCandidateDrawerAppId(null)}
        />
      )}

      {confirmCompleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setConfirmCompleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-sm z-10 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-gray-900">Mark interview as completed?</h3>
                <p className="text-sm text-gray-500 mt-0.5">This will update the interview status to completed.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmCompleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => completeMut.mutate(confirmCompleteId)}
                disabled={completeMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                {completeMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Yes, complete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
