import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';

import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { getHomeRoute } from '@/utils/permissions';
import AuthLayout from '@/components/layout/AuthLayout';

export default function MicrosoftCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [error, setError] = useState(null);
  const ranOnce = useRef(false);

  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const expectedState = sessionStorage.getItem('ms_sso_state');
    sessionStorage.removeItem('ms_sso_state');

    if (!code || !state || state !== expectedState) {
      setError('Sign-in link is invalid or expired. Please try again.');
      return;
    }

    (async () => {
      try {
        const { data } = await authApi.microsoftCallback(code, state);
        useAuthStore.setState({ accessToken: data.access_token });
        const meRes = await authApi.me();
        login(meRes.data, data.access_token, data.refresh_token);
        navigate(getHomeRoute(meRes.data.role), { replace: true });
      } catch (err) {
        setError(err.response?.data?.detail ?? 'Microsoft sign-in failed. Please try again.');
      }
    })();
  }, [searchParams, navigate, login]);

  return (
    <AuthLayout title="Signing you in" subtitle="Verifying your Microsoft account">
      {error ? (
        <div className="text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <p className="text-sm text-gray-700">{error}</p>
          <Link to="/login" className="inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
            Back to sign in
          </Link>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Signing you in…</span>
        </div>
      )}
    </AuthLayout>
  );
}
