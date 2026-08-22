import { useState, useEffect, forwardRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, Plus, X, Wand2, FileText, Upload, ExternalLink, Sparkles } from 'lucide-react';
import { jobsApi } from '@/api/jobs';
import { usersApi } from '@/api/users';
import RichTextEditor from '@/components/shared/RichTextEditor';
import DraftWithAiModal from '@/components/shared/DraftWithAiModal';
import ImportJdPdfModal from '@/components/shared/ImportJdPdfModal';
import { LOCATION_TYPES, EMPLOYMENT_TYPES } from '@/constants/jobOptions';

const toOptionalInt = (v) => (v === '' || v === null || v === undefined ? undefined : parseInt(v, 10));
const toOptionalNum = (v) => (v === '' || v === null || v === undefined ? undefined : parseFloat(v));

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  department_id: z.string().optional(),
  location: z.string().optional(),
  location_type: z.string().optional(),
  employment_type: z.string().optional(),
  experience_min: z.preprocess(toOptionalInt, z.number().int().min(0).optional()),
  experience_max: z.preprocess(toOptionalInt, z.number().int().min(0).optional()),
  salary_min: z.preprocess(toOptionalNum, z.number().min(0).optional()),
  salary_max: z.preprocess(toOptionalNum, z.number().min(0).optional()),
  salary_currency: z.string().default('INR'),
  show_salary: z.boolean().default(false),
  description: z.string().min(1, 'Description is required'),
  requirements: z.string().optional(),
  benefits: z.string().optional(),
  openings: z.preprocess((v) => (v === '' ? 1 : parseInt(String(v), 10)), z.number().int().min(1, 'At least 1 opening required')),
  is_internal: z.boolean().default(false),
  allow_referrals: z.boolean().default(true),
  allow_outsiders: z.boolean().default(true),
  criticality: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  screening_enabled: z.boolean().default(false),
  closes_at: z.string().optional(),
  hiring_manager_id: z.string().optional(),
});

const CRITICALITY_LEVELS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];


