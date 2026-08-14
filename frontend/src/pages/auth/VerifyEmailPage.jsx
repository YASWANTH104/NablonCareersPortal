import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';

import { authApi } from '@/api/auth';
import AuthLayout from '@/components/layout/AuthLayout';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState('verifying');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setStatus('error');
      return;
    }
    authApi
      .verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  const goToSignIn = () => navigate('/login', { state: location.state });

  if (status === 'verifying') {
    return (
      <AuthLayout title="Verifying your email" subtitle="This will just take a moment">
        <div className="bg-white border border-surface-200 rounded-2xl shadow-card p-8 text-center">
          <Loader2 className="w-8 h-8 text-brand-500 animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">Confirming your verification link...</p>
        </div>
      </AuthLayout>
    );
  }

  if (status === 'error') {
    return (
      <AuthLayout title="Link expired or invalid" subtitle="You can still sign in and continue">
        <div className="bg-white border border-surface-200 rounded-2xl shadow-card p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-7 h-7 text-red-500" />
          </div>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            This verification link is invalid or has already been used. Your account still works —
            just sign in below.
          </p>
          <button
            onClick={goToSignIn}
            className="w-full py-3 bg-brand-500 hover:bg-brand-400 text-white rounded-xl text-sm font-semibold shadow-[0_10px_30px_-10px_rgba(79,94,255,0.6)] transition-all"
          >
            Go to Sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Email verified" subtitle="Your account is now active">
      <div className="bg-white border border-surface-200 rounded-2xl shadow-card p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-7 h-7 text-green-500" />
        </div>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          Your email address has been verified. Sign in to continue where you left off.
        </p>
        <button
          onClick={goToSignIn}
          className="w-full py-3 bg-brand-500 hover:bg-brand-400 text-white rounded-xl text-sm font-semibold shadow-[0_10px_30px_-10px_rgba(79,94,255,0.6)] transition-all"
        >
          Go to Sign in
        </button>
      </div>
    </AuthLayout>
  );
}
