import { useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { ArrowLeft, Upload, FileText, X, Loader2, CheckCircle } from 'lucide-react';
import { jobsApi } from '@/api/jobs';
import { applicationsApi } from '@/api/applications';
import { uploadsApi } from '@/api/uploads';
import { usersApi } from '@/api/users';
import { useAuthStore } from '@/store/authStore';

const schema = z.object({
  date_of_birth: z.string().min(1, 'Date of birth is required'),
  current_location: z.string().min(1, 'Location is required'),
  total_experience: z.string().min(1, 'Total experience is required'),
  current_company: z.string().min(1, 'Current company is required'),
  current_designation: z.string().min(1, 'Current designation is required'),
  education: z.string().min(1, 'Education is required'),
  skills: z.string().optional(),
  cover_letter: z.string().optional(),
  linkedin_url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  portfolio_url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  github_url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
});

export default function ApplyPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { accessToken, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [resumeFile, setResumeFile] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const { data: job, isLoading: jobLoading } = useQuery({
    queryKey: ['job', slug],
    queryFn: () => jobsApi.getBySlug(slug).then((r) => r.data),
  });

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => usersApi.me().then((r) => r.data),
    enabled: !!accessToken,
  });

  const { data: careerProfile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => usersApi.myProfile().then((r) => r.data),
    enabled: !!accessToken,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    values: (me || careerProfile) ? {
      date_of_birth: me?.date_of_birth ?? '',
      current_location: careerProfile?.current_location ?? '',
      total_experience: careerProfile?.total_experience ?? '',
      current_company: careerProfile?.current_company ?? '',
      current_designation: careerProfile?.current_designation ?? '',
      education: careerProfile?.education ?? '',
      skills: careerProfile?.skills ?? '',
      cover_letter: '',
      linkedin_url: '',
      portfolio_url: '',
      github_url: '',
    } : undefined,
  });

  const onDrop = useCallback((accepted) => {
    if (accepted[0]) setResumeFile(accepted[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
  });

  if (!accessToken) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <h2 className="font-display text-2xl font-bold text-gray-800 mb-2">Sign in to apply</h2>
        <p className="text-gray-500 mb-6">Create a free account or sign in to submit your application.</p>
        <Link
          to="/register"
          state={{ from: { pathname: `/jobs/${slug}/apply` } }}
          className="px-6 py-3 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors"
        >
          Create account
        </Link>
        <p className="mt-4 text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" state={{ from: { pathname: `/jobs/${slug}/apply` } }} className="text-brand-600">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-5" />
        <h2 className="font-display text-2xl font-bold text-gray-800 mb-2">Application submitted!</h2>
        <p className="text-gray-500 mb-6">
          We've received your application for <strong>{job?.title}</strong>. We'll be in touch soon.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            to="/portal/applications"
            className="px-5 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors"
          >
            View my applications
          </Link>
          <Link
            to="/jobs"
            className="px-5 py-2.5 bg-surface-100 text-gray-700 font-semibold rounded-lg text-sm hover:bg-surface-200 transition-colors"
          >
            Browse more jobs
          </Link>
        </div>
      </div>
    );
  }

  const onSubmit = async (values) => {
    if (!resumeFile) {
      toast.error('Please upload your resume');
      return;
    }
    if (!job) return;

    try {
      const uploadRes = await uploadsApi.resume(resumeFile);
      const resumeUrl = uploadRes.data.url;

      await applicationsApi.submit({
        job_id: job.id,
        resume_url: resumeUrl,
        date_of_birth: values.date_of_birth,
        current_location: values.current_location,
        total_experience: values.total_experience,
        current_company: values.current_company,
        current_designation: values.current_designation,
        education: values.education,
        skills: values.skills || undefined,
        cover_letter: values.cover_letter || undefined,
        linkedin_url: values.linkedin_url || undefined,
        portfolio_url: values.portfolio_url || undefined,
        github_url: values.github_url || undefined,
      });

      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      setSubmitted(true);
      toast.success('Application submitted!');
    } catch (err) {
      const msg = err.response?.data?.detail;
      if (msg?.includes('already applied')) {
        toast.error('You have already applied for this role.');
      } else {
        toast.error(msg ?? 'Something went wrong. Please try again.');
      }
    }
  };

  if (jobLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 animate-pulse">
        <div className="h-6 bg-surface-100 rounded w-1/2 mb-6" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-surface-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <Link to={`/jobs/${slug}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to job
      </Link>

      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold text-gray-900 mb-1">Apply for {job?.title}</h1>
        <p className="text-sm text-gray-500">Nablon AI · Applying as {user?.full_name} ({user?.email})</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Resume upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Resume <span className="text-red-500">*</span>
          </label>
          {resumeFile ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
              <FileText className="w-5 h-5 text-green-600 flex-shrink-0" />
              <span className="text-sm text-green-800 flex-1 truncate">{resumeFile.name}</span>
              <button
                type="button"
                onClick={() => setResumeFile(null)}
                className="text-green-600 hover:text-green-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-surface-300 hover:border-brand-300 hover:bg-surface-50'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">
                {isDragActive ? 'Drop your resume here' : 'Drag & drop your resume'}
              </p>
              <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX · Max 10 MB</p>
              <button
                type="button"
                className="mt-3 text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                or click to browse
              </button>
            </div>
          )}
        </div>

        {/* Candidate details */}
        <div className="space-y-4 p-5 bg-surface-50 border border-surface-200 rounded-xl">
          <p className="text-sm font-semibold text-gray-900">Your details</p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Date of birth <span className="text-red-500">*</span>
              </label>
              <input
                {...register('date_of_birth')}
                type="date"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.date_of_birth && <p className="mt-1 text-xs text-red-500">{errors.date_of_birth.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Current location <span className="text-red-500">*</span>
              </label>
              <input
                {...register('current_location')}
                placeholder="Bengaluru, India"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.current_location && <p className="mt-1 text-xs text-red-500">{errors.current_location.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Current company <span className="text-red-500">*</span>
              </label>
              <input
                {...register('current_company')}
                placeholder="Company name (or 'Fresher')"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.current_company && <p className="mt-1 text-xs text-red-500">{errors.current_company.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Current designation <span className="text-red-500">*</span>
              </label>
              <input
                {...register('current_designation')}
                placeholder="e.g. Senior Data Scientist"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.current_designation && <p className="mt-1 text-xs text-red-500">{errors.current_designation.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Total experience <span className="text-red-500">*</span>
              </label>
              <input
                {...register('total_experience')}
                placeholder="e.g. 5 years"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.total_experience && <p className="mt-1 text-xs text-red-500">{errors.total_experience.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Education <span className="text-red-500">*</span>
              </label>
              <input
                {...register('education')}
                placeholder="e.g. B.Tech, CSE, IIT Delhi"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.education && <p className="mt-1 text-xs text-red-500">{errors.education.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Skills <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              {...register('skills')}
              rows={2}
              placeholder="e.g. Python, PyTorch, LLMs, SQL, Agentic AI"
              className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
            />
          </div>
        </div>

        {/* Cover letter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Cover letter <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            {...register('cover_letter')}
            rows={5}
            placeholder="Tell us why you're excited about this role and what makes you a great fit..."
            className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Links */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { name: 'linkedin_url', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/...' },
            { name: 'portfolio_url', label: 'Portfolio', placeholder: 'https://...' },
            { name: 'github_url', label: 'GitHub', placeholder: 'https://github.com/...' },
          ].map(({ name, label, placeholder }) => (
            <div key={name}>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {label} <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                {...register(name)}
                type="url"
                placeholder={placeholder}
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors[name] && (
                <p className="mt-1 text-xs text-red-500">{errors[name].message}</p>
              )}
            </div>
          ))}
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-8 py-3 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? 'Submitting...' : 'Submit application'}
          </button>
          <Link
            to={`/jobs/${slug}`}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
