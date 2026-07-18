import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Loader2, CheckCircle, Mail, Lock, User } from 'lucide-react';

import { authApi } from '@/api/auth';
import AuthLayout, { AuthInput, AuthSubmitButton } from '@/components/layout/AuthLayout';

const schema = z.object({
  full_name: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.string().email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (values) => {
    try {
      await authApi.register({
        full_name: values.full_name,
        email: values.email,
        password: values.password,
      });
      setSuccess(true);
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Registration failed');
    }
  };

  if (success) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="One more step to activate your account"
      >
        <div className="bg-white border border-surface-200 rounded-2xl shadow-card p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-green-500" />
          </div>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            We've sent a verification link to your email address. Click the link to activate your
            account, then sign in.
          </p>
          <button
            onClick={() => navigate('/login', { state: location.state })}
            className="w-full py-3 bg-brand-500 hover:bg-brand-400 text-white rounded-xl text-sm font-semibold shadow-[0_10px_30px_-10px_rgba(79,94,255,0.6)] transition-all"
          >
            Go to Sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Apply for roles and track your applications at Nablon AI"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Full name</label>
          <AuthInput
            {...register('full_name')}
            icon={User}
            type="text"
            placeholder="Jane Smith"
            autoComplete="name"
            error={errors.full_name?.message}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
          <AuthInput
            {...register('email')}
            icon={Mail}
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            error={errors.email?.message}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
          <AuthInput
            {...register('password')}
            icon={Lock}
            type={showPassword ? 'text' : 'password'}
            placeholder="Min 8 chars, 1 uppercase, 1 number"
            autoComplete="new-password"
            error={errors.password?.message}
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm password</label>
          <AuthInput
            {...register('confirmPassword')}
            icon={Lock}
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
          />
        </div>

        <AuthSubmitButton loading={isSubmitting}>
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Create account
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}
