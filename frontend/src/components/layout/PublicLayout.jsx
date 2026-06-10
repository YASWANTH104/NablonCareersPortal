import { Outlet, Link, NavLink } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { getHomeRoute } from '@/utils/permissions';

export default function PublicLayout() {
  const { user, accessToken } = useAuthStore();

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      {/* Public nav */}
      <header className="border-b border-surface-200 bg-white sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/jobs" className="flex items-center gap-2.5 flex-shrink-0">
            <img src="/logo.jpg" alt="Nablon AI" className="h-8 w-auto rounded-lg object-contain" />
            <span className="font-display font-bold text-gray-900 hidden sm:block">Careers</span>
          </Link>

          <nav className="flex items-center gap-2">
            <NavLink
              to="/jobs"
              className={({ isActive }) =>
                `text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'text-brand-600 bg-brand-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-surface-100'
                }`
              }
            >
              All Jobs
            </NavLink>

            {accessToken && user ? (
              <Link
                to={getHomeRoute(user.role)}
                className="text-sm font-medium px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors ml-2"
              >
                Go to Portal
              </Link>
            ) : (
              <div className="flex items-center gap-2 ml-2">
                <Link
                  to="/login"
                  className="text-sm font-medium px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-surface-100 rounded-lg transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="text-sm font-medium px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors"
                >
                  Create account
                </Link>
              </div>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-surface-200 bg-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} Nablon AI · careers.nablon.ai
        </div>
      </footer>
    </div>
  );
}
