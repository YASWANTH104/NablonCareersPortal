import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Loader2, AlertCircle, Building2, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { screeningApi } from '@/api/screening';

const currentYear = new Date().getFullYear();

const schema = z.object({
  college_name: z.string().min(1, 'College/university name is required').max(255),
  degree: z.string().min(1, 'Degree is required').max(100),
  branch: z.string().min(1, 'Branch/major is required').max(100),
  graduation_year: z.coerce.number({ invalid_type_error: 'Enter a valid year' })
    .int().min(1990, 'Enter a valid year').max(currentYear + 6, 'Enter a valid year'),
  cgpa: z.string().min(1, 'CGPA / percentage is required').max(20),
  key_skills: z.string().min(1, 'List at least a few key skills'),
  certifications: z.array(z.object({
    name: z.string().min(1, 'Certification name is required'),
    issuer: z.string().optional(),
    year: z.string().optional(),
  })),
  projects: z.array(z.object({
    title: z.string().min(1, 'Project title is required'),
    description: z.string().optional(),
    tech_stack: z.string().optional(),
    link: z.string().optional(),
  })).min(1, 'Add at least one project'),
});

const inputCls =
  'w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent';
const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5';
const errCls = 'mt-1 text-xs text-red-500';

export default function ScreeningFormPage() {
  const { token } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['screening-form', token],
    queryFn: () => screeningApi.get(token).then((r) => r.data),
    retry: false,
  });

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    values: data ? {
      college_name: data.college_name ?? '',
      degree: data.degree ?? '',
      branch: data.branch ?? '',
      graduation_year: data.graduation_year ?? '',
      cgpa: data.cgpa ?? '',
      key_skills: data.key_skills ?? '',
      certifications: data.certifications?.length ? data.certifications : [],
      projects: data.projects?.length ? data.projects : [{ title: '', description: '', tech_stack: '', link: '' }],
    } : undefined,
  });

  const certFields = useFieldArray({ control, name: 'certifications' });
  const projectFields = useFieldArray({ control, name: 'projects' });

  const submitMutation = useMutation({
    mutationFn: (payload) => screeningApi.submit(token, payload).then((r) => r.data),
    onSuccess: () => toast.success('Thanks! Your responses have been submitted.'),
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Submission failed. Please try again.'),
  });

  const onSubmit = (values) => submitMutation.mutate(values);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="font-display font-bold text-gray-800 text-xl mb-2">Link invalid</h2>
          <p className="text-sm text-gray-500">
            This screening form link is not valid. Please contact our HR team for assistance.
          </p>
        </div>
      </div>
    );
  }

  const justSubmitted = submitMutation.isSuccess;
  const alreadySubmitted = !!data.submitted_at;

  return (
    <div className="min-h-screen bg-surface-50">
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 py-10 px-4">
        <div className="max-w-xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-brand-100 text-xs font-medium px-3 py-1 rounded-full mb-4">
            <Building2 className="w-3.5 h-3.5" />
            Nablon AI Careers
          </div>
          <h1 className="font-display text-2xl font-bold text-white mb-2">Screening Form</h1>
          <p className="text-brand-200 text-sm">
            Hi <strong className="text-white">{data.candidate_name}</strong>, this is a short
            screening form for your <strong className="text-white">{data.job_title}</strong> application.
          </p>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8">
        {(justSubmitted || alreadySubmitted) && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3 mb-6">
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800">Response recorded</p>
              <p className="text-xs text-green-600 mt-0.5">
                You can still update your answers below if anything changes.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="bg-white rounded-xl border border-surface-200 p-5 space-y-4">
            <p className="text-sm font-semibold text-gray-800">Education</p>

            <div>
              <label className={labelCls}>College / University <span className="text-red-500">*</span></label>
              <input {...register('college_name')} placeholder="e.g. IIT Bombay" className={inputCls} />
              {errors.college_name && <p className={errCls}>{errors.college_name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Degree <span className="text-red-500">*</span></label>
                <input {...register('degree')} placeholder="e.g. B.Tech" className={inputCls} />
                {errors.degree && <p className={errCls}>{errors.degree.message}</p>}
              </div>
              <div>
                <label className={labelCls}>Branch / Major <span className="text-red-500">*</span></label>
                <input {...register('branch')} placeholder="e.g. Computer Science" className={inputCls} />
                {errors.branch && <p className={errCls}>{errors.branch.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Graduation year <span className="text-red-500">*</span></label>
                <input {...register('graduation_year')} type="number" placeholder="e.g. 2025" className={inputCls} />
                {errors.graduation_year && <p className={errCls}>{errors.graduation_year.message}</p>}
              </div>
              <div>
                <label className={labelCls}>CGPA / Percentage <span className="text-red-500">*</span></label>
                <input {...register('cgpa')} placeholder="e.g. 8.5/10 or 85%" className={inputCls} />
                {errors.cgpa && <p className={errCls}>{errors.cgpa.message}</p>}
              </div>
            </div>

            <div>
              <label className={labelCls}>Key skills / programming languages <span className="text-red-500">*</span></label>
              <textarea {...register('key_skills')} rows={2} placeholder="e.g. Python, PyTorch, SQL, React" className={inputCls} />
              {errors.key_skills && <p className={errCls}>{errors.key_skills.message}</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-surface-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Certifications</p>
              <button
                type="button"
                onClick={() => certFields.append({ name: '', issuer: '', year: '' })}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {certFields.fields.length === 0 && (
              <p className="text-xs text-gray-400">Optional — add any certifications you hold.</p>
            )}
            {certFields.fields.map((field, i) => (
              <div key={field.id} className="grid grid-cols-[1fr_1fr_80px_auto] gap-2 items-start">
                <div>
                  <input {...register(`certifications.${i}.name`)} placeholder="Name" className={inputCls} />
                  {errors.certifications?.[i]?.name && <p className={errCls}>{errors.certifications[i].name.message}</p>}
                </div>
                <input {...register(`certifications.${i}.issuer`)} placeholder="Issuer" className={inputCls} />
                <input {...register(`certifications.${i}.year`)} placeholder="Year" className={inputCls} />
                <button
                  type="button"
                  onClick={() => certFields.remove(i)}
                  className="p-2.5 text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-surface-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Projects <span className="text-red-500">*</span></p>
              <button
                type="button"
                onClick={() => projectFields.append({ title: '', description: '', tech_stack: '', link: '' })}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {errors.projects?.root && <p className={errCls}>{errors.projects.root.message}</p>}
            {errors.projects?.message && <p className={errCls}>{errors.projects.message}</p>}
            {projectFields.fields.map((field, i) => (
              <div key={field.id} className="border border-surface-100 rounded-lg p-3 space-y-2 relative">
                {projectFields.fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => projectFields.remove(i)}
                    className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <div>
                  <input {...register(`projects.${i}.title`)} placeholder="Project title" className={inputCls} />
                  {errors.projects?.[i]?.title && <p className={errCls}>{errors.projects[i].title.message}</p>}
                </div>
                <textarea {...register(`projects.${i}.description`)} rows={2} placeholder="Brief description" className={inputCls} />
                <div className="grid grid-cols-2 gap-2">
                  <input {...register(`projects.${i}.tech_stack`)} placeholder="Tech stack" className={inputCls} />
                  <input {...register(`projects.${i}.link`)} placeholder="Link (optional)" className={inputCls} />
                </div>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || submitMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            {(isSubmitting || submitMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
            {alreadySubmitted ? 'Update Response' : 'Submit'}
          </button>
        </form>
      </div>
    </div>
  );
}
