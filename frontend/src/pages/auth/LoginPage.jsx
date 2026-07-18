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

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
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
