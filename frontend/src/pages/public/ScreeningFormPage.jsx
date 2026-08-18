import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  Building2, Loader2, AlertCircle, CheckCircle2, Plus, X, GraduationCap,
  Github, Sparkles, Trophy,
} from 'lucide-react';
import { screeningApi } from '@/api/screening';

const projectSchema = z.object({
  title: z.string().min(1, 'Project title is required'),
  description: z.string().min(1, 'A short description is required'),
  github_url: z.string().optional(),
  tech_stack: z.string().optional(),
});

const schema = z.object({
  college_name: z.string().min(1, 'College name is required'),
  cgpa: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : parseFloat(v)),
    z.number({ required_error: 'CGPA is required' }).min(0, 'Must be between 0 and 10').max(10, 'Must be between 0 and 10')
  ),
  relevant_experience: z.string().optional(),
  achievements: z.string().optional(),
  github_profile_url: z.string().optional(),
  projects: z.array(projectSchema).min(1, 'Add at least one project'),
});

function FieldLabel({ children, required }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function ErrorMsg({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-500">{message}</p>;
}

const inputClass = 'w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent';

export default function ScreeningFormPage() {
  const { token } = useParams();
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState([]);
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['screening-status', token],
    queryFn: () => screeningApi.getStatus(token).then((r) => r.data),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      college_name: '',
      cgpa: '',
      relevant_experience: '',
      achievements: '',
      github_profile_url: '',
      projects: [{ title: '', description: '', github_url: '', tech_stack: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'projects' });

  const submitMutation = useMutation({
    mutationFn: (payload) => screeningApi.submit(token, payload),
    onSuccess: () => setSubmitted(true),
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Submission failed. Please try again.'),
  });

  const addSkill = () => {
    const s = skillInput.trim();
    if (s && !skills.includes(s)) setSkills([...skills, s]);
    setSkillInput('');
  };
  const removeSkill = (s) => setSkills(skills.filter((x) => x !== s));

  const onSubmit = (values) => {
    submitMutation.mutate({ ...values, skills });
  };

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
          <h2 className="font-display font-bold text-gray-800 text-xl mb-2">Link invalid or expired</h2>
          <p className="text-sm text-gray-500">
            This screening link is no longer valid. Please contact our HR team for assistance.
          </p>
        </div>
      </div>
    );
  }

  const alreadyDone = submitted || data.status === 'submitted';

  return (
    <div className="min-h-screen bg-surface-50">
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 py-10 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-brand-100 text-xs font-medium px-3 py-1 rounded-full mb-4">
            <Building2 className="w-3.5 h-3.5" />
            Nablon AI Careers
          </div>
          <h1 className="font-display text-2xl font-bold text-white mb-2">Screening Questionnaire</h1>
          <p className="text-brand-200 text-sm">
            Hi <strong className="text-white">{data.candidate_name}</strong>, tell us a bit more about your
            background for the <strong className="text-white">{data.job_title}</strong> role.
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {alreadyDone ? (
          <div className="bg-white rounded-xl border border-surface-200 p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="font-display font-bold text-gray-800 text-xl mb-2">Thanks — you're all set!</h2>
            <p className="text-sm text-gray-500">
              We've received your responses and our team will review them alongside the rest of your
              application. You'll hear from us with an update soon.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Academics */}
            <section className="bg-white rounded-xl border border-surface-200 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-4.5 h-4.5 text-brand-600" />
                <h2 className="font-display font-semibold text-gray-900 text-base">Academic background</h2>
              </div>
              <div>
                <FieldLabel required>College / University name</FieldLabel>
                <input {...register('college_name')} className={inputClass} placeholder="e.g. IIT Bombay" />
                <ErrorMsg message={errors.college_name?.message} />
              </div>
              <div className="max-w-xs">
                <FieldLabel required>CGPA (out of 10)</FieldLabel>
                <input {...register('cgpa')} type="number" step="0.01" min="0" max="10" className={inputClass} placeholder="e.g. 8.5" />
                <ErrorMsg message={errors.cgpa?.message} />
              </div>
            </section>

            {/* Experience & skills */}
            <section className="bg-white rounded-xl border border-surface-200 p-5 space-y-4">
              <h2 className="font-display font-semibold text-gray-900 text-base">Experience & skills</h2>
              <div>
                <FieldLabel>Relevant experience</FieldLabel>
                <textarea {...register('relevant_experience')} rows={3} className={inputClass} placeholder="Internships, jobs, or coursework relevant to this role..." />
              </div>
              <div>
                <FieldLabel>Skills</FieldLabel>
                <div className="flex gap-2">
                  <input
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                    placeholder="Add a skill (e.g. Python, PyTorch)..."
                    className={`${inputClass} flex-1`}
                  />
                  <button type="button" onClick={addSkill} className="px-3 py-2 bg-surface-100 text-gray-700 rounded-lg text-sm hover:bg-surface-200 transition-colors">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {skills.map((skill) => (
                      <span key={skill} className="flex items-center gap-1.5 text-sm bg-brand-50 text-brand-700 border border-brand-100 px-3 py-1 rounded-lg">
                        {skill}
                        <button type="button" onClick={() => removeSkill(skill)}><X className="w-3.5 h-3.5" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <FieldLabel>GitHub profile URL</FieldLabel>
                <input {...register('github_profile_url')} className={inputClass} placeholder="https://github.com/yourusername" />
              </div>
            </section>

            {/* Projects */}
            <section className="bg-white rounded-xl border border-surface-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4.5 h-4.5 text-brand-600" />
                  <h2 className="font-display font-semibold text-gray-900 text-base">Projects</h2>
                </div>
                <button
                  type="button"
                  onClick={() => append({ title: '', description: '', github_url: '', tech_stack: '' })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-100 rounded-lg hover:bg-brand-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add project
                </button>
              </div>
              <ErrorMsg message={errors.projects?.root?.message ?? errors.projects?.message} />

              {fields.map((field, idx) => (
                <div key={field.id} className="border border-surface-200 rounded-lg p-4 space-y-3 relative">
                  {fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      className="absolute top-3 right-3 p-1 rounded-lg text-gray-400 hover:bg-surface-100 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <div>
                    <FieldLabel required>Project title</FieldLabel>
                    <input {...register(`projects.${idx}.title`)} className={inputClass} placeholder="e.g. Real-time fraud detection pipeline" />
                    <ErrorMsg message={errors.projects?.[idx]?.title?.message} />
                  </div>
                  <div>
                    <FieldLabel required>Description</FieldLabel>
                    <textarea {...register(`projects.${idx}.description`)} rows={2} className={inputClass} placeholder="What did you build, and what was your role?" />
                    <ErrorMsg message={errors.projects?.[idx]?.description?.message} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>GitHub link</FieldLabel>
                      <input {...register(`projects.${idx}.github_url`)} className={inputClass} placeholder="https://github.com/you/project" />
                    </div>
                    <div>
                      <FieldLabel>Tech stack</FieldLabel>
                      <input {...register(`projects.${idx}.tech_stack`)} className={inputClass} placeholder="e.g. Python, PyTorch, FastAPI" />
                    </div>
                  </div>
                </div>
              ))}
            </section>

            {/* Achievements */}
            <section className="bg-white rounded-xl border border-surface-200 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Trophy className="w-4.5 h-4.5 text-brand-600" />
                <h2 className="font-display font-semibold text-gray-900 text-base">Achievements</h2>
              </div>
              <textarea {...register('achievements')} rows={3} className={inputClass} placeholder="Competitions, publications, certifications, notable recognitions..." />
            </section>

            <button
              type="submit"
              disabled={isSubmitting || submitMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {(isSubmitting || submitMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit questionnaire
            </button>
            <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
              <Github className="w-3.5 h-3.5" /> Real GitHub links help us evaluate your projects fairly.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
