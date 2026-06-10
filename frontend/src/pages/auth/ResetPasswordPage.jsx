import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Loader2, CheckCircle } from 'lucide-react';

import { authApi } from '@/api/auth';

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

  if (done) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-card p-8 text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-display font-bold text-gray-900 mb-2">Email sent</h2>
          <p className="text-sm text-gray-500 mb-6">
            If that email is registered, you'll receive a reset link shortly.
          </p>
          <Link to="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Back to Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-card p-8">
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-1">
            {isForgot ? 'Forgot password?' : 'Set new password'}
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            {isForgot
              ? 'Enter your email and we\'ll send you a reset link.'
              : 'Enter your new password below.'}
          </p>

          {isForgot ? (
            <form onSubmit={handleForgot(onForgot)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input
                  {...registerForgot('email')}
                  type="email"
                  className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
                {forgotErrors.email && (
                  <p className="mt-1 text-xs text-red-500">{forgotErrors.email.message}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={forgotSubmitting}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60 transition-colors"
              >
                {forgotSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Send reset link
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset(onReset)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">New password</label>
                <input
                  {...registerReset('new_password')}
                  type="password"
                  className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
                {resetErrors.new_password && (
                  <p className="mt-1 text-xs text-red-500">{resetErrors.new_password.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm password</label>
                <input
                  {...registerReset('confirm_password')}
                  type="password"
                  className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
                {resetErrors.confirm_password && (
                  <p className="mt-1 text-xs text-red-500">{resetErrors.confirm_password.message}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={resetSubmitting}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-60 transition-colors"
              >
                {resetSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Reset password
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-gray-500">
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
              Back to Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
