import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDropzone } from 'react-dropzone';
import {
  UserPlus, X, FileText, Building2, ArrowRight, Check, CheckCheck, Loader2,
  CloudUpload, Sparkles, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { referralsApi } from '@/api/referrals';
import { formatEmploymentType } from '@/constants/jobOptions';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/utils';

// Descriptors matter more than the bare word here — "advanced" means very
// different things to different referrers, and the recruiter reading this
// needs a calibrated signal, not a guess.
const PROFICIENCY_OPTIONS = [
  { value: 'beginner', label: 'Beginner', hint: 'Learning the ropes' },
  { value: 'intermediate', label: 'Intermediate', hint: 'Solid, needs guidance' },
  { value: 'advanced', label: 'Advanced', hint: 'Ships independently' },
  { value: 'expert', label: 'Expert', hint: 'Sets the bar for others' },
];

const RELATIONSHIP_SUGGESTIONS = ['Ex-colleague', 'Current colleague', 'Friend', 'Classmate', 'Community / meetup', 'Family friend'];

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const NOTE_LIMIT = 1000;

const schema = z.object({
  candidate_name: z.string().trim().min(2, 'Please enter their full name'),
  candidate_email: z.string().trim().email('That doesn’t look like a valid email'),
  candidate_phone: z.string().optional(),
  relationship: z.string().trim().min(1, 'Tell us how you know them'),
  technical_proficiency: z.enum(['beginner', 'intermediate', 'advanced', 'expert'], {
    errorMap: () => ({ message: 'Pick the level that fits best' }),
  }),
  note: z.string().max(NOTE_LIMIT, `Keep it under ${NOTE_LIMIT} characters`).optional(),
});

// ── Form bits ─────────────────────────────────────────────────────────────────

function Field({ label, required, error, hint, children }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-xs font-semibold text-gray-700">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </span>
        {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
      </span>
      {children}
      {error && (
        <span className="flex items-center gap-1 text-[11px] text-rose-600 mt-1">
          <AlertCircle className="w-3 h-3 shrink-0" /> {error}
        </span>
      )}
    </label>
  );
}

const inputClass =
  'w-full border border-surface-300 rounded-lg px-3 py-2.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-400 transition-shadow';

function SectionTitle({ icon: Icon, children, step }) {
  return (
    <div className="flex items-center gap-2">
      {step != null ? (
        <span className="w-5 h-5 shrink-0 rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold inline-flex items-center justify-center">
          {step}
        </span>
      ) : (
        Icon && <Icon className="w-4 h-4 text-brand-500 shrink-0" />
      )}
      <h3 className="font-display text-sm font-semibold text-gray-900">{children}</h3>
    </div>
  );
}

function ResumeDropzone({ file, onFile, error }) {
  const onDrop = useCallback(
    (accepted, rejected) => {
      if (rejected?.length) {
        const reason = rejected[0]?.errors?.[0]?.code;
        toast.error(
          reason === 'file-too-large'
            ? 'That file is over 10 MB — please upload a smaller resume.'
            : 'Only PDF or Word documents are accepted.'
        );
        return;
      }
      if (accepted?.[0]) onFile(accepted[0]);
    },
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
    maxSize: MAX_RESUME_BYTES,
  });

  if (file) {
    return (
      <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
        <span className="w-9 h-9 shrink-0 rounded-lg bg-white text-emerald-600 flex items-center justify-center">
          <FileText className="w-4 h-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-emerald-900 truncate">{file.name}</span>
          <span className="block text-[11px] text-emerald-700">{(file.size / 1024).toFixed(0)} KB · ready to send</span>
        </span>
        <button
          type="button"
          onClick={() => onFile(null)}
          aria-label="Remove resume"
          className="shrink-0 w-7 h-7 rounded-lg text-emerald-600 hover:bg-white/70 flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        {...getRootProps()}
        className={cn(
          'flex flex-col items-center justify-center text-center px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors',
          isDragActive
            ? 'border-brand-400 bg-brand-50'
            : error
            ? 'border-rose-300 bg-rose-50/40 hover:border-rose-400'
            : 'border-surface-300 hover:border-brand-300 hover:bg-surface-50'
        )}
      >
        <input {...getInputProps()} />
        <CloudUpload className={cn('w-6 h-6 mb-2', isDragActive ? 'text-brand-500' : 'text-gray-400')} />
        <p className="text-sm font-medium text-gray-700">
          {isDragActive ? 'Drop it here' : 'Drop their resume, or click to browse'}
        </p>
        <p className="text-[11px] text-gray-400 mt-1">PDF or Word · up to 10 MB</p>
      </div>
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-rose-600 mt-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" /> A resume is required to submit a referral
        </p>
      )}
    </>
  );
}

