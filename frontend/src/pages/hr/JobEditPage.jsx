import { useState, useEffect, forwardRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, Plus, X } from 'lucide-react';
import { jobsApi } from '@/api/jobs';

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
  closes_at: z.string().optional(),
});

const LOCATION_TYPES = ['remote', 'onsite', 'hybrid'];
const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
  { value: 'freelance', label: 'Freelance' },
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

const Textarea = forwardRef(({ className = '', ...props }, ref) => (
  <textarea
    ref={ref}
    className={`w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-y ${className}`}
    {...props}
  />
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

  const { data: existing, isLoading: loadingJob } = useQuery({
    queryKey: ['job-edit', id],
    queryFn: () => jobsApi.getById(id).then((r) => r.data),
    enabled: isEdit,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => jobsApi.listDepartments().then((r) => r.data),
  });

  const {
    register,
    handleSubmit,
    reset,
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
      closes_at: '',
    },
  });

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
        closes_at: closesAt,
      });
      setSkills(existing.skills_required ?? []);
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
    experience_min: values.experience_min ?? null,
    experience_max: values.experience_max ?? null,
    salary_min: values.salary_min ?? null,
    salary_max: values.salary_max ?? null,
    skills_required: skills.length > 0 ? skills : null,
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
      <div className="flex items-center gap-3 mb-6">
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
          <div className="ml-auto flex gap-2">
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
        <section className="bg-white rounded-xl border border-surface-200 p-6 space-y-5">
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
              <FieldLabel>Location</FieldLabel>
              <Input {...register('location')} placeholder="e.g. Bangalore, India" />
            </div>
            <div>
              <FieldLabel>Work mode</FieldLabel>
              <Select {...register('location_type')}>
                <option value="">Select...</option>
                {LOCATION_TYPES.map((v) => (
                  <option key={v} value={v} className="capitalize">{v.charAt(0).toUpperCase() + v.slice(1)}</option>
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

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input {...register('is_internal')} type="checkbox" className="rounded border-surface-300 text-brand-500 focus:ring-brand-500" />
              <span className="text-sm text-gray-700">Internal / employee-only job</span>
            </label>
          </div>
        </section>

        {/* Compensation */}
        <section className="bg-white rounded-xl border border-surface-200 p-6 space-y-5">
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

        {/* Content */}
        <section className="bg-white rounded-xl border border-surface-200 p-6 space-y-5">
          <h2 className="font-display font-semibold text-gray-900 text-base">Job content</h2>

          <div>
            <FieldLabel required>Description</FieldLabel>
            <Textarea {...register('description')} rows={8} placeholder="Describe the role, team, and what the candidate will be working on..." />
            <ErrorMsg message={errors.description?.message} />
          </div>

          <div>
            <FieldLabel>Requirements</FieldLabel>
            <Textarea {...register('requirements')} rows={5} placeholder="List the must-have qualifications and skills..." />
          </div>

          <div>
            <FieldLabel>Benefits & perks</FieldLabel>
            <Textarea {...register('benefits')} rows={4} placeholder="Health insurance, equity, remote work policy..." />
          </div>
        </section>

        {/* Skills */}
        <section className="bg-white rounded-xl border border-surface-200 p-6 space-y-4">
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
    </div>
  );
}
