import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { RefreshCw, Loader2 } from 'lucide-react';
import { interviewsApi } from '@/api/interviews';

const DURATION_OPTIONS = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 90, label: '90 min' },
  { value: 120, label: '2 hr' },
];

// Meeting link only applies to remote-style rounds — phone/onsite have no
// link to share, so require whichever field matches the interview's type
// instead of always demanding a URL (see ApplicationDetailPage's identical fix).
const isValidUrl = (v) => { try { new URL(v); return true; } catch { return false; } };

const rescheduleSchema = z.object({
  scheduled_at: z.string().min(1, 'Required'),
  duration_mins: z.coerce.number(),
  interview_type: z.string(),
  meeting_link: z.string().optional(),
  location: z.string().optional(),
}).superRefine((values, ctx) => {
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
});

export default function RescheduleDialog({ interview, onClose, onSuccess }) {
  const existingDate = interview.scheduled_at
    ? new Date(interview.scheduled_at).toISOString().slice(0, 16)
    : '';
  const needsPhone = interview.interview_type === 'phone';
  const needsLocation = interview.interview_type === 'onsite';

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(rescheduleSchema),
    defaultValues: {
      scheduled_at: existingDate,
      duration_mins: interview.duration_mins ?? 60,
      interview_type: interview.interview_type,
      meeting_link: interview.meeting_link ?? '',
      location: interview.location ?? '',
    },
  });

  const updateMut = useMutation({
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-modal w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-2 mb-1">
          <RefreshCw className="w-4 h-4 text-brand-500" />
          <h3 className="font-display font-bold text-gray-900">Reschedule Interview</h3>
        </div>
        <p className="text-xs text-gray-500 mb-5 pl-6">
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
