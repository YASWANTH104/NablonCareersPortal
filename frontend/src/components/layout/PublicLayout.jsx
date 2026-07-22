import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { getHomeRoute } from '@/utils/permissions';

// Routes whose first screenful is the dark gray-950 hero — the nav floats over
// these transparently until you scroll. Everything else (e.g. the apply page,
// which has a light top) gets the solid white bar from the start.
function usesDarkHero(pathname) {
  if (pathname === '/' || pathname === '/jobs') return true;
  return /^\/jobs\/[^/]+$/.test(pathname); // /jobs/:slug but NOT /jobs/:slug/apply
}

export default function PublicLayout() {
  const { user, accessToken } = useAuthStore();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const overHero = usesDarkHero(pathname);
  // Transparent, light-on-dark treatment only while sitting on a hero, unscrolled.
  const ghost = overHero && !scrolled;

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <header
        className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${
          ghost
            ? 'bg-transparent border-b border-transparent'
            : 'bg-white/90 backdrop-blur-md border-b border-surface-200 shadow-sm'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 group">
            {ghost ? (
              // White wordmark over the dark hero — no chip, blends into the hero.
              <img src="/nablon-logo-white.png" alt="Nablon AI" className="h-7 w-auto object-contain" />
            ) : (
              <img
                src="/logo.jpg"
                alt="Nablon AI"
                className="h-8 w-auto rounded-lg object-contain shadow-sm ring-1 ring-black/5"
              />
            )}
            <span
              className={`font-display font-bold hidden sm:block transition-colors ${
                ghost ? 'text-white/90' : 'text-gray-900'
              }`}
            >
              Careers
            </span>
          </Link>

          <nav className="flex items-center gap-1.5 sm:gap-2">
            <NavLink
              to="/jobs"
              className={({ isActive }) => {
                const base = 'text-sm font-medium px-3 py-2 rounded-lg transition-colors';
                if (ghost) {
                  return `${base} ${
                    isActive ? 'text-white bg-white/15' : 'text-brand-50/90 hover:text-white hover:bg-white/10'
                  }`;
                }
                return `${base} ${
                  isActive ? 'text-brand-600 bg-brand-50' : 'text-gray-600 hover:text-gray-900 hover:bg-surface-100'
                }`;
              }}
            >
              All Jobs
            </NavLink>

            {accessToken && user ? (
              <Link
                to={getHomeRoute(user.role)}
                className="text-sm font-medium px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors ml-1 shadow-sm shadow-brand-500/30"
              >
                Go to Portal
              </Link>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2 ml-1">
                <Link
                  to="/login"
                  className={`text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
                    ghost
                      ? 'text-white/90 hover:text-white hover:bg-white/10'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-surface-100'
                  }`}
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="text-sm font-medium px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors shadow-sm shadow-brand-500/30"
                >
                  Create account
                </Link>
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Hero pages slide under the transparent bar; other pages need clearance. */}
      <main className={`flex-1 ${overHero ? '' : 'pt-16'}`}>
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
