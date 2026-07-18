import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Loader2, CheckCircle, Mail, Lock } from 'lucide-react';

import { authApi } from '@/api/auth';
import AuthLayout, { AuthInput, AuthSubmitButton } from '@/components/layout/AuthLayout';

const forgotSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

const resetSchema = z.object({
  new_password: z.string().min(8, 'Minimum 8 characters'),
  confirm_password: z.string(),
}).refine((d) => d.new_password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
});

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  const isForgot = !token;

  const {
    register: registerForgot,
    handleSubmit: handleForgot,
    formState: { errors: forgotErrors, isSubmitting: forgotSubmitting },
  } = useForm({ resolver: zodResolver(forgotSchema) });

  const {
    register: registerReset,
    handleSubmit: handleReset,
    formState: { errors: resetErrors, isSubmitting: resetSubmitting },
  } = useForm({ resolver: zodResolver(resetSchema) });

  const onForgot = async (values) => {
    try {
      await authApi.forgotPassword(values.email);
      setDone(true);
    } catch {
      toast.error('Something went wrong, please try again');
    }
  };

  const onReset = async (values) => {
    try {
      await authApi.resetPassword(token, values.new_password);
      toast.success('Password reset successfully');
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Invalid or expired link');
    }
  };

  const backToSignIn = (
    <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">
      Back to Sign in
    </Link>
  );

  if (done) {
    return (
      <AuthLayout title="Email sent" subtitle="Check your inbox for the reset link" footer={backToSignIn}>
        <div className="bg-white border border-surface-200 rounded-2xl shadow-card p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-green-500" />
          </div>
          <p className="text-sm text-gray-500 leading-relaxed">
            If that email is registered, you'll receive a reset link shortly.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={isForgot ? 'Forgot password?' : 'Set new password'}
      subtitle={
        isForgot
          ? "Enter your email and we'll send you a reset link."
          : 'Enter your new password below.'
      }
      footer={backToSignIn}
    >
      {isForgot ? (
        <form onSubmit={handleForgot(onForgot)} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
            <AuthInput
              {...registerForgot('email')}
              icon={Mail}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              error={forgotErrors.email?.message}
            />
          </div>
          <AuthSubmitButton loading={forgotSubmitting}>
            {forgotSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Send reset link
          </AuthSubmitButton>
        </form>
      ) : (
        <form onSubmit={handleReset(onReset)} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">New password</label>
            <AuthInput
              {...registerReset('new_password')}
              icon={Lock}
              type="password"
              placeholder="Min 8 characters"
              autoComplete="new-password"
              error={resetErrors.new_password?.message}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm password</label>
            <AuthInput
              {...registerReset('confirm_password')}
              icon={Lock}
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              error={resetErrors.confirm_password?.message}
            />
          </div>
          <AuthSubmitButton loading={resetSubmitting}>
            {resetSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Reset password
          </AuthSubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
