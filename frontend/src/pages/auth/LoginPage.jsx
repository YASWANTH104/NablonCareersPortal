import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Loader2, Mail, Lock } from 'lucide-react';

import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { getHomeRoute } from '@/utils/permissions';
import AuthLayout, { AuthInput, AuthSubmitButton } from '@/components/layout/AuthLayout';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [msLoading, setMsLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuthStore();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (values) => {
    try {
      const { data } = await authApi.login(values);
      useAuthStore.setState({ accessToken: data.access_token });
      const meRes = await authApi.me();
      login(meRes.data, data.access_token, data.refresh_token);
      const agencyReturn = sessionStorage.getItem('agency_return_to');
      const from = location.state?.from?.pathname || agencyReturn || getHomeRoute(meRes.data.role);
      if (agencyReturn) sessionStorage.removeItem('agency_return_to');
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Invalid credentials');
    }
  };

  const onMicrosoftSignIn = async () => {
    setMsLoading(true);
    try {
      const state = crypto.randomUUID();
      sessionStorage.setItem('ms_sso_state', state);
      const { data } = await authApi.microsoftLoginUrl(state);
      window.location.href = data.authorize_url;
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Microsoft sign-in is unavailable right now');
      setMsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your account to continue"
      footer={
        <>
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-brand-600 hover:text-brand-700">
            Create one
          </Link>
        </>
      }
    >
      <button
        type="button"
        onClick={onMicrosoftSignIn}
        disabled={msLoading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-surface-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 mb-5"
      >
        {msLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MicrosoftLogo />}
        Sign in with Microsoft
      </button>
      {/* Candidates share this page, so say who the button is for — their
          Microsoft account is not in the Nablon tenant and would just fail. */}
      <p className="-mt-3 mb-5 text-center text-xs text-gray-400">
        For Nablon staff — your account is created on first sign-in.
      </p>

      <div className="flex items-center gap-3 mb-5">
        <div className="h-px flex-1 bg-surface-200" />
        <span className="text-xs text-gray-400">or sign in with email</span>
        <div className="h-px flex-1 bg-surface-200" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <Link to="/forgot-password" className="text-xs text-brand-600 hover:text-brand-700 font-medium">
              Forgot password?
            </Link>
          </div>
          <AuthInput
            {...register('password')}
            icon={Lock}
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            autoComplete="current-password"
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

        <AuthSubmitButton loading={isSubmitting}>
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Sign in
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}
