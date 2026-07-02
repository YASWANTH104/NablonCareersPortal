import { useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow, format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Star, ExternalLink, FileText, Calendar, MessageSquare,
  Clock, User, Github, Linkedin, Globe, ChevronDown, Plus, Loader2,
  Video, Phone, MapPin, CheckCircle2, XCircle, AlertCircle, Send, FolderOpen, Download, Eye, X,
} from 'lucide-react';
import { applicationsApi } from '@/api/applications';
import { interviewsApi } from '@/api/interviews';
import { assessmentsApi } from '@/api/assessments';
import { jobsApi } from '@/api/jobs';
import { offersApi } from '@/api/offers';
import { usersApi } from '@/api/users';
import { documentsApi } from '@/api/documents';

// ── Constants ─────────────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'applied',     label: 'Applied',     color: 'bg-blue-100 text-blue-800' },
  { key: 'screening',   label: 'Screening',   color: 'bg-purple-100 text-purple-800' },
  { key: 'assessment',  label: 'Assessment',  color: 'bg-orange-100 text-orange-800' },
  { key: 'tr1',         label: 'TR1',         color: 'bg-indigo-100 text-indigo-800' },
  { key: 'tr2',         label: 'TR2',         color: 'bg-indigo-100 text-indigo-800' },
  { key: 'hr',          label: 'HR',          color: 'bg-violet-100 text-violet-800' },
  { key: 'offer',       label: 'Offer',       color: 'bg-emerald-100 text-emerald-800' },
  { key: 'hired',       label: 'Hired',       color: 'bg-green-100 text-green-800' },
  { key: 'rejected',    label: 'Rejected',    color: 'bg-red-100 text-red-800' },
  { key: 'withdrawn',   label: 'Withdrawn',   color: 'bg-gray-100 text-gray-600' },
];

const STAGE_MAP = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s]));

const VALID_TRANSITIONS = {
  applied:    ['screening', 'rejected'],
  screening:  ['assessment', 'tr1', 'rejected'],
  assessment: ['tr1', 'rejected'],
  tr1:        ['tr2', 'hr', 'offer', 'rejected'],
  tr2:        ['hr', 'offer', 'rejected'],
  hr:         ['offer', 'rejected'],
  offer:      ['hired', 'rejected'],
  hired:      [],
  rejected:   [],
  withdrawn:  [],
};

const INTERVIEW_TYPES = ['video', 'phone', 'onsite', 'technical', 'hr', 'panel'];

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 120, label: '2 hr' },
];

const RECOMMENDATION_LABELS = {
  strong_yes: { label: 'Strong Yes', color: 'text-green-700 bg-green-50' },
  yes:        { label: 'Yes', color: 'text-emerald-700 bg-emerald-50' },
  neutral:    { label: 'Neutral', color: 'text-gray-700 bg-gray-100' },
  no:         { label: 'No', color: 'text-orange-700 bg-orange-50' },
  strong_no:  { label: 'Strong No', color: 'text-red-700 bg-red-50' },
};

// ── Schedule Interview Dialog ─────────────────────────────────────────────────

const scheduleSchema = z.object({
  round_number: z.coerce.number().min(1),
  title: z.string().optional(),
  interview_type: z.string().min(1, 'Required'),
  scheduled_at: z.string().min(1, 'Required'),
  duration_mins: z.coerce.number(),
  meeting_link: z.string().min(1, 'Meeting link is required').url('Enter a valid URL'),
  location: z.string().optional(),
  notes: z.string().optional(),
});