function FieldLabel({ children, required }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

const Input = forwardRef(({ className = '', ...props }, ref) => (
  <input
    ref={ref}
    className={`w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent ${className}`}
    {...props}
  />
));

const Select = forwardRef(({ children, className = '', ...props }, ref) => (
  <select
    ref={ref}
    className={`w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white ${className}`}
    {...props}
  >
    {children}
  </select>
));

function ErrorMsg({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-500">{message}</p>;
}

export default function JobEditPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState([]);
  const [jdPdf, setJdPdf] = useState(null); // { url, name }
  const [showJdPdfModal, setShowJdPdfModal] = useState(false);

  const { data: existing, isLoading: loadingJob } = useQuery({
    queryKey: ['job-edit', id],
    queryFn: () => jobsApi.getById(id).then((r) => r.data),
    enabled: isEdit,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
  });

  const { data: internalUsers = [] } = useQuery({
    queryKey: ['internal-users'],
    queryFn: () => usersApi.internalUsers().then((r) => r.data),
  });

  const [showAiModal, setShowAiModal] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    control,
    getValues,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      department_id: '',
      location: '',
      location_type: '',
      employment_type: '',
      experience_min: '',
      experience_max: '',
      salary_min: '',
      salary_max: '',
      salary_currency: 'INR',
      show_salary: false,
      description: '',
      requirements: '',
      benefits: '',
      openings: 1,
      is_internal: false,
      allow_referrals: true,
      allow_outsiders: true,
      criticality: 'medium',
      screening_enabled: false,
      closes_at: '',
      hiring_manager_id: '',
    },
  });

  const watchIsInternal = watch('is_internal');
  const watchAllowReferrals = watch('allow_referrals');
  const watchAllowOutsiders = watch('allow_outsiders');

  useEffect(() => {
    if (existing) {
      const closesAt = existing.closes_at
        ? new Date(existing.closes_at).toISOString().slice(0, 10)
        : '';
      reset({
        title: existing.title ?? '',
        department_id: existing.department_id ?? '',
        location: existing.location ?? '',
        location_type: existing.location_type ?? '',
        employment_type: existing.employment_type ?? '',
        experience_min: existing.experience_min ?? '',
        experience_max: existing.experience_max ?? '',
        salary_min: existing.salary_min ?? '',
        salary_max: existing.salary_max ?? '',
        salary_currency: existing.salary_currency ?? 'INR',
        show_salary: existing.show_salary ?? false,
        description: existing.description ?? '',
        requirements: existing.requirements ?? '',
        benefits: existing.benefits ?? '',
        openings: existing.openings ?? 1,
        is_internal: existing.is_internal ?? false,
        allow_referrals: existing.allow_referrals ?? true,
        allow_outsiders: existing.allow_outsiders ?? true,
        criticality: existing.criticality ?? 'medium',
        screening_enabled: existing.screening_enabled ?? false,
        closes_at: closesAt,
        hiring_manager_id: existing.hiring_manager_id ?? '',
      });
      setSkills(existing.skills_required ?? []);
      setJdPdf(existing.jd_pdf_url ? { url: existing.jd_pdf_url, name: existing.jd_pdf_name || 'Job description.pdf' } : null);
    }
  }, [existing, reset]);

  const createMutation = useMutation({
    mutationFn: (data) => jobsApi.create(data),
    onSuccess: (res) => {
      toast.success('Job created as draft');
      queryClient.invalidateQueries({ queryKey: ['hr-jobs'] });
      navigate(`/hr/jobs/${res.data.id}/edit`);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to create job'),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => jobsApi.update(id, data),
    onSuccess: () => {
      toast.success('Job saved');
      queryClient.invalidateQueries({ queryKey: ['hr-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['job-edit', id] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to save job'),
  });

  const statusMutation = useMutation({
    mutationFn: (status) => jobsApi.updateStatus(id, status),
    onSuccess: (res) => {
      toast.success(`Job ${res.data.status}`);
      queryClient.invalidateQueries({ queryKey: ['hr-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['job-edit', id] });
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Status change failed'),
  });

  const addSkill = () => {
    const s = skillInput.trim();
    if (s && !skills.includes(s)) {
      setSkills([...skills, s]);
    }
    setSkillInput('');
  };

  const removeSkill = (s) => setSkills(skills.filter((x) => x !== s));

  const buildPayload = (values) => ({
    ...values,
    department_id: values.department_id || null,
    hiring_manager_id: values.hiring_manager_id || null,
    experience_min: values.experience_min ?? null,
    experience_max: values.experience_max ?? null,
    salary_min: values.salary_min ?? null,
    salary_max: values.salary_max ?? null,
    skills_required: skills.length > 0 ? skills : null,
    jd_pdf_url: jdPdf?.url ?? null,
    jd_pdf_name: jdPdf?.name ?? null,
    closes_at: values.closes_at || null,
    location_type: values.location_type || null,
    employment_type: values.employment_type || null,
  });

  const onSubmit = async (values) => {
    const payload = buildPayload(values);
    if (isEdit) {
      await updateMutation.mutateAsync(payload);
    } else {
      await createMutation.mutateAsync(payload);
    }
  };

  if (isEdit && loadingJob) {
    return (
      <div className="max-w-3xl animate-pulse">
        <div className="h-6 bg-surface-100 rounded w-48 mb-6" />
        <div className="space-y-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 bg-surface-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/hr/jobs')}
          className="p-2 rounded-lg text-gray-400 hover:bg-surface-100 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-gray-900">
            {isEdit ? 'Edit job' : 'New job posting'}
          </h1>
          {isEdit && existing && (
            <span className={`text-xs px-2 py-0.5 rounded-full capitalize mt-0.5 inline-block ${
              existing.status === 'published' ? 'bg-green-100 text-green-700' :
              existing.status === 'draft' ? 'bg-gray-100 text-gray-600' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {existing.status}
            </span>
          )}
        </div>
        {isEdit && existing && (
          <div className="w-full sm:w-auto sm:ml-auto flex gap-2 flex-wrap">
            {existing.status === 'draft' && (
              <button
                onClick={() => statusMutation.mutate('published')}
                disabled={statusMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                Publish
              </button>
            )}
            {existing.status === 'published' && (
              <button
                onClick={() => statusMutation.mutate('paused')}
                disabled={statusMutation.isPending}
                className="px-4 py-2 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 disabled:opacity-60 transition-colors"
              >
                Pause
              </button>
            )}
            {existing.status === 'paused' && (
              <button
                onClick={() => statusMutation.mutate('published')}
                disabled={statusMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                Resume
              </button>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Basic info */}
        <section className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 space-y-5">
          <h2 className="font-display font-semibold text-gray-900 text-base">Basic info</h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Job title</FieldLabel>
              <Input {...register('title')} placeholder="e.g. Senior ML Engineer" />
              <ErrorMsg message={errors.title?.message} />
            </div>
            <div>
              <FieldLabel>Department</FieldLabel>
              <Select {...register('department_id')}>
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Hiring manager</FieldLabel>
              <Select {...register('hiring_manager_id')}>
                <option value="">Unassigned</option>
                {internalUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({u.role.replace('_', ' ')})
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-gray-400">The engineering/hiring manager who owns this req.</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Location</FieldLabel>
              <Input {...register('location')} placeholder="e.g. Bangalore, India" />
            </div>
            <div>
              <FieldLabel>Work mode</FieldLabel>
              <Select {...register('location_type')}>
                <option value="">Select...</option>
                {LOCATION_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>Employment type</FieldLabel>
              <Select {...register('employment_type')}>
                <option value="">Select...</option>
                {EMPLOYMENT_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>Min experience (yrs)</FieldLabel>
              <Input {...register('experience_min')} type="number" min="0" placeholder="0" />
            </div>
            <div>
              <FieldLabel>Max experience (yrs)</FieldLabel>
              <Input {...register('experience_max')} type="number" min="0" placeholder="10" />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Openings</FieldLabel>
              <Input {...register('openings')} type="number" min="1" placeholder="1" />
              <ErrorMsg message={errors.openings?.message} />
            </div>
            <div>
              <FieldLabel>Close date</FieldLabel>
              <Input {...register('closes_at')} type="date" />
            </div>
          </div>

          <div>
            <FieldLabel>Role criticality</FieldLabel>
            <Select {...register('criticality')} className="max-w-xs">
              {CRITICALITY_LEVELS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-gray-400">Shown on job cards to the whole internal team.</p>
          </div>

          <div className="pt-2 border-t border-surface-100">
            <FieldLabel>Who can apply</FieldLabel>
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input {...register('is_internal')} type="checkbox" className="rounded border-surface-300 text-brand-500 focus:ring-brand-500" />
              <span className="text-sm text-gray-700">Internal team only (hidden from the public job board and referrals)</span>
            </label>

            {!watchIsInternal && (
              <div className="ml-6 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...register('allow_referrals')} type="checkbox" className="rounded border-surface-300 text-brand-500 focus:ring-brand-500" />
                  <span className="text-sm text-gray-700">Open to employee referrals</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...register('allow_outsiders')} type="checkbox" className="rounded border-surface-300 text-brand-500 focus:ring-brand-500" />
                  <span className="text-sm text-gray-700">Open to outside / direct applicants</span>
                </label>

                {!watchAllowReferrals && !watchAllowOutsiders && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    Neither is on, so this job has no way for anyone to apply. Turn one back on, or mark it internal team only above.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Compensation */}
        <section className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 space-y-5">
          <h2 className="font-display font-semibold text-gray-900 text-base">Compensation</h2>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel>Currency</FieldLabel>
              <Select {...register('salary_currency')}>
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </Select>
            </div>
            <div>
              <FieldLabel>Min salary</FieldLabel>
              <Input {...register('salary_min')} type="number" min="0" placeholder="500000" />
            </div>
            <div>
              <FieldLabel>Max salary</FieldLabel>
              <Input {...register('salary_max')} type="number" min="0" placeholder="1500000" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input {...register('show_salary')} type="checkbox" className="rounded border-surface-300 text-brand-500 focus:ring-brand-500" />
            <span className="text-sm text-gray-700">Show salary range publicly</span>
          </label>
        </section>

        {/* AI Screening */}
        <section className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4.5 h-4.5 text-brand-600" />
            </div>
            <div className="flex-1">
              <h2 className="font-display font-semibold text-gray-900 text-base">AI screening questionnaire</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Right after a candidate applies, automatically email them a questionnaire (college, CGPA,
                relevant experience, projects with GitHub links, skills, achievements). Their score then
                decides the outcome — advance to <strong>Screening</strong>, or an automatic rejection.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer pl-12">
            <input {...register('screening_enabled')} type="checkbox" className="rounded border-surface-300 text-brand-500 focus:ring-brand-500" />
            <span className="text-sm text-gray-700">Enable screening questionnaire for this job</span>
          </label>

          {watch('screening_enabled') && (
            <div className="ml-12 bg-amber-50 border border-amber-100 rounded-lg px-3.5 py-3 text-xs text-amber-800 leading-relaxed">
              <p className="font-semibold mb-1">Scoring rules (applied automatically):</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>College Tier 1/2 scores highest, Tier 3 scores lower — <strong>Tier 4/5 is an automatic rejection</strong>.</li>
                <li>CGPA <strong>below 7.5 is an automatic rejection</strong>; 7.5–10.0 scales the CGPA score.</li>
                <li>Skills and projects are weighted toward Python / ML / AI relevance, with extra credit for
                  well-explained projects backed by a real GitHub link.</li>
                <li>Passing both gates automatically moves the candidate to <strong>Screening</strong> with their
                  score attached, ready for you to review; failing either gate automatically rejects them with
                  a courteous email — you can still act manually before or after either happens.</li>
                <li>Referral-sourced applications are never sent the questionnaire — this only applies to
                  direct / agency / talent-acquisition-sourced candidates.</li>
                <li>The questionnaire link expires <strong>48 hours</strong> after being sent.</li>
              </ul>
            </div>
          )}
        </section>

        {/* JD document */}
        <section className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-gray-900 text-base">Job description document</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload a designed JD (PDF/Word). It's shown on the job page for download, and its content fills in the fields below.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowJdPdfModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-100 rounded-lg hover:bg-brand-100 transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              {jdPdf ? 'Replace PDF' : 'Import from PDF'}
            </button>
          </div>

          {jdPdf && (
            <div className="flex items-center gap-3 bg-surface-50 border border-surface-200 rounded-lg px-4 py-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4.5 h-4.5 text-red-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{jdPdf.name}</p>
                <a
                  href={jdPdf.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
                >
                  View document <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <button
                type="button"
                onClick={() => setJdPdf(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-surface-200 hover:text-gray-600"
                title="Remove attached document"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </section>

        {/* Content */}
        <section className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display font-semibold text-gray-900 text-base">Job content</h2>
            <button
              type="button"
              onClick={() => setShowAiModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-100 rounded-lg hover:bg-brand-100 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Draft with AI
            </button>
          </div>

          <div>
            <FieldLabel required>Description</FieldLabel>
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <RichTextEditor
                  value={field.value}
                  onChange={field.onChange}
                  minHeight={200}
                  placeholder="Describe the role, team, and what the candidate will be working on..."
                />
              )}
            />
            <ErrorMsg message={errors.description?.message} />
          </div>

          <div>
            <FieldLabel>Requirements</FieldLabel>
            <Controller
              name="requirements"
              control={control}
              render={({ field }) => (
                <RichTextEditor
                  value={field.value}
                  onChange={field.onChange}
                  minHeight={140}
                  placeholder="List the must-have qualifications and skills..."
                />
              )}
            />
          </div>

          <div>
            <FieldLabel>Benefits & perks</FieldLabel>
            <Controller
              name="benefits"
              control={control}
              render={({ field }) => (
                <RichTextEditor
                  value={field.value}
                  onChange={field.onChange}
                  minHeight={120}
                  placeholder="Health insurance, equity, remote work policy..."
                />
              )}
            />
          </div>
        </section>

        {/* Skills */}
        <section className="bg-white rounded-xl border border-surface-200 p-4 sm:p-6 space-y-4">
          <h2 className="font-display font-semibold text-gray-900 text-base">Skills required</h2>

          <div className="flex gap-2">
            <Input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
              placeholder="Add a skill (e.g. Python, React)..."
              className="flex-1"
            />
            <button
              type="button"
              onClick={addSkill}
              className="px-3 py-2 bg-surface-100 text-gray-700 rounded-lg text-sm hover:bg-surface-200 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {skills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="flex items-center gap-1.5 text-sm bg-brand-50 text-brand-700 border border-brand-100 px-3 py-1 rounded-lg"
                >
                  {skill}
                  <button type="button" onClick={() => removeSkill(skill)}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Actions */}
        <div className="flex items-center gap-3 pb-8">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create draft'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/hr/jobs')}
            className="px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>

      {showAiModal && (
        <DraftWithAiModal
          context={{
            title: getValues('title'),
            department: departments.find((d) => d.id === getValues('department_id'))?.name,
            location: getValues('location'),
            location_type: getValues('location_type'),
            employment_type: getValues('employment_type'),
            experience_min: toOptionalInt(getValues('experience_min')),
            experience_max: toOptionalInt(getValues('experience_max')),
          }}
          onApply={(draft) => {
            setValue('description', draft.description, { shouldDirty: true, shouldValidate: true });
            setValue('requirements', draft.requirements, { shouldDirty: true });
            setValue('benefits', draft.benefits, { shouldDirty: true });
            setSkills((prev) => Array.from(new Set([...prev, ...draft.skills_required])));
            toast.success('Draft applied — review and edit before saving');
          }}
          onClose={() => setShowAiModal(false)}
        />
      )}

      {showJdPdfModal && (
        <ImportJdPdfModal
          onApplied={(r) => {
            if (r.description) setValue('description', r.description, { shouldDirty: true, shouldValidate: true });
            if (r.requirements) setValue('requirements', r.requirements, { shouldDirty: true });
            if (r.benefits) setValue('benefits', r.benefits, { shouldDirty: true });
            if (r.skills_required?.length) {
              setSkills((prev) => Array.from(new Set([...prev, ...r.skills_required])));
            }
            // Fill basic fields only when empty — never clobber what HR already typed.
            if (r.title && !getValues('title')) setValue('title', r.title, { shouldDirty: true, shouldValidate: true });
            if (r.location && !getValues('location')) setValue('location', r.location, { shouldDirty: true });
            if (r.employment_type && !getValues('employment_type')) setValue('employment_type', r.employment_type, { shouldDirty: true });
            if (r.experience_min != null && !getValues('experience_min')) setValue('experience_min', r.experience_min, { shouldDirty: true });
            if (r.experience_max != null && !getValues('experience_max')) setValue('experience_max', r.experience_max, { shouldDirty: true });
            setJdPdf({ url: r.jd_pdf_url, name: r.jd_pdf_name });
            toast.success('JD attached & fields filled — review, then save');
          }}
          onClose={() => setShowJdPdfModal(false)}
        />
      )}
    </div>
  );
}
