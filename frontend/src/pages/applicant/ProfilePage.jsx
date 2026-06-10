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
  department: z.string().optional(),
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

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(profileSchema),
    values: profile ? {
      full_name: profile.full_name,
      phone: profile.phone ?? '',
      department: profile.department ?? '',
    } : undefined,
  });

  const updateMut = useMutation({
    mutationFn: (data) => usersApi.updateMe(data),
    onSuccess: (res) => {
      toast.success('Profile updated');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      if (setUser) setUser(res.data);
    },
    onError: () => toast.error('Failed to update profile'),
  });

  const onSubmit = (values) => {
    const payload = { full_name: values.full_name };
    if (values.phone) payload.phone = values.phone;
    if (values.department) payload.department = values.department;
    updateMut.mutate(payload);
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