function ScheduleInterviewDialog({ applicationId, defaultRoundNumber = 1, onClose, onSuccess }) {
  const [panelists, setPanelists] = useState([]);
  const [panelistSearch, setPanelistSearch] = useState('');
  const [panelistError, setPanelistError] = useState(false);

  const { data: eligibleUsers = [] } = useQuery({
    queryKey: ['panel-eligible-users'],
    queryFn: () => usersApi.panelEligible().then((r) => r.data),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { round_number: defaultRoundNumber, duration_mins: 60, interview_type: 'video' },
  });

  const createMutation = useMutation({
    mutationFn: (data) => interviewsApi.create(data),
    onSuccess: () => {
      toast.success('Interview scheduled');
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to schedule'),
  });

  const onSubmit = (values) => {
    if (panelists.length === 0) {
      setPanelistError(true);
      return;
    }
    createMutation.mutate({
      application_id: applicationId,
      ...values,
      round_number: Number(values.round_number),
      scheduled_at: new Date(values.scheduled_at).toISOString(),
      duration_mins: Number(values.duration_mins),
      meeting_link: values.meeting_link || undefined,
      location: values.location || undefined,
      notes: values.notes || undefined,
      title: values.title || undefined,
      panelists: panelists.map((p) => ({ user_id: p.id, role: p.panelRole })),
    });
  };

  const addPanelist = (user) => {
    if (!panelists.find((p) => p.id === user.id)) {
      setPanelists((prev) => [...prev, { ...user, panelRole: 'interviewer' }]);
      setPanelistError(false);
    }
    setPanelistSearch('');
  };

  const removePanelist = (id) => setPanelists((prev) => prev.filter((p) => p.id !== id));

  const updatePanelistRole = (id, role) =>
    setPanelists((prev) => prev.map((p) => (p.id === id ? { ...p, panelRole: role } : p)));

  const addedIds = new Set(panelists.map((p) => p.id));
  const filteredUsers = eligibleUsers.filter(
    (u) => !addedIds.has(u.id) &&
      (!panelistSearch || u.full_name.toLowerCase().includes(panelistSearch.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="font-display font-bold text-gray-900 mb-5">Schedule Interview</h3>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Round #</label>
              <input
                {...register('round_number')}
                type="number"
                min="1"
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                {...register('title')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="e.g. Technical Round"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select
                {...register('interview_type')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white capitalize"
              >
                {INTERVIEW_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {errors.interview_type && (
                <p className="mt-1 text-xs text-red-500">{errors.interview_type.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date & Time *</label>
              <input
                {...register('scheduled_at')}
                type="datetime-local"
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {errors.scheduled_at && (
                <p className="mt-1 text-xs text-red-500">{errors.scheduled_at.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
              <select
                {...register('duration_mins')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
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
            {errors.meeting_link && (
              <p className="mt-1 text-xs text-red-500">{errors.meeting_link.message}</p>
            )}
          </div>

          {/* Panelists */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Interviewers <span className="text-red-500">*</span>
            </label>

            {/* Added panelists */}
            {panelists.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {panelists.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 bg-surface-50 rounded-lg px-3 py-2">
                    <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-brand-700 text-xs font-semibold">
                        {p.full_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-sm text-gray-800 flex-1 truncate">{p.full_name}</span>
                    <select
                      value={p.panelRole}
                      onChange={(e) => updatePanelistRole(p.id, e.target.value)}
                      className="text-xs border border-surface-200 rounded px-1.5 py-1 bg-white text-gray-600 focus:outline-none"
                    >
                      <option value="interviewer">Interviewer</option>
                      <option value="observer">Observer</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removePanelist(p.id)}
                      className="text-gray-400 hover:text-red-500 text-lg leading-none ml-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Search to add */}
            <div className="relative">
              <input
                type="text"
                value={panelistSearch}
                onChange={(e) => setPanelistSearch(e.target.value)}
                placeholder="Search by name to add interviewer…"
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {panelistSearch && filteredUsers.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-surface-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => addPanelist(u)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-50 text-left"
                    >
                      <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-brand-700 text-xs font-semibold">
                          {u.full_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm text-gray-800">{u.full_name}</p>
                        <p className="text-xs text-gray-400 capitalize">{u.role.replace('_', ' ')}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {panelistSearch && filteredUsers.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-surface-200 rounded-lg shadow-lg z-10 px-3 py-2 text-sm text-gray-400">
                  No matching interviewers
                </div>
              )}
            </div>
            {panelistError && (
              <p className="mt-1 text-xs text-red-500">At least one interviewer is required</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              {...register('notes')}
              rows={2}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
            >
              {(isSubmitting || createMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Schedule
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Schedule Assessment Dialog ────────────────────────────────────────────────

// UPDATE_URLS: replace placeholder hrefs with your actual assessment platform links
const ASSESSMENT_PRESETS = [
  { label: 'AI Intern',       url: 'https://assessment.nablon.ai/ai-intern' },
  { label: 'AI Engineer 1',   url: 'https://assessment.nablon.ai/ai-engineer-1' },
  { label: 'AI Engineer 2',   url: 'https://assessment.nablon.ai/ai-engineer-2' },
  { label: 'Data Engineer 1', url: 'https://assessment.nablon.ai/data-engineer-1' },
  { label: 'Data Engineer 2', url: 'https://assessment.nablon.ai/data-engineer-2' },
  { label: 'ML Engineer',     url: 'https://assessment.nablon.ai/ml-engineer' },
  { label: 'Backend Engineer',url: 'https://assessment.nablon.ai/backend-engineer' },
  { label: 'Custom link',     url: '__custom__' },
];

const ASSESSMENT_TYPES = [
  { value: 'online_test', label: 'Online Test' },
  { value: 'coding_challenge', label: 'Coding Challenge' },
  { value: 'aptitude', label: 'Aptitude Test' },
  { value: 'case_study', label: 'Case Study' },
  { value: 'assignment', label: 'Assignment' },
];

const assessmentSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  assessment_type: z.string().min(1, 'Required'),
  deadline: z.string().min(1, 'Deadline is required'),
  duration_mins: z.coerce.number().optional(),
  platform_link: z.string().min(1, 'Assessment link is required').url('Enter a valid URL'),
  instructions: z.string().optional(),
});

function ScheduleAssessmentDialog({ applicationId, onClose, onSuccess }) {
  const [presetSelection, setPresetSelection] = useState('');

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(assessmentSchema),
    defaultValues: { assessment_type: 'online_test' },
  });

  const platformLink = useWatch({ control, name: 'platform_link' });

  const createMutation = useMutation({
    mutationFn: (data) => assessmentsApi.create(data),
    onSuccess: () => {
      toast.success('Assessment scheduled & email sent to candidate');
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to schedule assessment'),
  });

  const onSubmit = (values) => {
    createMutation.mutate({
      application_id: applicationId,
      ...values,
      deadline: new Date(values.deadline).toISOString(),
      duration_mins: values.duration_mins ? Number(values.duration_mins) : undefined,
      instructions: values.instructions || undefined,
    });
  };

  const handlePresetChange = (e) => {
    const selected = e.target.value;
    setPresetSelection(selected);
    if (selected === '__custom__') {
      setValue('platform_link', '', { shouldValidate: false });
    } else {
      setValue('platform_link', selected, { shouldValidate: true });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="font-display font-bold text-gray-900 mb-5">Schedule Assessment</h3>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input
                {...register('title')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="e.g. Technical Skills Test"
              />
              {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select
                {...register('assessment_type')}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                {ASSESSMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Duration <span className="text-gray-400 font-normal">(mins, optional)</span>
              </label>
              <input
                {...register('duration_mins')}
                type="number"
                min="1"
                placeholder="e.g. 60"
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deadline *</label>
            <input
              {...register('deadline')}
              type="datetime-local"
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {errors.deadline && <p className="mt-1 text-xs text-red-500">{errors.deadline.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Assessment Link <span className="text-red-500">*</span>
            </label>
            {/* hidden field that react-hook-form validates */}
            <input type="hidden" {...register('platform_link')} />
            <select
              value={presetSelection}
              onChange={handlePresetChange}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            >
              <option value="" disabled>— Select role assessment —</option>
              {ASSESSMENT_PRESETS.map((p) => (
                <option key={p.url} value={p.url}>{p.label}</option>
              ))}
            </select>
            {presetSelection === '__custom__' && (
              <input
                value={platformLink ?? ''}
                onChange={(e) => setValue('platform_link', e.target.value, { shouldValidate: true })}
                type="url"
                placeholder="https://..."
                className="mt-2 w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            )}
            {errors.platform_link && <p className="mt-1 text-xs text-red-500">{errors.platform_link.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Instructions <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              {...register('instructions')}
              rows={3}
              placeholder="Any special instructions for the candidate..."
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
            >
              {(isSubmitting || createMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Schedule & Notify
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

// ── Reschedule Interview Dialog ───────────────────────────────────────────────

const rescheduleSchema = z.object({
  scheduled_at: z.string().min(1, 'Required'),
  duration_mins: z.coerce.number(),
  meeting_link: z.string().min(1, 'Meeting link is required').url('Enter a valid URL'),
});

function RescheduleInterviewDialog({ interview, onClose, onSuccess }) {
  const existingDate = interview.scheduled_at
    ? new Date(interview.scheduled_at).toISOString().slice(0, 16)
    : '';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(rescheduleSchema),
    defaultValues: {
      scheduled_at: existingDate,
      duration_mins: interview.duration_mins ?? 60,
      meeting_link: interview.meeting_link ?? '',
    },
  });

  const updateMutation = useMutation({
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
        <h3 className="font-display font-bold text-gray-900 mb-5">Reschedule Interview</h3>
        <form onSubmit={handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
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
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
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
              disabled={isSubmitting || updateMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
            >
              {(isSubmitting || updateMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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

// ── Feedback Form ─────────────────────────────────────────────────────────────

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

function FeedbackForm({ interviewId, onSuccess }) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm();

  const [overallRating,      setOverallRating]      = useState(null);
  const [recommendation,     setRecommendation]     = useState('');
  const [scores, setScores] = useState({
    technical_score: null, communication_score: null,
    cultural_fit_score: null, problem_solving_score: null,
  });

  const submitMutation = useMutation({
    mutationFn: (data) => interviewsApi.submitFeedback(interviewId, data),
    onSuccess: () => { toast.success('Feedback submitted'); onSuccess(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to submit'),
  });

  const onSubmit = (textValues) => {
    const payload = { ...textValues };
    if (overallRating)  payload.overall_rating  = overallRating;
    if (recommendation) payload.recommendation  = recommendation;
    Object.entries(scores).forEach(([k, v]) => { if (v != null) payload[k] = v; });
    Object.keys(payload).forEach((k) => { if (payload[k] === '' || payload[k] == null) delete payload[k]; });
    submitMutation.mutate(payload);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 p-4 bg-surface-50 rounded-xl border border-surface-200">
      <h4 className="text-sm font-semibold text-gray-900">Submit Feedback</h4>

      {/* Overall rating */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Overall Rating</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setOverallRating(overallRating === n ? null : n)}
              className="p-0.5"
            >
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

      {/* Scores — dot selectors matching the display grid */}
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

      <button
        type="submit"
        disabled={isSubmitting || submitMutation.isPending}
        className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
      >
        {(isSubmitting || submitMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Submit feedback
      </button>
    </form>
  );
}

// ── Candidate Self-Assessment Card ───────────────────────────────────────────

const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', very_hard: 'Very Hard' };
const EXPERIENCE_LABEL = { excellent: 'Excellent', good: 'Good', average: 'Average', poor: 'Poor' };

function ScoreBar({ label, value }) {
  if (value == null) return null;
  const color = value <= 3 ? 'bg-red-400' : value <= 6 ? 'bg-yellow-400' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-32 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-surface-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${(value / 10) * 100}%` }} />
      </div>
      <span className={`text-xs font-semibold w-5 text-right ${value <= 3 ? 'text-red-500' : value <= 6 ? 'text-yellow-500' : 'text-green-600'}`}>
        {value}
      </span>
    </div>
  );
}

function CandidateSelfAssessment({ sf }) {
  const [open, setOpen] = useState(false);
  const hasScores = sf.overall_score != null || sf.communication_score != null || sf.technical_confidence != null;
  return (
    <div className="mt-4 pt-4 border-t border-surface-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left"
      >
        <p className="text-xs font-semibold text-indigo-700">Candidate's self-assessment</p>
        <ChevronDown className={`w-3.5 h-3.5 text-indigo-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {hasScores && (
            <div className="space-y-1.5">
              <ScoreBar label="Overall performance" value={sf.overall_score} />
              <ScoreBar label="Communication" value={sf.communication_score} />
              <ScoreBar label="Technical confidence" value={sf.technical_confidence} />
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            {sf.difficulty && (
              <span className="px-2 py-1 bg-surface-100 rounded-full text-gray-600">
                Difficulty: <span className="font-medium">{DIFFICULTY_LABEL[sf.difficulty] ?? sf.difficulty}</span>
              </span>
            )}
            {sf.experience_rating && (
              <span className="px-2 py-1 bg-surface-100 rounded-full text-gray-600">
                Experience: <span className="font-medium">{EXPERIENCE_LABEL[sf.experience_rating] ?? sf.experience_rating}</span>
              </span>
            )}
            {sf.was_prepared != null && (
              <span className="px-2 py-1 bg-surface-100 rounded-full text-gray-600">
                Prepared: <span className={`font-medium ${sf.was_prepared ? 'text-green-600' : 'text-red-500'}`}>{sf.was_prepared ? 'Yes' : 'No'}</span>
              </span>
            )}
            {sf.would_recommend != null && (
              <span className="px-2 py-1 bg-surface-100 rounded-full text-gray-600">
                Would recommend: <span className={`font-medium ${sf.would_recommend ? 'text-green-600' : 'text-red-500'}`}>{sf.would_recommend ? 'Yes' : 'No'}</span>
              </span>
            )}
          </div>
          {sf.comments && (
            <p className="text-xs text-gray-600 bg-indigo-50 rounded-lg p-2.5 italic">"{sf.comments}"</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared Interview Feedback Card ────────────────────────────────────────────

function InterviewFeedbackCard({ fb, interview }) {
  const rec = RECOMMENDATION_LABELS[fb.recommendation];
  const scores = [
    { label: 'Technical',       val: fb.technical_score },
    { label: 'Communication',   val: fb.communication_score },
    { label: 'Culture Fit',     val: fb.cultural_fit_score },
    { label: 'Problem Solving', val: fb.problem_solving_score },
  ].filter((s) => s.val != null);

  return (
    <div className="bg-white rounded-xl border border-surface-200 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          {interview && (
            <>
              <p className="text-sm font-semibold text-gray-900">
                {interview.title || `Round ${interview.round_number}`}
              </p>
              <p className="text-xs text-gray-400">{format(new Date(interview.scheduled_at), 'PPP')}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fb.overall_rating && (
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className={`w-4 h-4 ${i < fb.overall_rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`} />
              ))}
            </div>
          )}
          {rec && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rec.color}`}>
              {rec.label}
            </span>
          )}
        </div>
      </div>

      {/* Scores grid */}
      {scores.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          {scores.map(({ label, val }) => (
            <div key={label} className="bg-surface-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-gray-900">{val}<span className="text-xs text-gray-400 font-normal">/5</span></p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Strengths / Weaknesses */}
      {(fb.strengths || fb.weaknesses) && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          {fb.strengths && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Strengths
              </p>
              <p className="text-gray-700 text-xs">{fb.strengths}</p>
            </div>
          )}
          {fb.weaknesses && (
            <div>
              <p className="text-xs font-semibold text-orange-700 mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Areas to improve
              </p>
              <p className="text-gray-700 text-xs">{fb.weaknesses}</p>
            </div>
          )}
        </div>
      )}

      {fb.notes && (
        <p className="mt-3 text-xs text-gray-600 bg-surface-50 rounded-lg p-3">{fb.notes}</p>
      )}
    </div>
  );
}

// ── Reject Dialog ─────────────────────────────────────────────────────────────

function ScoreDot({ score, max = 5 }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full ${i < score ? 'bg-brand-500' : 'bg-surface-200'}`}
        />
      ))}
    </div>
  );
}

function RejectDialog({ candidateName, interviews, onConfirm, onCancel, isPending }) {
  const withFeedback = interviews.filter((iv) => iv.feedback?.length > 0);
  const noFeedback = interviews.filter((iv) => !iv.feedback?.length);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-lg z-10 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start gap-3 p-6 pb-4 flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <XCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-gray-900">Reject <span className="text-red-600">{candidateName}</span></h3>
            <p className="text-sm text-gray-500 mt-0.5">Review interviewer feedback before confirming.</p>
          </div>
        </div>

        {/* Feedback body — scrollable */}
        <div className="overflow-y-auto px-6 pb-2 space-y-4 flex-1">
          {interviews.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No interviews on record for this candidate.</p>
          ) : (
            <>
              {withFeedback.map((iv) => (
                <div key={iv.id} className="border border-surface-200 rounded-xl overflow-hidden">
                  <div className="bg-surface-50 px-4 py-2.5 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">
                      Round {iv.round_number}{iv.title ? ` — ${iv.title}` : ''}
                    </span>
                    <span className="text-xs text-gray-400">{iv.feedback.length} response{iv.feedback.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-surface-100">
                    {iv.feedback.map((fb, idx) => {
                      const rec = RECOMMENDATION_LABELS[fb.recommendation];
                      return (
                        <div key={fb.id ?? idx} className="px-4 py-3 space-y-2.5">
                          {rec && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${rec.color}`}>
                              {rec.label}
                            </span>
                          )}
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                            {[
                              ['Technical',       fb.technical_score],
                              ['Communication',   fb.communication_score],
                              ['Culture Fit',     fb.cultural_fit_score],
                              ['Problem Solving', fb.problem_solving_score],
                            ].filter(([, v]) => v != null).map(([label, val]) => (
                              <div key={label} className="flex items-center justify-between gap-2">
                                <span className="text-xs text-gray-500">{label}</span>
                                <ScoreDot score={val} />
                              </div>
                            ))}
                          </div>
                          {fb.strengths && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Strengths</p>
                              <p className="text-sm text-gray-700 leading-relaxed">{fb.strengths}</p>
                            </div>
                          )}
                          {fb.weaknesses && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Areas for Growth</p>
                              <p className="text-sm text-gray-700 leading-relaxed">{fb.weaknesses}</p>
                            </div>
                          )}
                          {fb.notes && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Notes</p>
                              <p className="text-sm text-gray-700 leading-relaxed">{fb.notes}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {noFeedback.map((iv) => (
                <div key={iv.id} className="border border-dashed border-surface-300 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-gray-400">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Round {iv.round_number}{iv.title ? ` — ${iv.title}` : ''}: no feedback submitted yet
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-surface-100 flex-shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm()}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60 transition-colors"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Confirm rejection
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ApplicationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') ?? 'overview');
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showScheduleAssessment, setShowScheduleAssessment] = useState(false);
  const [showRescheduleFor, setShowRescheduleFor] = useState(null);
  const [showFeedbackFor, setShowFeedbackFor] = useState(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [offerPdfUrl, setOfferPdfUrl] = useState(null);
  const [offerPdfLoading, setOfferPdfLoading] = useState(false);

  const { data: app, isLoading } = useQuery({
    queryKey: ['application-detail', id],
    queryFn: () => applicationsApi.getById(id).then((r) => r.data),
  });

  const { data: interviewsData, refetch: refetchInterviews } = useQuery({
    queryKey: ['application-interviews', id],
    queryFn: () => interviewsApi.list({ application_id: id, limit: 50 }).then((r) => r.data),
    enabled: !!id,
    refetchInterval: 15000,
  });

  const { data: jobData } = useQuery({
    queryKey: ['job-detail', app?.job_id],
    queryFn: () => jobsApi.getById(app.job_id).then((r) => r.data),
    enabled: !!app?.job_id,
  });

  const { data: offerData, refetch: refetchOffer, isLoading: offerLoading } = useQuery({
    queryKey: ['application-offer', id],
    queryFn: () => offersApi.getByApplication(id).then((r) => r.data),
    enabled: !!id,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: docsData, refetch: refetchDocs } = useQuery({
    queryKey: ['application-documents', id],
    queryFn: () => documentsApi.getByApplication(id).then((r) => r.data),
    enabled: !!id,
    retry: false,
  });

  const sendDocRequestMutation = useMutation({
    mutationFn: () => documentsApi.sendRequest(id),
    onSuccess: () => {
      refetchDocs();
      toast.success('Document request email sent to candidate');
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to send request'),
  });

  const { data: assessmentsData, refetch: refetchAssessments } = useQuery({
    queryKey: ['application-assessments', id],
    queryFn: () => assessmentsApi.list({ application_id: id }).then((r) => r.data),
    enabled: !!id,
  });

  const stageMutation = useMutation({
    mutationFn: ({ stage, notes, rejection_reason }) =>
      applicationsApi.moveStage(id, stage, notes, rejection_reason),
    onSuccess: (res) => {
      // Merge only stage fields into the cached detail — preserves rich applicant/job_title
      // that the lean PATCH response doesn't include
      queryClient.setQueryData(['application-detail', id], (old) => {
        if (!old) return old;
        return { ...old, stage: res.data.stage, stage_updated_at: res.data.stage_updated_at };
      });
      // Background refetch to get fresh stage_history
      queryClient.invalidateQueries({ queryKey: ['application-detail', id], exact: true });
      queryClient.invalidateQueries({ queryKey: ['hr-applications'] });
      toast.success('Stage updated');
      setStageMenuOpen(false);
      setShowRejectDialog(false);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Cannot move to this stage'),
  });

  const starMutation = useMutation({
    mutationFn: () => applicationsApi.toggleStar(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['application-detail', id] }),
  });

  const noteMutation = useMutation({
    mutationFn: (note) => applicationsApi.addNote(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application-detail', id] });
      setNoteText('');
      toast.success('Note added');
    },
  });

  const [confirmCompleteId, setConfirmCompleteId] = useState(null);

  const completeInterviewMutation = useMutation({
    mutationFn: (interviewId) => interviewsApi.complete(interviewId),
    onSuccess: () => {
      setConfirmCompleteId(null);
      refetchInterviews();
      toast.success('Interview marked as completed');
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to complete interview'),
  });

  const cancelInterviewMutation = useMutation({
    mutationFn: (interviewId) => interviewsApi.cancel(interviewId),
    onSuccess: () => {
      refetchInterviews();
      toast.success('Interview cancelled');
    },
  });

  const cancelAssessmentMutation = useMutation({
    mutationFn: (assessmentId) => assessmentsApi.cancel(assessmentId),
    onSuccess: () => {
      refetchAssessments();
      toast.success('Assessment cancelled');
    },
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-100 rounded w-64" />
        <div className="h-32 bg-surface-100 rounded-xl" />
        <div className="h-64 bg-surface-100 rounded-xl" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p>Application not found.</p>
        <Link to="/hr/applicants" className="text-brand-600 text-sm mt-2 block">← Back to applicants</Link>
      </div>
    );
  }

  const currentStage = STAGE_MAP[app.stage];
  const validNext = VALID_TRANSITIONS[app.stage] ?? [];
  const interviews = interviewsData?.items ?? [];
  const assessments = Array.isArray(assessmentsData) ? assessmentsData : [];

  const stageHistory = (app.stage_history ?? []).filter((h) => h.to_stage !== '_note');
  const notes = (app.stage_history ?? []).filter((h) => h.to_stage === '_note');

  const OFFER_STATUS_COLORS = {
    draft:    'bg-gray-100 text-gray-600',
    sent:     'bg-blue-100 text-blue-700',
    accepted: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    revoked:  'bg-orange-100 text-orange-700',
    expired:  'bg-yellow-100 text-yellow-700',
  };

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'resume', label: 'Resume' },
    { key: 'interviews', label: `Interviews${interviews.length ? ` (${interviews.length})` : ''}` },
    { key: 'assessments', label: `Assessments${assessments.length ? ` (${assessments.length})` : ''}` },
    { key: 'feedback', label: 'Feedback' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'notes', label: `Notes${notes.length ? ` (${notes.length})` : ''}` },
    { key: 'documents', label: `Documents${docsData?.documents?.length ? ` (${docsData.documents.length})` : ''}${docsData?.status === 'complete' ? ' ✓' : ''}` },
    { key: 'offer', label: `Offer${offerData ? ' ●' : ''}` },
  ];

  return (
    <div>
      {/* Back */}
      <Link
        to="/hr/applicants"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5"
      >
        <ArrowLeft className="w-4 h-4" /> All applicants
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-surface-200 p-6 mb-6">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-xl font-bold text-brand-700">
            {(app.applicant?.full_name ?? '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-2xl font-bold text-gray-900">
                {app.applicant?.full_name ?? 'Unknown'}
              </h1>
              <button
                onClick={() => starMutation.mutate()}
                className="text-gray-400 hover:text-yellow-400 transition-colors"
              >
                <Star className={`w-5 h-5 ${app.is_starred ? 'fill-yellow-400 text-yellow-400' : ''}`} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{app.applicant?.email}</p>
            {jobData && (
              <p className="text-sm text-gray-600 mt-1">
                Applied for{' '}
                <Link to={`/jobs/${jobData.slug}`} className="text-brand-600 hover:underline" target="_blank">
                  {jobData.title}
                </Link>
              </p>
            )}
          </div>

          {/* Stage control */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-xs text-gray-400">
              Applied {formatDistanceToNow(new Date(app.applied_at), { addSuffix: true })}
            </div>
            <div className="relative">
              <button
                onClick={() => setStageMenuOpen((o) => !o)}
                disabled={validNext.length === 0}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${
                  currentStage?.color ?? 'bg-gray-100 text-gray-700'
                } ${validNext.length > 0 ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
              >
                {currentStage?.label ?? app.stage}
                {validNext.length > 0 && <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {stageMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStageMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-44 bg-white rounded-xl border border-surface-200 shadow-modal py-1">
                    <p className="px-3 pt-1 pb-1.5 text-xs text-gray-400 font-medium">Move to</p>
                    {validNext.map((stage) => {
                      const s = STAGE_MAP[stage];
                      const offerSigned =
                        offerData?.status === 'accepted' && !!offerData?.candidate_signature;
                      const blockedHired = stage === 'hired' && !offerSigned;
                      return (
                        <button
                          key={stage}
                          disabled={blockedHired}
                          title={blockedHired ? 'Candidate must accept and sign the offer letter first' : undefined}
                          onClick={() => {
                            if (blockedHired) return;
                            if (stage === 'rejected') {
                              setStageMenuOpen(false);
                              setShowRejectDialog(true);
                            } else {
                              stageMutation.mutate({ stage });
                            }
                          }}
                          className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left ${
                            blockedHired
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-gray-700 hover:bg-surface-50'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${s?.color.split(' ')[0] ?? 'bg-gray-200'} ${blockedHired ? 'opacity-30' : ''}`} />
                          <span>{s?.label ?? stage}</span>
                          {blockedHired && (
                            <span className="ml-auto text-xs text-gray-300">Awaiting signature</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Rating */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-gray-500">Rating:</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => applicationsApi.setRating(id, n).then(() => queryClient.invalidateQueries({ queryKey: ['application-detail', id] }))}
                className="p-0.5"
              >
                <Star className={`w-4 h-4 ${n <= (app.rating ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300 hover:text-yellow-300'}`} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-surface-200 mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSearchParams({ tab: tab.key }, { replace: true }); }}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Links */}
          {(app.linkedin_url || app.github_url || app.portfolio_url) && (
            <div className="bg-white rounded-xl border border-surface-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Links</h3>
              <div className="flex flex-wrap gap-3">
                {app.linkedin_url && (
                  <a href={app.linkedin_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 bg-brand-50 px-3 py-1.5 rounded-lg">
                    <Linkedin className="w-4 h-4" /> LinkedIn
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {app.github_url && (
                  <a href={app.github_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 bg-surface-100 px-3 py-1.5 rounded-lg">
                    <Github className="w-4 h-4" /> GitHub
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {app.portfolio_url && (
                  <a href={app.portfolio_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 bg-surface-100 px-3 py-1.5 rounded-lg">
                    <Globe className="w-4 h-4" /> Portfolio
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Cover Letter */}
          {app.cover_letter ? (
            <div className="bg-white rounded-xl border border-surface-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-400" /> Cover Letter
              </h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{app.cover_letter}</p>
            </div>
          ) : (
            <div className="bg-surface-50 rounded-xl border border-surface-200 p-5 text-center text-sm text-gray-400">
              No cover letter provided
            </div>
          )}

          {/* Application meta */}
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Application details</h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-400">Source</dt>
                <dd className="text-gray-700 capitalize mt-0.5">{app.source}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Interview count</dt>
                <dd className="text-gray-700 mt-0.5">{app.interview_count ?? 0}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Applied</dt>
                <dd className="text-gray-700 mt-0.5">{format(new Date(app.applied_at), 'PPP')}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Last updated</dt>
                <dd className="text-gray-700 mt-0.5">{format(new Date(app.stage_updated_at), 'PPP')}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {/* ── Resume Tab ── */}
      {activeTab === 'resume' && (
        <div className="bg-white rounded-xl border border-surface-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400" /> Resume
            </h3>
            <a
              href={app.resume_url.startsWith('http') ? app.resume_url : `http://localhost:8000${app.resume_url}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              Open <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          {app.resume_url.endsWith('.pdf') || app.resume_url.includes('.pdf') ? (
            <iframe
              src={app.resume_url.startsWith('http') ? app.resume_url : `http://localhost:8000${app.resume_url}`}
              className="w-full h-[600px] border border-surface-200 rounded-lg"
              title="Resume"
            />
          ) : (
            <div className="flex items-center justify-center py-20 bg-surface-50 rounded-xl border border-dashed border-surface-300">
              <div className="text-center">
                <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500 mb-3">Preview not available for this file type</p>
                <a
                  href={app.resume_url.startsWith('http') ? app.resume_url : `http://localhost:8000${app.resume_url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand-600 hover:text-brand-700 font-medium"
                >
                  Download resume
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Interviews Tab ── */}
      {activeTab === 'interviews' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowScheduleDialog(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors"
            >
              <Plus className="w-4 h-4" /> Schedule interview
            </button>
          </div>

          {interviews.length === 0 ? (
            <div className="bg-surface-50 rounded-xl border border-dashed border-surface-300 py-16 text-center">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No interviews scheduled yet</p>
            </div>
          ) : (
            interviews.map((interview) => {
              const isPast = new Date(interview.scheduled_at) < new Date();
              return (
                <div key={interview.id} className="bg-white rounded-xl border border-surface-200 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                        {interview.interview_type === 'video' ? (
                          <Video className="w-5 h-5 text-indigo-500" />
                        ) : interview.interview_type === 'phone' ? (
                          <Phone className="w-5 h-5 text-indigo-500" />
                        ) : (
                          <MapPin className="w-5 h-5 text-indigo-500" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {interview.title || `Round ${interview.round_number}`}
                        </p>
                        <p className="text-xs text-gray-500 capitalize">{interview.interview_type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                        interview.status === 'scheduled'   ? 'bg-blue-100 text-blue-700' :
                        interview.status === 'completed'   ? 'bg-green-100 text-green-700' :
                        interview.status === 'cancelled'   ? 'bg-red-100 text-red-700' :
                        interview.status === 'rescheduled' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {interview.status}
                      </span>
                      {['scheduled', 'rescheduled'].includes(interview.status) && (
                        <>
                          <button
                            onClick={() => setConfirmCompleteId(interview.id)}
                            className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                          </button>
                          <button
                            onClick={() => setShowRescheduleFor(interview)}
                            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                          >
                            Reschedule
                          </button>
                          <button
                            onClick={() => cancelInterviewMutation.mutate(interview.id)}
                            className="text-xs text-gray-400 hover:text-red-500"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-gray-400" />
                      {format(new Date(interview.scheduled_at), 'PPp')}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      {interview.duration_mins} min
                    </div>
                    {interview.meeting_link && (
                      <a
                        href={interview.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-brand-600 hover:text-brand-700 col-span-2"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Join meeting
                      </a>
                    )}
                  </div>

                  {interview.notes && (
                    <p className="mt-3 text-xs text-gray-500 bg-surface-50 rounded-lg p-3">
                      {interview.notes}
                    </p>
                  )}

                  {/* Feedback for this interview */}
                  {interview.feedback?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-surface-100 space-y-3">
                      <p className="text-xs font-semibold text-gray-600">
                        Feedback ({interview.feedback.length})
                      </p>
                      {interview.feedback.map((fb) => (
                        <InterviewFeedbackCard key={fb.id} fb={fb} interview={null} />
                      ))}
                    </div>
                  )}

                  {/* Candidate self-assessment */}
                  {interview.candidate_self_feedback && (
                    <CandidateSelfAssessment sf={interview.candidate_self_feedback} />
                  )}

                  {/* Submit feedback button */}
                  {['scheduled', 'rescheduled', 'completed'].includes(interview.status) && (
                    <div className="mt-3">
                      {showFeedbackFor === interview.id ? (
                        <FeedbackForm
                          interviewId={interview.id}
                          onSuccess={() => {
                            setShowFeedbackFor(null);
                            refetchInterviews();
                          }}
                        />
                      ) : (
                        <button
                          onClick={() => setShowFeedbackFor(interview.id)}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                        >
                          + Add feedback
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Assessments Tab ── */}
      {activeTab === 'assessments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowScheduleAssessment(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors"
            >
              <Plus className="w-4 h-4" /> Schedule assessment
            </button>
          </div>

          {assessments.length === 0 ? (
            <div className="bg-surface-50 rounded-xl border border-dashed border-surface-300 py-16 text-center">
              <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No assessments scheduled yet</p>
            </div>
          ) : (
            assessments.map((a) => (
              <div key={a.id} className="bg-white rounded-xl border border-surface-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 capitalize">{a.assessment_type.replace(/_/g, ' ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                      a.status === 'pending'    ? 'bg-yellow-100 text-yellow-700' :
                      a.status === 'submitted'  ? 'bg-blue-100 text-blue-700' :
                      a.status === 'evaluated'  ? 'bg-green-100 text-green-700' :
                      a.status === 'cancelled'  ? 'bg-red-100 text-red-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {a.status}
                    </span>
                    {a.status === 'pending' && (
                      <button
                        onClick={() => cancelAssessmentMutation.mutate(a.id)}
                        className="text-xs text-gray-400 hover:text-red-500"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                  {a.deadline && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-orange-400" />
                      <span className="text-orange-600 font-medium">Due: {format(new Date(a.deadline), 'PPp')}</span>
                    </div>
                  )}
                  {a.duration_mins && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      {a.duration_mins} min
                    </div>
                  )}
                  {a.platform_link && (
                    <a
                      href={a.platform_link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-brand-600 hover:text-brand-700 col-span-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Assessment link
                    </a>
                  )}
                </div>

                {a.instructions && (
                  <p className="mt-3 text-xs text-gray-500 bg-amber-50 rounded-lg p-3 border-l-2 border-amber-300">
                    {a.instructions}
                  </p>
                )}

                {(a.score != null || a.evaluator_notes) && (
                  <div className="mt-3 pt-3 border-t border-surface-100 text-xs text-gray-600">
                    {a.score != null && (
                      <p>Score: <span className="font-semibold text-gray-900">{a.score}{a.max_score ? ` / ${a.max_score}` : ''}</span></p>
                    )}
                    {a.evaluator_notes && <p className="mt-1 text-gray-500">{a.evaluator_notes}</p>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Feedback Tab ── */}
      {activeTab === 'feedback' && (
        <div className="space-y-4">
          {interviews.every((i) => !i.feedback?.length && !i.candidate_self_feedback) ? (
            <div className="bg-surface-50 rounded-xl border border-dashed border-surface-300 py-16 text-center">
              <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No feedback submitted yet</p>
              <button
                onClick={() => setActiveTab('interviews')}
                className="text-sm text-brand-600 hover:text-brand-700 font-medium mt-2"
              >
                Go to Interviews tab to add feedback
              </button>
            </div>
          ) : (
            interviews.map((interview) => {
              const hasFeedback = interview.feedback?.length > 0;
              const hasSelf = !!interview.candidate_self_feedback;
              if (!hasFeedback && !hasSelf) return null;
              return (
                <div key={interview.id} className="bg-white rounded-xl border border-surface-200 p-5 space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {interview.title || `Round ${interview.round_number}`}
                  </p>
                  {interview.feedback?.map((fb) => (
                    <InterviewFeedbackCard key={fb.id} fb={fb} interview={interview} />
                  ))}
                  {hasSelf && (
                    <CandidateSelfAssessment sf={interview.candidate_self_feedback} />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Timeline Tab ── */}
      {activeTab === 'timeline' && (
        <div className="relative">
          {stageHistory.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">No stage changes recorded yet</div>
          ) : (
            <div className="space-y-0">
              {stageHistory.map((entry, idx) => {
                const toStage = STAGE_MAP[entry.to_stage];
                const fromStage = STAGE_MAP[entry.from_stage ?? ''];
                return (
                  <div key={entry.id} className="flex gap-4 pb-6 relative">
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${toStage?.color.split(' ')[0] ?? 'bg-gray-200'}`} />
                      {idx < stageHistory.length - 1 && (
                        <div className="w-px flex-1 bg-surface-200 mt-1" />
                      )}
                    </div>
                    <div className="flex-1 pb-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{toStage?.label ?? entry.to_stage}</span>
                        {entry.from_stage && fromStage && (
                          <span className="text-gray-400"> from {fromStage.label}</span>
                        )}
                      </p>
                      {entry.notes && (
                        <p className="text-xs text-gray-500 mt-1 bg-surface-50 rounded p-2">{entry.notes}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Notes Tab ── */}
      {activeTab === 'notes' && (
        <div className="space-y-4">
          {/* Add note */}
          <div className="bg-white rounded-xl border border-surface-200 p-4">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note about this candidate..."
              rows={3}
              className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={() => noteText.trim() && noteMutation.mutate(noteText.trim())}
                disabled={!noteText.trim() || noteMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" /> Add note
              </button>
            </div>
          </div>

          {/* Notes list */}
          {notes.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">No notes yet</div>
          ) : (
            <div className="space-y-3">
              {[...notes].reverse().map((note) => (
                <div key={note.id} className="bg-white rounded-xl border border-surface-200 p-4">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.notes}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                    {note.from_stage && (
                      <span className="ml-2 text-gray-300">
                        while in <span className="text-gray-400">{STAGE_MAP[note.from_stage]?.label ?? note.from_stage}</span>
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Documents Tab ── */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          {/* Status bar */}
          {docsData ? (
            <>
              <div className={`flex items-center justify-between p-4 rounded-xl border ${
                docsData.status === 'complete'
                  ? 'bg-green-50 border-green-200'
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <div className="flex items-center gap-3">
                  {docsData.status === 'complete'
                    ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                    : <AlertCircle className="w-5 h-5 text-amber-500" />}
                  <div>
                    <p className={`text-sm font-semibold ${docsData.status === 'complete' ? 'text-green-800' : 'text-amber-800'}`}>
                      {docsData.status === 'complete'
                        ? 'All documents submitted — offer letter can be sent'
                        : `Documents pending (${docsData.documents.length} / ${docsData.required_types.length} submitted)`}
                    </p>
                    {docsData.email_sent_at && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Request sent {new Date(docsData.email_sent_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => sendDocRequestMutation.mutate()}
                  disabled={sendDocRequestMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-surface-300 rounded-lg text-gray-600 hover:bg-white transition-colors disabled:opacity-50"
                >
                  {sendDocRequestMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Send className="w-3.5 h-3.5" />}
                  Resend Email
                </button>
              </div>

              {/* Required documents list */}
              <div className="bg-white rounded-xl border border-surface-200 divide-y divide-surface-100">
                {docsData.required_types.map((req) => {
                  const uploaded = docsData.documents.find((d) => d.document_type === req.type);
                  return (
                    <div key={req.type} className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          uploaded ? 'bg-green-100' : 'bg-surface-100'
                        }`}>
                          {uploaded
                            ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                            : <FileText className="w-4 h-4 text-gray-400" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{req.label}</p>
                          {uploaded && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {uploaded.file_name} · {new Date(uploaded.uploaded_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                      {uploaded ? (
                        <a
                          href={uploaded.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-brand-600 hover:underline font-medium"
                        >
                          <ExternalLink className="w-3 h-3" /> View
                        </a>
                      ) : (
                        <span className="text-xs text-amber-600 font-medium">Pending</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="bg-surface-50 rounded-xl border border-dashed border-surface-300 py-16 text-center">
              <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-600 mb-1">No document request sent yet</p>
              <p className="text-xs text-gray-400 mb-5">
                Move the candidate to the Offer stage to automatically trigger the document request,
                or send it manually below.
              </p>
              <button
                onClick={() => sendDocRequestMutation.mutate()}
                disabled={sendDocRequestMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {sendDocRequestMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Send className="w-4 h-4" />}
                Send Document Request
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Offer Tab ── */}
      {activeTab === 'offer' && (
        <div className="space-y-4">
          {offerLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
            </div>
          ) : !offerData ? (
            <div className="bg-surface-50 rounded-xl border border-dashed border-surface-300 py-16 text-center">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-600 mb-1">No offer letter yet</p>
              {docsData?.status !== 'complete' && (
                <div className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full mb-4">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Waiting for candidate to submit all required documents
                </div>
              )}
              <p className="text-xs text-gray-400 mb-5">
                {docsData?.status === 'complete'
                  ? 'All documents received — you can now generate the offer letter.'
                  : 'The offer letter can only be sent after the candidate submits all required documents.'}
              </p>
              <button
                onClick={() => navigate(`/hr/offers/new/${id}`)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors"
              >
                <Plus className="w-4 h-4" /> Generate Offer Letter
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-surface-200 p-6 space-y-5">
              {/* Status header */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Status</p>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold capitalize ${OFFER_STATUS_COLORS[offerData.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {offerData.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {['sent', 'accepted', 'rejected', 'expired', 'revoked'].includes(offerData.status) && (
                    <button
                      onClick={async () => {
                        if (offerPdfUrl) { setOfferPdfUrl(null); return; }
                        setOfferPdfLoading(true);
                        try {
                          const url = await offersApi.fetchHtmlBlob(offerData.id);
                          setOfferPdfUrl(url);
                        } catch { toast.error('Could not load PDF'); }
                        finally { setOfferPdfLoading(false); }
                      }}
                      disabled={offerPdfLoading}
                      className="flex items-center gap-1.5 px-3 py-2 border border-surface-200 text-sm text-gray-600 rounded-xl hover:bg-surface-50 transition-colors disabled:opacity-60"
                    >
                      {offerPdfLoading
                        ? <><span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> Loading…</>
                        : <><Eye className="w-3.5 h-3.5" />{offerData.candidate_signature ? 'View Signed Offer' : 'View Offer'}</>
                      }
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/hr/offers/${offerData.id}`)}
                    className="flex items-center gap-2 px-4 py-2 border border-surface-200 text-sm text-gray-600 rounded-xl hover:bg-surface-50 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open Offer Builder
                  </button>
                </div>
              </div>

              {/* Details grid */}
              <dl className="grid grid-cols-2 gap-4 text-sm border-t border-surface-100 pt-5">
                <div>
                  <dt className="text-xs text-gray-400">Designation</dt>
                  <dd className="text-gray-800 font-medium mt-0.5">{offerData.designation}</dd>
                </div>
                {offerData.salary_ctc && (
                  <div>
                    <dt className="text-xs text-gray-400">CTC</dt>
                    <dd className="text-gray-800 font-medium mt-0.5">
                      {Number(offerData.salary_ctc).toLocaleString()} {offerData.salary_currency}
                    </dd>
                  </div>
                )}
                {offerData.joining_date && (
                  <div>
                    <dt className="text-xs text-gray-400">Joining Date</dt>
                    <dd className="text-gray-800 mt-0.5">{offerData.joining_date}</dd>
                  </div>
                )}
                {offerData.work_location && (
                  <div>
                    <dt className="text-xs text-gray-400">Location</dt>
                    <dd className="text-gray-800 mt-0.5">{offerData.work_location}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-gray-400">Probation</dt>
                  <dd className="text-gray-800 mt-0.5">{offerData.probation_months} months</dd>
                </div>
                {offerData.expires_at && (
                  <div>
                    <dt className="text-xs text-gray-400">Offer Expiry</dt>
                    <dd className="text-gray-800 mt-0.5">{format(new Date(offerData.expires_at), 'PPP')}</dd>
                  </div>
                )}
                {offerData.sent_at && (
                  <div>
                    <dt className="text-xs text-gray-400">Sent</dt>
                    <dd className="text-gray-800 mt-0.5">{format(new Date(offerData.sent_at), 'PPP')}</dd>
                  </div>
                )}
                {offerData.accepted_at && (
                  <div>
                    <dt className="text-xs text-gray-400">
                      {offerData.status === 'accepted' ? 'Accepted' : 'Responded'}
                    </dt>
                    <dd className="text-gray-800 mt-0.5">{format(new Date(offerData.accepted_at), 'PPP')}</dd>
                  </div>
                )}
              </dl>

              {/* Signature */}
              {offerData.candidate_signature && (
                <div className="border-t border-surface-100 pt-4">
                  <p className="text-xs font-medium text-gray-500 mb-2">Candidate Signature</p>
                  <img
                    src={offerData.candidate_signature}
                    alt="Signature"
                    className="max-h-16 border border-surface-200 rounded-lg p-2 bg-surface-50"
                  />
                </div>
              )}

              {offerPdfUrl && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl flex flex-col" style={{ height: '90vh' }}>
                    <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 flex-shrink-0">
                      <h3 className="font-display font-semibold text-gray-900">
                        {offerData.candidate_signature ? 'Signed Offer Letter' : 'Offer Letter'}
                      </h3>
                      <button
                        onClick={() => setOfferPdfUrl(null)}
                        className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <iframe
                      src={offerPdfUrl}
                      title="Offer Letter"
                      className="flex-1 w-full rounded-b-2xl"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Schedule Interview Dialog */}
      {showScheduleDialog && (
        <ScheduleInterviewDialog
          applicationId={id}
          defaultRoundNumber={
            (interviewsData?.items ?? []).reduce((max, iv) => Math.max(max, iv.round_number), 0) + 1
          }
          onClose={() => setShowScheduleDialog(false)}
          onSuccess={() => refetchInterviews()}
        />
      )}

      {/* Schedule Assessment Dialog */}
      {showScheduleAssessment && (
        <ScheduleAssessmentDialog
          applicationId={id}
          onClose={() => setShowScheduleAssessment(false)}
          onSuccess={() => refetchAssessments()}
        />
      )}

      {/* Reschedule Interview Dialog */}
      {showRescheduleFor && (
        <RescheduleInterviewDialog
          interview={showRescheduleFor}
          onClose={() => setShowRescheduleFor(null)}
          onSuccess={() => refetchInterviews()}
        />
      )}

      {/* Complete Interview Confirmation */}
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
                onClick={() => completeInterviewMutation.mutate(confirmCompleteId)}
                disabled={completeInterviewMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                {completeInterviewMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Yes, complete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Candidate Dialog */}
      {showRejectDialog && (
        <RejectDialog
          candidateName={app?.candidate_name ?? 'this candidate'}
          interviews={interviews}
          onConfirm={() => stageMutation.mutate({ stage: 'rejected' })}
          onCancel={() => setShowRejectDialog(false)}
          isPending={stageMutation.isPending}
        />
      )}
    </div>
  );
}
