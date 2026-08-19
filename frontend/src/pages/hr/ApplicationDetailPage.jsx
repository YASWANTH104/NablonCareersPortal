import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow, format, addDays } from 'date-fns';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Star, ExternalLink, FileText, Calendar, MessageSquare,
  Clock, User, Github, Linkedin, Globe, ChevronDown, Plus, Loader2,
  Video, Phone, MapPin, CheckCircle2, AlertCircle, Send, FolderOpen, Download, Eye, X,
  Pencil, Wallet, Briefcase, GraduationCap, AlertTriangle, Pause, PlayCircle, ArrowRightLeft,
  Paperclip,
} from 'lucide-react';
import { PendingAttachmentChip, NoteAttachmentGallery } from '@/components/shared/NoteAttachments';
import FilePreviewModal from '@/components/shared/FilePreviewModal';
import { applicationsApi } from '@/api/applications';
import { interviewsApi } from '@/api/interviews';
import { assessmentsApi } from '@/api/assessments';
import { jobsApi } from '@/api/jobs';
import { offersApi } from '@/api/offers';
import { usersApi } from '@/api/users';
import { documentsApi } from '@/api/documents';
import { screeningApi } from '@/api/screening';
import { interviewSlotsApi } from '@/api/interviewSlots';
import { ROUND_MAP } from '@/constants/interviewRounds';
import ResumeVersions, { resolveFileUrl } from '@/components/shared/ResumeVersions';
import { InlineFeedbackForm, InterviewFeedbackCard } from '@/components/interviews/feedback';
import { FREE_TEXT_MAX } from '@/constants/fieldLimits';
import ScheduleTimeGrid from '@/components/interviews/ScheduleTimeGrid';
import StageReasonDialog from '@/components/shared/StageReasonDialog';
import HoldReasonDialog from '@/components/shared/HoldReasonDialog';
import { useHoldToggle } from '@/hooks/useHoldToggle';
import { PIPELINE_STAGES, STAGE_MAP, VALID_TRANSITIONS, REASON_REQUIRED_STAGES, MOVE_JOB_ALLOWED_STAGES } from '@/constants/pipelineStages';
import { useAuthStore } from '@/store/authStore';
import { HR_ROLES } from '@/utils/permissions';

// ── Constants ─────────────────────────────────────────────────────────────────

const INTERVIEW_TYPES = ['video', 'phone', 'onsite', 'technical', 'hr', 'panel'];

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 120, label: '2 hr' },
];

// Full 24-hour window — interviews are also scheduled against US-timezone
// panelists/candidates, so the grid can't assume an India-hours-only workday.
const WORKDAY_START = '00:00';
const WORKDAY_END = '24:00';

const QUICK_DAYS = [
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'In 2 days', offset: 2 },
];

/** `yyyy-MM-dd` in the browser's timezone, for <input type="date">. */
const localDateValue = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function StepHeading({ step, title, required }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 rounded-full bg-surface-100 text-gray-600 text-[11px] font-bold flex items-center justify-center">
        {step}
      </span>
      <h4 className="text-sm font-semibold text-gray-900">
        {title}{required && <span className="text-red-500"> *</span>}
      </h4>
    </div>
  );
}

const AVAILABILITY_STYLES = {
  free:          { text: 'Available', className: 'bg-green-100 text-green-700' },
  tentative:     { text: 'Tentative', className: 'bg-yellow-100 text-yellow-700' },
  busy:          { text: 'Busy', className: 'bg-red-100 text-red-700' },
  busy_internal: { text: 'Double-booked', className: 'bg-red-100 text-red-700' },
  oof:           { text: 'Out of office', className: 'bg-gray-200 text-gray-600' },
  unknown:       { text: 'Unknown', className: 'bg-gray-100 text-gray-500' },
};

