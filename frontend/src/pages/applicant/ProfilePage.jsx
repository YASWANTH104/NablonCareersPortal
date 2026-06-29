import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { User, Mail, Phone, Edit2, Check, X, Loader2 } from 'lucide-react';
import { usersApi } from '@/api/users';
import { useAuthStore } from '@/store/authStore';

const profileSchema = z.object({
  full_name: z.string().min(2, 'Name is required'),
  phone: z.string().optional(),
  date_of_birth: z.string().optional(),
  current_location: z.string().optional(),
  current_company: z.string().optional(),
  current_designation: z.string().optional(),
  total_experience: z.string().optional(),
  education: z.string().optional(),
  skills: z.string().optional(),
});

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  hr_manager: 'HR Manager',
  interviewer: 'Interviewer',
  employee: 'Employee',
  applicant: 'Applicant',
};

export default function ProfilePage() {
  const [editing, setEditing] = useState(false);
  const qc = useQueryClient();
  const { user: storeUser, setUser } = useAuthStore();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => usersApi.me().then((r) => r.data),
  });

  const { data: career } = useQuery({
    queryKey: ['my-career-profile'],
    queryFn: () => usersApi.myProfile().then((r) => r.data),
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(profileSchema),
    values: profile ? {
      full_name: profile.full_name,
      phone: profile.phone ?? '',
      date_of_birth: profile.date_of_birth ?? '',
      current_location: career?.current_location ?? '',
      current_company: career?.current_company ?? '',
      current_designation: career?.current_designation ?? '',
      total_experience: career?.total_experience ?? '',
      education: career?.education ?? '',
      skills: career?.skills ?? '',
    } : undefined,
  });

  const updateMut = useMutation({
    mutationFn: (values) => {
      const userPayload = { full_name: values.full_name };
      userPayload.phone = values.phone || null;
      userPayload.date_of_birth = values.date_of_birth || null;
      const profilePayload = {
        current_location: values.current_location || null,
        current_company: values.current_company || null,
        current_designation: values.current_designation || null,
        total_experience: values.total_experience || null,
        education: values.education || null,
        skills: values.skills || null,
      };
      return Promise.all([
        usersApi.updateMe(userPayload),
        usersApi.updateMyProfile(profilePayload),
      ]).then(([userRes]) => userRes);
    },
    onSuccess: (res) => {
      toast.success('Profile updated');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      qc.invalidateQueries({ queryKey: ['my-career-profile'] });
      if (setUser) setUser(res.data);
    },
    onError: () => toast.error('Failed to update profile'),
  });

  const onSubmit = (values) => {
    updateMut.mutate(values);
  };

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-surface-100 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your personal information</p>
      </div>

      <div className="bg-white rounded-2xl border border-surface-200 overflow-hidden">
        {/* Avatar header */}
        <div className="bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-8 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-2xl">
              {profile?.full_name?.charAt(0)?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div>
            <p className="text-white font-semibold text-lg">{profile?.full_name}</p>
            <p className="text-brand-100 text-sm">{ROLE_LABELS[profile?.role] ?? profile?.role}</p>
          </div>
        </div>

        {/* Fields */}
        <div className="p-6">
          {editing ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input
                  {...register('full_name')}
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {errors.full_name && <p className="text-xs text-red-500 mt-1">{errors.full_name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  {...register('phone')}
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="+91 98765 43210"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date of birth</label>
                <input
                  {...register('date_of_birth')}
                  type="date"
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current location</label>
                <input
                  {...register('current_location')}
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Bengaluru, India"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current company</label>
                <input
                  {...register('current_company')}
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Company name (or 'Fresher')"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current designation</label>
                <input
                  {...register('current_designation')}
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. Senior Data Scientist"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total experience</label>
                <input
                  {...register('total_experience')}
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. 5 years"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Education</label>
                <input
                  {...register('education')}
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. B.Tech, CSE, IIT Delhi"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Skills</label>
                <textarea
                  {...register('skills')}
                  rows={2}
                  className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                  placeholder="e.g. Python, PyTorch, LLMs, SQL"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || updateMut.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
                >
                  {(isSubmitting || updateMut.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); reset(); }}
                  className="flex items-center gap-2 px-5 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm">
                  <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Full name</p>
                    <p className="text-gray-900 font-medium">{profile?.full_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Email</p>
                    <p className="text-gray-900">{profile?.email}</p>
                  </div>
                </div>
                {profile?.phone && (
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Phone</p>
                      <p className="text-gray-900">{profile?.phone}</p>
                    </div>
                  </div>
                )}
                {[
                  ['Date of birth', profile?.date_of_birth],
                  ['Current location', career?.current_location],
                  ['Current company', career?.current_company],
                  ['Current designation', career?.current_designation],
                  ['Total experience', career?.total_experience],
                  ['Education', career?.education],
                  ['Skills', career?.skills],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="flex items-center gap-3 text-sm">
                    <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                      <p className="text-gray-900">{value}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-surface-100">
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 font-medium"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit profile
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Verification status */}
      <div className={`mt-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${
        profile?.is_verified ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
      }`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${profile?.is_verified ? 'bg-green-500' : 'bg-amber-400'}`} />
        {profile?.is_verified ? 'Email verified' : 'Email not verified — check your inbox for a verification link'}
      </div>
    </div>
  );
}