// ── Referral modal ────────────────────────────────────────────────────────────

export default function ReferCandidateModal({ job, departmentName, onClose }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { technical_proficiency: undefined } });

  const [resumeFile, setResumeFile] = useState(null);
  const [resumeError, setResumeError] = useState(false);
  const [submitted, setSubmitted] = useState(null); // the candidate name, once sent
  const [serverError, setServerError] = useState(null);

  const proficiency = watch('technical_proficiency');
  const relationship = watch('relationship');
  const note = watch('note') ?? '';

  const mut = useMutation({
    mutationFn: (data) => referralsApi.create({ ...data, job_id: job.id, resume: resumeFile }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['my-referrals'] });
      queryClient.invalidateQueries({ queryKey: ['my-referrals-all'] });
      setSubmitted(vars.candidate_name);
    },
    onError: (err) => {
      const detail = err.response?.data?.detail;
      setServerError(typeof detail === 'string' ? detail : 'Something went wrong submitting this referral.');
    },
  });

  const onSubmit = (data) => {
    setServerError(null);
    if (!resumeFile) {
      setResumeError(true);
      return;
    }
    mut.mutate(data);
  };

  function referAnother() {
    reset();
    setResumeFile(null);
    setResumeError(false);
    setServerError(null);
    setSubmitted(null);
  }

  // ── Success ──
  if (submitted) {
    return (
      <Modal onClose={onClose} size="md">
        <div className="flex flex-col items-center text-center py-4">
          <span className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
            <CheckCheck className="w-7 h-7" />
          </span>
          <h2 className="font-display text-lg font-bold text-gray-900">Referral sent</h2>
          <p className="text-sm text-gray-500 mt-1.5 max-w-sm">
            <span className="font-medium text-gray-700">{submitted}</span> has been put forward for{' '}
            <span className="font-medium text-gray-700">{job.title}</span>.
          </p>

          <div className="w-full text-left bg-surface-50 border border-surface-200 rounded-xl p-4 mt-5 space-y-2.5">
            <p className="text-xs font-semibold text-gray-700">What happens next</p>
            {[
              'We email them an invitation to complete their application.',
              'Talent acquisition screens the profile against the role.',
              'You get an update at every stage — track it under My Referrals.',
            ].map((line, i) => (
              <p key={i} className="flex gap-2 text-xs text-gray-600">
                <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-px" />
                {line}
              </p>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full mt-5">
            <button
              onClick={referAnother}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-surface-300 rounded-xl hover:bg-surface-50 transition-colors"
            >
              Refer someone else
            </button>
            <button
              onClick={() => navigate('/employee/my-referrals')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-colors"
            >
              View my referrals <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Form ──
  return (
    <Modal
      onClose={onClose}
      title="Refer a candidate"
      description={job.title}
      icon={UserPlus}
      size="2xl"
      closeOnBackdrop={false}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-3">
          <p className="text-[11px] text-gray-400 sm:flex-1">
            They’ll get an email invitation — nothing is shared with them until you submit.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="refer-form"
              disabled={mut.isPending}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50 transition-colors"
            >
              {mut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <><UserPlus className="w-4 h-4" /> Submit referral</>}
            </button>
          </div>
        </div>
      }
    >
      {/* Role context — so you never lose track of which job you're referring into */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-brand-50/60 border border-brand-100 mb-5">
        <span className="w-9 h-9 shrink-0 rounded-lg bg-white text-brand-500 flex items-center justify-center">
          <Building2 className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{job.title}</p>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-gray-500 mt-0.5">
            {departmentName && <span>{departmentName}</span>}
            {job.location && <span>· {job.location}</span>}
            {job.location_type && <span className="capitalize">· {job.location_type}</span>}
            {job.employment_type && <span>· {formatEmploymentType(job.employment_type)}</span>}
          </div>
        </div>
      </div>

      <form id="refer-form" onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* 1 — who */}
        <section className="space-y-3.5">
          <SectionTitle step={1}>Who are you referring?</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Full name" required error={errors.candidate_name?.message}>
              <input {...register('candidate_name')} className={inputClass} placeholder="Jane Doe" autoFocus />
            </Field>
            <Field label="Email" required error={errors.candidate_email?.message}>
              <input {...register('candidate_email')} type="email" className={inputClass} placeholder="jane@example.com" />
            </Field>
            <Field label="Phone" hint="Optional" error={errors.candidate_phone?.message}>
              <input {...register('candidate_phone')} className={inputClass} placeholder="+91 98765 43210" />
            </Field>
            <Field label="How do you know them?" required error={errors.relationship?.message}>
              <input {...register('relationship')} className={inputClass} placeholder="Ex-colleague at…" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RELATIONSHIP_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setValue('relationship', s, { shouldValidate: true })}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                  relationship === s
                    ? 'bg-brand-500 border-brand-500 text-white'
                    : 'bg-white border-surface-200 text-gray-500 hover:border-brand-300 hover:text-brand-600'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        {/* 2 — how strong */}
        <section className="space-y-3">
          <SectionTitle step={2}>How would you rate them technically?</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {PROFICIENCY_OPTIONS.map(({ value, label, hint }) => {
              const active = proficiency === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setValue('technical_proficiency', value, { shouldValidate: true })}
                  aria-pressed={active}
                  className={cn(
                    'text-left px-3 py-2.5 rounded-xl border transition-all',
                    active
                      ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100'
                      : 'border-surface-200 bg-white hover:border-brand-300'
                  )}
                >
                  <span className={cn('block text-sm font-semibold', active ? 'text-brand-700' : 'text-gray-800')}>
                    {label}
                  </span>
                  <span className="block text-[11px] text-gray-400 mt-0.5 leading-tight">{hint}</span>
                </button>
              );
            })}
          </div>
          <input type="hidden" {...register('technical_proficiency')} />
          {errors.technical_proficiency && (
            <p className="flex items-center gap-1 text-[11px] text-rose-600">
              <AlertCircle className="w-3 h-3 shrink-0" /> {errors.technical_proficiency.message}
            </p>
          )}
        </section>

        {/* 3 — evidence */}
        <section className="space-y-3">
          <SectionTitle step={3}>Their resume</SectionTitle>
          <ResumeDropzone
            file={resumeFile}
            error={resumeError}
            onFile={(f) => { setResumeFile(f); if (f) setResumeError(false); }}
          />
        </section>

        {/* 4 — pitch */}
        <section className="space-y-3">
          <SectionTitle step={4}>Why them?</SectionTitle>
          <Field
            label="Your recommendation"
            hint={`${note.length}/${NOTE_LIMIT}`}
            error={errors.note?.message}
          >
            <textarea
              {...register('note')}
              rows={4}
              maxLength={NOTE_LIMIT}
              className={cn(inputClass, 'resize-none')}
              placeholder="What have you seen them do well? Anything the recruiter should know about timing, notice period or salary expectations?"
            />
          </Field>
          <div className="flex gap-2.5 text-xs text-gray-500 bg-surface-50 border border-surface-200 rounded-xl p-3">
            <Sparkles className="w-4 h-4 text-brand-400 shrink-0 mt-px" />
            <p>A concrete line or two about their actual work moves a referral through screening much faster than a general endorsement.</p>
          </div>
        </section>

        {serverError && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-px" />
            <p className="text-xs text-rose-700">{serverError}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