function AvailabilityChip({ status, label, loading }) {
  if (loading) {
    return <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 animate-pulse">Checking…</span>;
  }
  const style = AVAILABILITY_STYLES[status] ?? AVAILABILITY_STYLES.unknown;
  return (
    <span
      title={label}
      className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${style.className}`}
    >
      {style.text}
    </span>
  );
}


// ── Schedule Interview Dialog ─────────────────────────────────────────────────

// Meeting link only makes sense for a remote-style interview. Phone/onsite
// rounds have no link to share — forcing one made HR paste a fake URL, which
// then showed up as a bogus "Join meeting" button in the candidate/interviewer
// emails. Require whichever field actually matches the interview_type instead.
const isValidUrl = (v) => { try { new URL(v); return true; } catch { return false; } };

function refineMeetingDetails(values, ctx) {
  if (values.interview_type === 'phone') {
    if (!values.location?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['location'], message: 'Phone number is required' });
    }
  } else if (values.interview_type === 'onsite') {
    if (!values.location?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['location'], message: 'Location is required' });
    }
  } else if (!values.meeting_link?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meeting_link'], message: 'Meeting link is required' });
  } else if (!isValidUrl(values.meeting_link)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meeting_link'], message: 'Enter a valid URL' });
  }
}

const scheduleSchema = z.object({
  round_number: z.coerce.number().min(1),
  title: z.string().optional(),
  interview_type: z.string().min(1, 'Required'),
  scheduled_at: z.string().min(1, 'Required'),
  duration_mins: z.coerce.number(),
  meeting_link: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  use_teams_meeting: z.boolean().optional(),
}).superRefine((values, ctx) => {
  // Auto-create path skips the manual meeting_link requirement entirely —
  // the backend generates the Teams link once the interview is created.
  if (values.interview_type !== 'phone' && values.interview_type !== 'onsite' && values.use_teams_meeting) {
    return;
  }
  refineMeetingDetails(values, ctx);
});

// A slot's round_type (tr1/tr2/hr) is what book_slot() turns into the new
// interview's round_number — mirrors backend/app/services/interview_slot_service.py's
// ROUND_TO_NUMBER exactly, so filtering here lines up with what actually gets created.
const ROUND_TYPE_TO_NUMBER = { tr1: 1, tr2: 2, hr: 3 };

function PublishedSlotPicker({ jobId, applicationId, bookedRoundNumbers, onClose, onSuccess }) {
  const queryClient = useQueryClient();

  const { data: allSlots, isLoading } = useQuery({
    queryKey: ['interview-slots-for-job', jobId],
    queryFn: () => interviewSlotsApi.forJob(jobId).then((r) => r.data),
    enabled: !!jobId,
    // A slot open in this list can get booked from elsewhere (HR's
    // Availability page, or an agency) while this dialog sits open —
    // without polling, a just-taken slot would keep showing as bookable
    // here until the dialog is closed and reopened.
    refetchInterval: 20000,
  });

  // Once this candidate already has a scheduled (or completed/rescheduled —
  // anything but cancelled) interview for a round, that round's published
  // slots shouldn't keep showing up as bookable here: booking a second
  // interviewer's tr1 slot after tr1 is already locked in would just create
  // a duplicate round, not a real next step.
  const slots = (allSlots ?? []).filter((s) => !bookedRoundNumbers.has(ROUND_TYPE_TO_NUMBER[s.round_type]));

  const bookMutation = useMutation({
    mutationFn: (slotId) => interviewSlotsApi.book({ slot_id: slotId, application_id: applicationId }),
    onSuccess: () => {
      toast.success('Interview scheduled');
      // Booking here also affects HR's Availability page (the slot moves to
      // "booked" there too) — invalidate those caches so it's not stale if
      // that page happens to be open elsewhere.
      queryClient.invalidateQueries({ queryKey: ['interview-slots'] });
      queryClient.invalidateQueries({ queryKey: ['interview-slots-publishable'] });
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'This slot was just taken — please pick another'),
  });

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }

  if (!allSlots || allSlots.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-10">
        No interviewers have published availability for this job yet.
      </p>
    );
  }

  if (slots.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-10">
        Every round with published availability already has an interview scheduled for this candidate.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {slots.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 bg-surface-50 rounded-lg px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900">
              {format(new Date(s.start_time), 'EEE, MMM d · h:mm a')}
            </p>
            <p className="text-xs text-gray-500">
              {s.interviewer_name} · {ROUND_MAP[s.round_type]?.label ?? s.round_type} · {s.duration_mins} min
            </p>
          </div>
          <button
            onClick={() => bookMutation.mutate(s.id)}
            disabled={bookMutation.isPending}
            className="px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            Book
          </button>
        </div>
      ))}
    </div>
  );
}

function ScheduleInterviewDialog({ applicationId, jobId, defaultRoundNumber = 1, bookedRoundNumbers, onClose, onSuccess }) {
  const [mode, setMode] = useState('manual'); // 'manual' | 'published'
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
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { round_number: defaultRoundNumber, duration_mins: 60, interview_type: 'video', use_teams_meeting: true },
  });

  const interviewType = useWatch({ control, name: 'interview_type' });
  const useTeamsMeeting = useWatch({ control, name: 'use_teams_meeting' });
  const scheduledAtWatch = useWatch({ control, name: 'scheduled_at' });
  const durationWatch = useWatch({ control, name: 'duration_mins' });
  const needsPhone = interviewType === 'phone';
  const needsLocation = interviewType === 'onsite';

  // The day being browsed is held separately from the picked time so the
  // availability grid can load as soon as a date is chosen — HR shouldn't have
  // to guess a time before being shown which times are actually open.
  const [browseDate, setBrowseDate] = useState(() => localDateValue(new Date()));
  const [timeStr, setTimeStr] = useState('');

  const dayWindow = browseDate
    ? { start: new Date(`${browseDate}T${WORKDAY_START}:00`), end: new Date(`${browseDate}T${WORKDAY_END}:00`) }
    : null;

  // scheduled_at stays the single field the schema and API care about; the date
  // and time controls just compose it.
  useEffect(() => {
    setValue('scheduled_at', browseDate && timeStr ? `${browseDate}T${timeStr}` : '', {
      shouldValidate: !!(browseDate && timeStr),
    });
  }, [browseDate, timeStr, setValue]);

  // Live availability check — informational only, never blocks submission.
  // Debounced so it doesn't fire on every keystroke while HR is still picking a time.
  const [availability, setAvailability] = useState({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [daySchedule, setDaySchedule] = useState({});
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const debounceRef = useRef(null);

  const panelistKey = panelists.map((p) => p.id).join(',');

  // Whole-day busy blocks for the panel: keyed on the day and the panel only,
  // so changing the time doesn't refetch the same day's schedule.
  useEffect(() => {
    if (!panelistKey || !dayWindow) {
      setDaySchedule({});
      return undefined;
    }
    let cancelled = false;
    setLoadingSchedule(true);
    interviewsApi
      .panelistSchedule({
        panelist_ids: panelistKey.split(','),
        day_start: dayWindow.start.toISOString(),
        day_end: dayWindow.end.toISOString(),
      })
      .then((res) => {
        if (!cancelled) setDaySchedule(Object.fromEntries(res.data.map((s) => [s.user_id, s.busy_blocks])));
      })
      .catch(() => {
        // Silent — the grid is a picking aid, not a precondition for scheduling.
      })
      .finally(() => { if (!cancelled) setLoadingSchedule(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelistKey, browseDate]);

  // Per-panelist verdict for the exact slot — the authoritative chip.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (panelists.length === 0 || !scheduledAtWatch) {
      setAvailability({});
      setCheckingAvailability(false);
      return undefined;
    }
    setCheckingAvailability(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await interviewsApi.checkAvailability({
          panelist_ids: panelists.map((p) => p.id),
          scheduled_at: new Date(scheduledAtWatch).toISOString(),
          duration_mins: Number(durationWatch) || 60,
        });
        setAvailability(Object.fromEntries(res.data.map((a) => [a.user_id, a])));
      } catch {
        // Silent — availability is a courtesy, not required to schedule.
      } finally {
        setCheckingAvailability(false);
      }
    }, 600);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelists, scheduledAtWatch, durationWatch]);

  const pickSlot = (date) => {
    setBrowseDate(localDateValue(date));
    setTimeStr(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
  };

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
      meeting_link: (needsPhone || needsLocation || values.use_teams_meeting) ? undefined : (values.meeting_link || undefined),
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

  const selectedStart = scheduledAtWatch ? new Date(scheduledAtWatch) : null;
  const selectedEnd = selectedStart
    ? new Date(selectedStart.getTime() + (Number(durationWatch) || 60) * 60000)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-modal w-full max-w-3xl max-h-[92dvh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-surface-200 px-4 sm:px-6 py-4 z-10">
          <h3 className="font-display font-bold text-gray-900">Schedule Interview</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {mode === 'manual' ? 'Pick the panel, then a day, then an open slot.' : 'Book directly from an interviewer’s published availability.'}
          </p>
          {jobId && (
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setMode('manual')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${mode === 'manual' ? 'bg-brand-500 text-white' : 'bg-surface-100 text-gray-600 hover:bg-surface-200'}`}
              >
                Manually schedule
              </button>
              <button
                type="button"
                onClick={() => setMode('published')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${mode === 'published' ? 'bg-brand-500 text-white' : 'bg-surface-100 text-gray-600 hover:bg-surface-200'}`}
              >
                Book a published slot
              </button>
            </div>
          )}
        </div>

        {mode === 'published' ? (
          <div className="p-4 sm:p-6">
            <PublishedSlotPicker
              jobId={jobId}
              applicationId={applicationId}
              bookedRoundNumbers={bookedRoundNumbers}
              onClose={onClose}
              onSuccess={onSuccess}
            />
          </div>
        ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="p-4 sm:p-6 space-y-6">
          {/* ── 1. What ──────────────────────────────────────────── */}
          <section className="space-y-4">
            <StepHeading step={1} title="Round details" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          </section>

          {/* ── 2. Who ───────────────────────────────────────────── */}
          <section className="space-y-3">
            <StepHeading step={2} title="Interviewers" required />

            {panelists.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {panelists.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 bg-surface-50 border border-surface-200 rounded-lg pl-2 pr-1.5 py-1.5">
                    <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                      {p.full_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-800">{p.full_name}</span>
                    {scheduledAtWatch && (
                      <AvailabilityChip
                        status={availability[p.id]?.status}
                        label={availability[p.id]?.label}
                        loading={checkingAvailability && !availability[p.id]}
                      />
                    )}
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
                      aria-label={`Remove ${p.full_name}`}
                      className="text-gray-400 hover:text-red-500 px-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              <input
                type="text"
                value={panelistSearch}
                onChange={(e) => setPanelistSearch(e.target.value)}
                placeholder="Search by name to add interviewer…"
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {panelistSearch && filteredUsers.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-surface-200 rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
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
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-surface-200 rounded-lg shadow-lg z-20 px-3 py-2 text-sm text-gray-400">
                  No matching interviewers
                </div>
              )}
            </div>
            {panelistError && (
              <p className="text-xs text-red-500">At least one interviewer is required</p>
            )}
          </section>

          {/* ── 3. When ──────────────────────────────────────────── */}
          <section className="space-y-3">
            <StepHeading step={3} title="Date & time" required />

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={browseDate}
                  onChange={(e) => setBrowseDate(e.target.value)}
                  className="px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start time</label>
                <input
                  type="time"
                  value={timeStr}
                  step={900}
                  onChange={(e) => setTimeStr(e.target.value)}
                  className="px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                <select
                  {...register('duration_mins')}
                  className="px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                >
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1.5 pb-0.5">
                {QUICK_DAYS.map(({ label, offset }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setBrowseDate(localDateValue(addDays(new Date(), offset)))}
                    className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      browseDate === localDateValue(addDays(new Date(), offset))
                        ? 'bg-brand-50 border-brand-300 text-brand-700'
                        : 'bg-white border-surface-300 text-gray-600 hover:border-brand-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {dayWindow && (
              <ScheduleTimeGrid
                panelists={panelists}
                busyByPanelist={daySchedule}
                dayStart={dayWindow.start}
                dayEnd={dayWindow.end}
                durationMins={Number(durationWatch) || 60}
                selectedStart={selectedStart}
                onPick={pickSlot}
                loading={loadingSchedule}
              />
            )}

            {selectedStart ? (
              <p className="flex items-center gap-2 text-sm text-gray-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
                <Calendar className="w-4 h-4 text-brand-500 flex-shrink-0" />
                <span className="font-semibold">{format(selectedStart, 'EEEE, MMMM d')}</span>
                <span className="text-gray-500 tabular-nums">
                  {format(selectedStart, 'h:mm a')} – {format(selectedEnd, 'h:mm a')}
                </span>
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Pick a slot above, or set the start time directly.
              </p>
            )}
            {errors.scheduled_at && (
              <p className="text-xs text-red-500">{errors.scheduled_at.message}</p>
            )}
          </section>

          {/* ── 4. Where ─────────────────────────────────────────── */}
          <section className="space-y-3">
            <StepHeading step={4} title="Meeting details" />

            {needsPhone ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone number to call <span className="text-red-500">*</span>
                </label>
                <input
                  {...register('location')}
                  type="tel"
                  placeholder="+91 98765 43210"
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {errors.location && (
                  <p className="mt-1 text-xs text-red-500">{errors.location.message}</p>
                )}
              </div>
            ) : needsLocation ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location / address <span className="text-red-500">*</span>
                </label>
                <input
                  {...register('location')}
                  placeholder="Office address or meeting room"
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {errors.location && (
                  <p className="mt-1 text-xs text-red-500">{errors.location.message}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="flex items-start gap-2 text-sm font-medium text-gray-700">
                  <input
                    {...register('use_teams_meeting')}
                    type="checkbox"
                    className="mt-0.5 rounded border-surface-300 text-brand-500 focus:ring-brand-500"
                  />
                  <span>
                    Auto-create Microsoft Teams meeting
                    <span className="block text-xs font-normal text-gray-500 mt-0.5">
                      Blocks the interviewer's and candidate's calendars and emails both the Teams link automatically. Requires the Teams calendar integration to be set up — leave unchecked to paste a manual link instead.
                    </span>
                  </span>
                </label>
                {!useTeamsMeeting && (
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
                )}
              </div>
            )}

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
          </section>

          <div className="flex gap-3 pt-2 border-t border-surface-100">
            <button
              type="submit"
              disabled={isSubmitting || createMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 mt-4"
            >
              {(isSubmitting || createMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Schedule
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800 mt-4"
            >
              Cancel
            </button>
          </div>
        </form>
        )}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 sm:p-6 max-h-[90dvh] overflow-y-auto">
        <h3 className="font-display font-bold text-gray-900 mb-5">Schedule Assessment</h3>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
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
  interview_type: z.string(),
  meeting_link: z.string().optional(),
  location: z.string().optional(),
}).superRefine(refineMeetingDetails);

function RescheduleInterviewDialog({ interview, onClose, onSuccess }) {
  const existingDate = interview.scheduled_at
    ? new Date(interview.scheduled_at).toISOString().slice(0, 16)
    : '';
  const needsPhone = interview.interview_type === 'phone';
  const needsLocation = interview.interview_type === 'onsite';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(rescheduleSchema),
    defaultValues: {
      scheduled_at: existingDate,
      duration_mins: interview.duration_mins ?? 60,
      interview_type: interview.interview_type,
      meeting_link: interview.meeting_link ?? '',
      location: interview.location ?? '',
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data) =>
      interviewsApi.update(interview.id, {
        scheduled_at: new Date(data.scheduled_at).toISOString(),
        duration_mins: Number(data.duration_mins),
        meeting_link: data.meeting_link || undefined,
        location: data.location || undefined,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 sm:p-6 max-h-[90dvh] overflow-y-auto">
        <h3 className="font-display font-bold text-gray-900 mb-5">Reschedule Interview</h3>
        <form onSubmit={handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          {needsPhone ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone number to call <span className="text-red-500">*</span>
              </label>
              <input
                {...register('location')}
                type="tel"
                placeholder="+91 98765 43210"
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {errors.location && <p className="mt-1 text-xs text-red-500">{errors.location.message}</p>}
            </div>
          ) : needsLocation ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location / address <span className="text-red-500">*</span>
              </label>
              <input
                {...register('location')}
                placeholder="Office address or meeting room"
                className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {errors.location && <p className="mt-1 text-xs text-red-500">{errors.location.message}</p>}
            </div>
          ) : (
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
          )}
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

// ── Edit candidate details (HR — available at any stage) ─────────────────────
const DETAIL_INPUT =
  'w-full px-3 py-2 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent';

function EditCandidateDetailsModal({ app, onClose, onSuccess }) {
  const p = app.candidate_profile ?? {};
  const { register, handleSubmit, formState: { isSubmitting } } = useForm({
    defaultValues: {
      current_company: p.current_company ?? '',
      current_designation: p.current_designation ?? '',
      total_experience: p.total_experience ?? '',
      current_location: p.current_location ?? '',
      education: p.education ?? '',
      skills: p.skills ?? '',
      current_ctc: app.current_ctc ?? '',
      expected_ctc: app.expected_ctc ?? '',
      notice_period: app.notice_period ?? '',
      cover_letter: app.cover_letter ?? '',
      linkedin_url: app.linkedin_url ?? '',
      portfolio_url: app.portfolio_url ?? '',
      github_url: app.github_url ?? '',
    },
  });

  const mut = useMutation({
    mutationFn: (payload) => applicationsApi.update(app.id, payload),
    onSuccess: () => { toast.success('Candidate details updated'); onSuccess(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to update details'),
  });

  const onSubmit = (values) => {
    // Send empty strings too so HR can clear a field (backend skips only nulls).
    mut.mutate(values);
  };

  // CTC and notice period are varchar(255) on the applications table; the rest
  // of these route to CandidateProfile, which stores them as unbounded Text.
  const CAPPED_FIELDS = new Set(['current_ctc', 'expected_ctc', 'notice_period']);

  const Field = ({ name, label, placeholder, full }) => (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input
        {...register(name)}
        maxLength={CAPPED_FIELDS.has(name) ? FREE_TEXT_MAX : undefined}
        placeholder={placeholder}
        className={DETAIL_INPUT}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-6">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-surface-200">
          <h2 className="font-semibold text-gray-900">Edit candidate details</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-4 sm:p-6 space-y-4 max-h-[75dvh] overflow-y-auto">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field name="current_company" label="Current company" placeholder="Company (or 'Fresher')" />
            <Field name="current_designation" label="Current designation" placeholder="e.g. Senior Data Scientist" />
            <Field name="total_experience" label="Total experience" placeholder="e.g. 5 years" />
            <Field name="current_location" label="Current location" placeholder="Bengaluru, India" />
            <Field name="current_ctc" label="Current CTC" placeholder="e.g. 18 LPA" />
            <Field name="expected_ctc" label="Expected CTC" placeholder="e.g. 24 LPA" />
            <Field name="notice_period" label="Notice period" placeholder="e.g. 30 days" />
            <Field name="education" label="Education" placeholder="e.g. B.Tech, CSE" full />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Skills</label>
            <textarea {...register('skills')} rows={2} placeholder="Python, PyTorch, LLMs…" className={`${DETAIL_INPUT} resize-none`} />
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field name="linkedin_url" label="LinkedIn" placeholder="linkedin.com/in/…" />
            <Field name="portfolio_url" label="Portfolio" placeholder="yoursite.com" />
            <Field name="github_url" label="GitHub" placeholder="github.com/…" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Cover letter</label>
            <textarea {...register('cover_letter')} rows={4} className={`${DETAIL_INPUT} resize-y`} />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={isSubmitting || mut.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-60">
              {(isSubmitting || mut.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Move to another job (HR — early stages only) ──────────────────────────────

function MoveJobModal({ app, currentJobTitle, onClose, onSuccess }) {
  const [selectedJobId, setSelectedJobId] = useState('');

  const { data: jobsData, isLoading, isError } = useQuery({
    queryKey: ['hr-jobs-move-target'],
    queryFn: () => jobsApi.list({ status: 'published', limit: 100 }).then((r) => r.data),
  });

  const jobs = (jobsData?.items ?? []).filter((j) => j.id !== app.job_id);

  const mut = useMutation({
    mutationFn: () => applicationsApi.moveJob(app.id, selectedJobId),
    onSuccess: () => { toast.success('Candidate moved to the new job'); onSuccess(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to move candidate'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
          <h2 className="font-semibold text-gray-900">Move to another job</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-500">
            Currently applied for <strong>{currentJobTitle ?? 'this role'}</strong>. Their resume, notes and
            current stage carry over as-is to the job you pick below.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Target job</label>
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">
                {isLoading ? 'Loading jobs…' : isError ? 'Failed to load jobs' : jobs.length === 0 ? 'No other published jobs' : 'Select a job'}
              </option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>
            {isError && (
              <p className="text-xs text-red-500 mt-1">
                Couldn't load the job list. Please close this and try again.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-surface-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <button
            disabled={!selectedJobId || mut.isPending}
            onClick={() => mut.mutate()}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50"
          >
            {mut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Move candidate
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
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Interviewers land on this same page for full candidate context, but get a
  // read-only view — no scheduling, no offers/documents (HR/finance territory).
  // A job's assigned hiring manager also lands here (view-only, scoped to
  // their own jobs by the backend) — unlike interviewers, they never get
  // write access to notes/feedback either, so that's its own narrower flag
  // rather than reusing canManage.
  const { user } = useAuthStore();
  const canManage = HR_ROLES.includes(user?.role);
  const canWriteNotesAndFeedback = canManage || user?.role === 'interviewer';

  // ApplicantsPage passes its current URL (filters included) as location.state.from
  // when navigating here — falling back to a bare list only when arriving some
  // other way (e.g. a bookmarked/direct link to this application). Interviewers
  // don't have the /hr/applicants list route, so they fall back to their own
  // Interviews page instead; HR and a hiring-manager viewer both fall back to
  // the (scoped, for the latter) Applicants list.
  const backToApplicants = location.state?.from
    || (user?.role === 'interviewer' ? '/hr/interviews' : '/hr/applicants');

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') ?? 'overview');

  useEffect(() => {
    if (!canManage && ['documents', 'offer'].includes(activeTab)) {
      setActiveTab('overview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showScheduleAssessment, setShowScheduleAssessment] = useState(false);
  const [showRescheduleFor, setShowRescheduleFor] = useState(null);
  const [showFeedbackFor, setShowFeedbackFor] = useState(null);
  const [pendingReasonStage, setPendingReasonStage] = useState(null); // stage name awaiting a reason, or null
  const [editingDetails, setEditingDetails] = useState(false);
  const [showMoveJobModal, setShowMoveJobModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteFiles, setNoteFiles] = useState([]);
  const [noteDragActive, setNoteDragActive] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const noteFileInputRef = useRef(null);
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
    enabled: !!id && canManage,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: docsData, refetch: refetchDocs } = useQuery({
    queryKey: ['application-documents', id],
    queryFn: () => documentsApi.getByApplication(id).then((r) => r.data),
    enabled: !!id && canManage,
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

  const { data: screeningData } = useQuery({
    queryKey: ['application-screening', id],
    queryFn: () => screeningApi.getByApplication(id).then((r) => r.data),
    enabled: !!id && canManage,
    retry: false,
  });

  const { data: assessmentsData, refetch: refetchAssessments } = useQuery({
    queryKey: ['application-assessments', id],
    queryFn: () => assessmentsApi.list({ application_id: id }).then((r) => r.data),
    enabled: !!id,
  });

  const stageMutation = useMutation({
    mutationFn: ({ stage, notes, rejection_reason, drop_category }) =>
      applicationsApi.moveStage(id, stage, notes, rejection_reason, drop_category),
    onMutate: async ({ stage }) => {
      // Optimistic — the pill updates instantly instead of waiting on the round trip,
      // which is what made this feel laggy before (nothing changed until onSuccess).
      await queryClient.cancelQueries({ queryKey: ['application-detail', id], exact: true });
      const prev = queryClient.getQueryData(['application-detail', id]);
      queryClient.setQueryData(['application-detail', id], (old) =>
        old ? { ...old, stage } : old
      );
      return { prev };
    },
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
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['application-detail', id], ctx.prev);
      toast.error(err.response?.data?.detail ?? 'Cannot move to this stage');
    },
  });

  const starMutation = useMutation({
    mutationFn: () => applicationsApi.toggleStar(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['application-detail', id] }),
  });

  const { pendingHold, setPendingHold, holdMutation, toggleHold } = useHoldToggle(['application-detail', id]);

  const dismissDuplicateMutation = useMutation({
    mutationFn: () => applicationsApi.reviewDuplicate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application-detail', id] });
      toast.success('Marked as reviewed');
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to update'),
  });

  const MAX_NOTE_ATTACHMENTS = 5;

  const noteMutation = useMutation({
    mutationFn: ({ note, files }) => applicationsApi.addNote(id, note, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application-detail', id] });
      setNoteText('');
      setNoteFiles([]);
      toast.success('Note added');
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to add note'),
  });

  const addNoteFiles = (incoming) => {
    setNoteFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const deduped = Array.from(incoming).filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
      const combined = [...prev, ...deduped];
      if (combined.length > MAX_NOTE_ATTACHMENTS) {
        toast.error(`You can attach up to ${MAX_NOTE_ATTACHMENTS} files per note`);
        return combined.slice(0, MAX_NOTE_ATTACHMENTS);
      }
      return combined;
    });
  };

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
        <Link to={backToApplicants} className="text-brand-600 text-sm mt-2 block">← Back to applicants</Link>
      </div>
    );
  }

  const currentStage = STAGE_MAP[app.stage];
  const validNext = VALID_TRANSITIONS[app.stage] ?? [];
  // Latest-scheduled first — matches Notes/Timeline's recency-first ordering elsewhere on this page.
  const interviews = [...(interviewsData?.items ?? [])].sort(
    (a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at)
  );
  const assessments = Array.isArray(assessmentsData) ? assessmentsData : [];

  const stageHistory = (app.stage_history ?? []).filter((h) => h.to_stage !== '_note');
  const notes = (app.stage_history ?? []).filter((h) => h.to_stage === '_note');

  // "Last updated" — the most recent tracked activity of any kind (a stage
  // move or a note), stage moves and notes are both stored as
  // ApplicationStageHistory rows so a single most-recent-by-created_at pick
  // covers either. Falls back to null (no "by" shown) when the application
  // has never had one recorded yet — e.g. still sitting at "applied" with no
  // note added.
  const lastActivity = (app.stage_history ?? []).length
    ? [...app.stage_history].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;

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
    // Offers/documents are HR & finance territory — kept out of the interviewer's read-only view.
    ...(canManage ? [
      { key: 'documents', label: `Documents${docsData?.documents?.length ? ` (${docsData.documents.length})` : ''}${docsData?.status === 'complete' ? ' ✓' : ''}` },
      { key: 'offer', label: `Offer${offerData ? ' ●' : ''}` },
      ...(screeningData ? [{ key: 'screening', label: `Screening${screeningData.overall_score != null ? ` (${Math.round(screeningData.overall_score)})` : ''}` }] : []),
    ] : []),
  ];

  return (
    <div>
      {/* Back */}
      <Link
        to={backToApplicants}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5"
      >
        <ArrowLeft className="w-4 h-4" /> {user?.role === 'interviewer' ? 'Interviews' : 'All applicants'}
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-surface-200 p-4 sm:p-6 mb-6">
        <div className="flex flex-wrap items-start gap-4">
          {/* Avatar */}
          <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-xl font-bold text-brand-700">
            {(app.applicant?.full_name ?? '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-xl sm:text-2xl font-bold text-gray-900 break-words">
                {app.applicant?.full_name ?? 'Unknown'}
              </h1>
              {canManage && (
                <button
                  onClick={() => starMutation.mutate()}
                  className="text-gray-400 hover:text-yellow-400 transition-colors"
                >
                  <Star className={`w-5 h-5 ${app.is_starred ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                </button>
              )}
              {!canManage && app.is_starred && (
                <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{app.applicant?.email}</p>
            {jobData && (
              <p className="text-sm text-gray-600 mt-1 flex items-center gap-2 flex-wrap">
                <span>
                  Applied for{' '}
                  <Link to={`/jobs/${jobData.slug}`} className="text-brand-600 hover:underline" target="_blank">
                    {jobData.title}
                  </Link>
                </span>
                {canManage && MOVE_JOB_ALLOWED_STAGES.has(app.stage) && (
                  <button
                    onClick={() => setShowMoveJobModal(true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-brand-600 border border-surface-300 hover:border-brand-300 rounded-full px-2 py-0.5 transition-colors"
                  >
                    <ArrowRightLeft className="w-3 h-3" /> Move to another job
                  </button>
                )}
              </p>
            )}
          </div>

          {/* Stage control */}
          <div className="flex items-center gap-3 flex-shrink-0 w-full sm:w-auto flex-wrap">
            <div className="text-xs text-gray-400">
              <div>Applied {formatDistanceToNow(new Date(app.applied_at), { addSuffix: true })}</div>
              {lastActivity && (
                <div>
                  Last updated {formatDistanceToNow(new Date(lastActivity.created_at), { addSuffix: true })}
                  {lastActivity.changed_by_name && <> by {lastActivity.changed_by_name}</>}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => canManage && setStageMenuOpen((o) => !o)}
                disabled={!canManage || validNext.length === 0 || app.on_hold}
                title={app.on_hold ? 'Resume from hold to change stage' : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${
                  currentStage?.color ?? 'bg-gray-100 text-gray-700'
                } ${
                  canManage && validNext.length > 0 && !app.on_hold ? 'hover:opacity-80 cursor-pointer' : 'cursor-default opacity-60'
                }`}
              >
                {stageMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {currentStage?.label ?? app.stage}
                {canManage && validNext.length > 0 && !app.on_hold && <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {canManage && stageMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setStageMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-44 bg-white rounded-xl border border-surface-200 shadow-modal py-1">
                    <p className="px-3 pt-1 pb-1.5 text-xs text-gray-400 font-medium">Move to</p>
                    {validNext.map((stage) => {
                      const s = STAGE_MAP[stage];
                      const offerSigned =
                        offerData?.status === 'accepted' && !!offerData?.candidate_signature;
                      const blockedHired = stage === 'hired' && !offerSigned;
                      const disabled = blockedHired || stageMutation.isPending;
                      return (
                        <button
                          key={stage}
                          disabled={disabled}
                          title={blockedHired ? 'Candidate must accept and sign the offer letter first' : undefined}
                          onClick={() => {
                            if (disabled) return;
                            // Close immediately — waiting for the round trip to close this
                            // is what made stage changes feel unresponsive.
                            setStageMenuOpen(false);
                            if (REASON_REQUIRED_STAGES.has(stage)) {
                              setPendingReasonStage(stage);
                            } else {
                              stageMutation.mutate({ stage });
                            }
                          }}
                          className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left ${
                            disabled
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-gray-700 hover:bg-surface-50'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${s?.color.split(' ')[0] ?? 'bg-gray-200'} ${disabled ? 'opacity-30' : ''}`} />
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
            {canManage && (
              <button
                onClick={() => toggleHold(app)}
                className={`p-1.5 rounded-lg transition-colors ${
                  app.on_hold ? 'text-amber-500 hover:text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-gray-600 hover:bg-surface-100'
                }`}
                title={
                  app.on_hold
                    ? `On hold${app.hold_reason ? `: ${app.hold_reason}` : ''} — click to resume`
                    : 'Put on hold'
                }
              >
                <Pause className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Rating */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-gray-500">Rating:</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => canManage && applicationsApi.setRating(id, n).then(() => queryClient.invalidateQueries({ queryKey: ['application-detail', id] }))}
                disabled={!canManage}
                className={`p-0.5 ${!canManage ? 'cursor-default' : ''}`}
              >
                <Star className={`w-4 h-4 ${n <= (app.rating ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300 hover:text-yellow-300'}`} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* On-hold banner */}
      {app.on_hold && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
          <Pause className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">On hold</p>
            <p className="text-sm text-amber-700 mt-0.5">
              {app.hold_reason || 'No reason given.'} They'll stay in {currentStage?.label ?? app.stage} until resumed —
              stage changes are blocked while on hold.
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => toggleHold(app)}
              disabled={holdMutation.isPending}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 disabled:opacity-50"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              Resume
            </button>
          )}
        </div>
      )}

      {/* Possible-duplicate review banner */}
      {app.duplicate_flag && !app.duplicate_reviewed_at && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">Possible duplicate candidate</p>
            <p className="text-sm text-amber-700 mt-0.5">{app.duplicate_reason}</p>
          </div>
          {canManage && (
            <button
              onClick={() => dismissDuplicateMutation.mutate()}
              disabled={dismissDuplicateMutation.isPending}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 disabled:opacity-50"
            >
              Not a duplicate
            </button>
          )}
        </div>
      )}
      {app.duplicate_flag && app.duplicate_reviewed_at && (
        <p className="text-xs text-gray-400 mb-6">
          Possible-duplicate flag reviewed {formatDistanceToNow(new Date(app.duplicate_reviewed_at), { addSuffix: true })}.
        </p>
      )}

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
          {/* Candidate details (HR can edit at any stage) */}
          {(() => {
            const prof = app.candidate_profile ?? {};
            const rows = [
              { icon: Briefcase, label: 'Current company', value: prof.current_company },
              { icon: User, label: 'Current designation', value: prof.current_designation },
              { icon: Clock, label: 'Total experience', value: prof.total_experience },
              { icon: MapPin, label: 'Current location', value: prof.current_location },
              // Compensation is HR/finance territory — kept out of the interviewer's view.
              ...(canManage ? [
                { icon: Wallet, label: 'Current CTC', value: app.current_ctc },
                { icon: Wallet, label: 'Expected CTC', value: app.expected_ctc },
              ] : []),
              { icon: Clock, label: 'Notice period', value: app.notice_period },
              { icon: GraduationCap, label: 'Education', value: prof.education },
            ];
            return (
              <div className="bg-white rounded-xl border border-surface-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900">Candidate details</h3>
                  {canManage && (
                    <button
                      onClick={() => setEditingDetails(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 border border-brand-100 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {rows.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-start gap-2.5">
                      <Icon className="w-4 h-4 text-gray-300 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <dt className="text-gray-400 text-xs">{label}</dt>
                        <dd className={`mt-0.5 ${value ? 'text-gray-800' : 'text-gray-300'}`}>{value || 'Not provided'}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
                {prof.skills && (
                  <div className="mt-4 pt-4 border-t border-surface-100">
                    <p className="text-xs text-gray-400 mb-1">Skills</p>
                    <p className="text-sm text-gray-700">{prof.skills}</p>
                  </div>
                )}
              </div>
            );
          })()}

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
                <dd className="text-gray-700 mt-0.5">
                  {app.source === 'agency'
                    ? (app.agency_name || 'Agency')
                    : app.source === 'referral'
                    ? `Referral${app.referrer_name ? ` - ${app.referrer_name}` : ''}`
                    : <span className="capitalize">{app.source}</span>}
                </dd>
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
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-gray-400" /> Resume
          </h3>
          {/* Every revision stays reachable — selecting one previews it below,
              so a panel's feedback can be read against the version they saw. */}
          <ResumeVersions applicationId={id} canUpload={canManage} showHistory={canManage} />
        </div>
      )}

      {/* ── Interviews Tab ── */}
      {activeTab === 'interviews' && (
        <div className="space-y-4">
          {canManage && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowScheduleDialog(true)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors"
              >
                <Plus className="w-4 h-4" /> Schedule interview
              </button>
            </div>
          )}

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
                      {canManage && ['scheduled', 'rescheduled'].includes(interview.status) && (
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

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-gray-400" />
                      {format(new Date(interview.scheduled_at), 'PPp')}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      {interview.duration_mins} min
                    </div>
                    {interview.meeting_link && interview.status !== 'completed' ? (
                      <a
                        href={interview.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-brand-600 hover:text-brand-700 sm:col-span-2"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Join meeting
                      </a>
                    ) : interview.location ? (
                      <div className="flex items-center gap-1.5 sm:col-span-2">
                        {interview.interview_type === 'phone' ? (
                          <Phone className="w-3.5 h-3.5 text-gray-400" />
                        ) : (
                          <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        )}
                        {interview.location}
                      </div>
                    ) : null}
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
                        <InterviewFeedbackCard key={fb.id} fb={fb} />
                      ))}
                    </div>
                  )}

                  {/* Candidate self-assessment */}
                  {interview.candidate_self_feedback && (
                    <CandidateSelfAssessment sf={interview.candidate_self_feedback} />
                  )}

                  {/* Submit feedback button — interviewers are the ones who actually give feedback;
                      a view-only hiring-manager viewer never gets this (backend rejects it too). */}
                  {canWriteNotesAndFeedback && ['scheduled', 'rescheduled', 'completed'].includes(interview.status) && (
                    <div className="mt-3">
                      {showFeedbackFor === interview.id ? (
                        <InlineFeedbackForm
                          interviewId={interview.id}
                          onSuccess={() => {
                            setShowFeedbackFor(null);
                            refetchInterviews();
                          }}
                          onCancel={() => setShowFeedbackFor(null)}
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
          {canManage && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowScheduleAssessment(true)}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors"
              >
                <Plus className="w-4 h-4" /> Schedule assessment
              </button>
            </div>
          )}

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
                    {canManage && a.status === 'pending' && (
                      <button
                        onClick={() => cancelAssessmentMutation.mutate(a.id)}
                        className="text-xs text-gray-400 hover:text-red-500"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
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
                      className="flex items-center gap-1.5 text-brand-600 hover:text-brand-700 sm:col-span-2"
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
                    <InterviewFeedbackCard key={fb.id} fb={fb} />
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
                        {entry.changed_by_name && <> · by {entry.changed_by_name}</>}
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
          {/* Add note — HR and interviewers can both leave notes on a candidate;
              a view-only hiring-manager viewer sees the list below but not this form. */}
          {canWriteNotesAndFeedback && (
            <div
              className={`relative bg-white rounded-xl border p-4 transition-colors ${
                noteDragActive ? 'border-brand-400 ring-2 ring-brand-100' : 'border-surface-200'
              }`}
              onDragOver={(e) => { e.preventDefault(); setNoteDragActive(true); }}
              onDragLeave={() => setNoteDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setNoteDragActive(false);
                const dropped = Array.from(e.dataTransfer.files || []);
                if (dropped.length) addNoteFiles(dropped);
              }}
            >
              {noteDragActive && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-brand-50/90 border-2 border-dashed border-brand-300 pointer-events-none">
                  <p className="flex items-center gap-2 text-sm font-medium text-brand-600">
                    <Paperclip className="w-4 h-4" /> Drop to attach
                  </p>
                </div>
              )}

              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note about this candidate..."
                rows={3}
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />

              {noteFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-surface-100">
                  {noteFiles.map((file, i) => (
                    <PendingAttachmentChip
                      key={`${file.name}-${file.size}-${i}`}
                      file={file}
                      onRemove={() => setNoteFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mt-3">
                <button
                  type="button"
                  onClick={() => noteFileInputRef.current?.click()}
                  disabled={noteFiles.length >= MAX_NOTE_ATTACHMENTS}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-surface-200 rounded-lg hover:bg-surface-50 hover:border-surface-300 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  {noteFiles.length > 0
                    ? `${noteFiles.length}/${MAX_NOTE_ATTACHMENTS} attached`
                    : 'Attach files or images'}
                </button>
                <input
                  ref={noteFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    // Snapshot into a plain array before resetting .value — clearing the
                    // input synchronously invalidates the live FileList, and React 18
                    // batches the setState updater to run after this handler returns, so
                    // by the time it read e.target.files it would already be empty.
                    const selected = Array.from(e.target.files || []);
                    e.target.value = '';
                    if (selected.length) addNoteFiles(selected);
                  }}
                />
                <button
                  onClick={() => (noteText.trim() || noteFiles.length > 0) && noteMutation.mutate({ note: noteText.trim(), files: noteFiles })}
                  disabled={(!noteText.trim() && noteFiles.length === 0) || noteMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {noteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Add note
                </button>
              </div>
            </div>
          )}

          {/* Notes list */}
          {notes.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">No notes yet</div>
          ) : (
            <div className="space-y-3">
              {[...notes].reverse().map((note) => (
                <div key={note.id} className="bg-white rounded-xl border border-surface-200 p-4">
                  {note.notes && <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.notes}</p>}
                  <NoteAttachmentGallery attachments={note.attachments} onPreview={setPreviewAttachment} />
                  <p className="text-xs text-gray-400 mt-2">
                    {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                    {note.changed_by_name && <> · by {note.changed_by_name}</>}
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

      {/* ── Documents Tab (HR/admin only) ── */}
      {activeTab === 'documents' && canManage && (
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

      {/* ── Screening Tab (HR/admin only) ── */}
      {activeTab === 'screening' && canManage && screeningData && (
        <div className="space-y-4">
          {screeningData.status === 'pending' ? (
            <div className="bg-surface-50 rounded-xl border border-dashed border-surface-300 py-12 text-center">
              <Loader2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-600">Waiting on the candidate to submit the questionnaire</p>
            </div>
          ) : (
            <>
              {screeningData.auto_reject ? (
                <div className="flex items-start gap-3 p-4 rounded-xl border bg-red-50 border-red-200">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-800">Automatically rejected by the screening gate</p>
                    <p className="text-xs text-red-600 mt-1">{screeningData.auto_reject_reason}</p>
                  </div>
                </div>
              ) : (
                <div className={`flex items-center justify-between p-4 rounded-xl border ${
                  screeningData.recommendation === 'strong_fit' ? 'bg-green-50 border-green-200' :
                  screeningData.recommendation === 'moderate_fit' ? 'bg-amber-50 border-amber-200' :
                  'bg-red-50 border-red-200'
                }`}>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      Overall score: {Math.round(screeningData.overall_score)} / 100
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 capitalize">
                      {screeningData.recommendation?.replace('_', ' ')}
                      {!screeningData.is_ai_scored && ' · scored heuristically (Azure OpenAI not configured)'}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'College', score: screeningData.college_score, extra: screeningData.college_tier ? `Tier ${screeningData.college_tier}` : null },
                  { label: 'CGPA', score: screeningData.cgpa_score, extra: screeningData.cgpa != null ? screeningData.cgpa.toFixed(2) : null },
                  { label: 'Skills', score: screeningData.skills_score },
                  { label: 'Projects', score: screeningData.project_score },
                ].map((d) => (
                  <div key={d.label} className="bg-white rounded-xl border border-surface-200 p-3.5 text-center">
                    <p className="text-xs text-gray-400 mb-1">{d.label}</p>
                    <p className="text-lg font-bold text-gray-900">{d.score != null ? Math.round(d.score) : '—'}</p>
                    {d.extra && <p className="text-xs text-gray-400 mt-0.5">{d.extra}</p>}
                  </div>
                ))}
              </div>

              {screeningData.ai_reasoning && (
                <div className="bg-white rounded-xl border border-surface-200 p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">AI reasoning (internal only)</p>
                  {screeningData.ai_reasoning.college && (
                    <p className="text-sm text-gray-700"><strong>College:</strong> {screeningData.ai_reasoning.college}</p>
                  )}
                  {screeningData.ai_reasoning.skills && (
                    <p className="text-sm text-gray-700"><strong>Skills:</strong> {screeningData.ai_reasoning.skills}</p>
                  )}
                  {screeningData.ai_reasoning.projects && (
                    <p className="text-sm text-gray-700"><strong>Projects:</strong> {screeningData.ai_reasoning.projects}</p>
                  )}
                </div>
              )}

              <div className="bg-white rounded-xl border border-surface-200 p-4 space-y-3">
                <p className="text-sm"><strong className="text-gray-700">College:</strong> {screeningData.college_name}</p>
                {screeningData.relevant_experience && (
                  <p className="text-sm text-gray-700"><strong>Relevant experience:</strong> {screeningData.relevant_experience}</p>
                )}
                {screeningData.skills?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {screeningData.skills.map((s) => (
                      <span key={s} className="text-xs bg-brand-50 text-brand-700 border border-brand-100 px-2 py-0.5 rounded-md">{s}</span>
                    ))}
                  </div>
                )}
                {screeningData.github_profile_url && (
                  <a href={screeningData.github_profile_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-brand-600 hover:underline w-fit">
                    <Github className="w-3.5 h-3.5" /> GitHub profile
                  </a>
                )}
                {screeningData.achievements && (
                  <p className="text-sm text-gray-700"><strong>Achievements:</strong> {screeningData.achievements}</p>
                )}
              </div>

              {screeningData.projects?.length > 0 && (
                <div className="space-y-2">
                  {screeningData.projects.map((p, idx) => (
                    <div key={idx} className="bg-white rounded-xl border border-surface-200 p-4">
                      <p className="text-sm font-semibold text-gray-800">{p.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{p.description}</p>
                      <div className="flex items-center gap-3 mt-2">
                        {p.tech_stack && <span className="text-xs text-gray-400">{p.tech_stack}</span>}
                        {p.github_url && (
                          <a href={p.github_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-brand-600 hover:underline">
                            <Github className="w-3 h-3" /> Repo
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Offer Tab (HR/admin only) ── */}
      {activeTab === 'offer' && canManage && (
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
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-t border-surface-100 pt-5">
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
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl flex flex-col" style={{ height: '90dvh' }}>
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
          jobId={app?.job_id}
          defaultRoundNumber={
            (interviewsData?.items ?? []).reduce((max, iv) => Math.max(max, iv.round_number), 0) + 1
          }
          bookedRoundNumbers={
            new Set(
              (interviewsData?.items ?? [])
                .filter((iv) => iv.status !== 'cancelled')
                .map((iv) => iv.round_number)
            )
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

      {/* Edit candidate details (HR, any stage) */}
      {editingDetails && (
        <EditCandidateDetailsModal
          app={app}
          onClose={() => setEditingDetails(false)}
          onSuccess={() => {
            setEditingDetails(false);
            queryClient.invalidateQueries({ queryKey: ['application-detail', id] });
          }}
        />
      )}

      {/* Move to another job (HR, applied/screening only) */}
      {showMoveJobModal && (
        <MoveJobModal
          app={app}
          currentJobTitle={jobData?.title}
          onClose={() => setShowMoveJobModal(false)}
          onSuccess={() => {
            setShowMoveJobModal(false);
            queryClient.invalidateQueries({ queryKey: ['application-detail', id] });
            queryClient.invalidateQueries({ queryKey: ['hr-applications'] });
          }}
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

      {/* Stage reason dialog — rejected / interview_drop / offer_drop */}
      {pendingReasonStage && (
        <StageReasonDialog
          stage={pendingReasonStage}
          candidateName={app?.applicant?.full_name ?? 'this candidate'}
          interviews={interviews}
          onConfirm={({ category, note }) =>
            stageMutation.mutate({ stage: pendingReasonStage, rejection_reason: note, drop_category: category })
          }
          onCancel={() => setPendingReasonStage(null)}
          isPending={stageMutation.isPending}
        />
      )}

      {pendingHold && (
        <HoldReasonDialog
          candidateName={pendingHold.applicant?.full_name ?? 'this candidate'}
          isPending={holdMutation.isPending}
          onCancel={() => setPendingHold(null)}
          onConfirm={(reason) =>
            holdMutation.mutate({ id: pendingHold.id, on_hold: true, hold_reason: reason })
          }
        />
      )}

      {previewAttachment && (
        <FilePreviewModal
          url={resolveFileUrl(previewAttachment.url)}
          name={previewAttachment.name}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </div>
  );
}
