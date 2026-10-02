import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { getHomeRoute } from '@/utils/permissions';

// Routes whose first screenful is the dark gray-950 hero — the nav floats over
// these transparently until you scroll. Everything else (e.g. the apply page,
// which has a light top) gets the solid white bar from the start.
function usesDarkHero(pathname) {
  if (pathname === '/' || pathname === '/jobs') return true;
  return /^\/jobs\/[^/]+$/.test(pathname); // /jobs/:slug but NOT /jobs/:slug/apply
}

// One transparent PNG used as a mask, filled white over the dark hero and
// logo-blue elsewhere — logo.jpg has a solid white background that shows as
// a box on translucent glass. 2060x375 source, so width = height x 5.49.
function Wordmark({ light }) {
  const mask = {
    WebkitMaskImage: 'url(/nablon-logo-white.png)',
    maskImage: 'url(/nablon-logo-white.png)',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
  };
  return (
    <span
      aria-hidden="true"
      className={`block h-[18px] w-[99px] transition-colors duration-300 ${light ? 'bg-white' : 'bg-[#0237DD]'}`}
      style={mask}
    />
  );
}

export default function PublicLayout() {
  const { user, accessToken } = useAuthStore();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile menu whenever the route changes, and lock body scroll while open.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const overHero = usesDarkHero(pathname);
  // Dark-tinted glass with white text while sitting on a dark hero, unscrolled;
  // frosted white glass everywhere else (and whenever the menu is open).
  const ghost = overHero && !scrolled && !menuOpen;

  // Capsule tint: dark glass + white text over the dark hero, frosted white
  // everywhere else. A touch more opaque once scrolled over page content.
  const glass = `liquid-glass ${ghost ? 'liquid-glass--dark' : `liquid-glass--light ${scrolled ? 'is-raised' : ''}`}`;
  const link = 'text-[13px] font-medium px-3.5 h-9 inline-flex items-center rounded-full transition-colors duration-200';
  const quietLink = ghost
    ? 'text-white/80 hover:text-white hover:bg-white/10'
    : 'text-gray-600 hover:text-gray-900 hover:bg-black/[0.04]';
  const navLinkClass = ({ isActive }) =>
    `${link} ${
      isActive
        ? ghost ? 'text-white bg-white/[0.14]' : 'text-gray-900 bg-black/[0.06]'
        : quietLink
    }`;
  const cta =
    'text-[13px] font-semibold text-white px-4 h-9 inline-flex items-center rounded-full bg-brand-500 hover:bg-brand-600 ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-colors duration-200 active:scale-[0.98]';
  const portalPath = accessToken && user ? getHomeRoute(user.role) : null;

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <header className="fixed top-0 inset-x-0 z-40 pt-3 pointer-events-none">
        {/* Same container as the page content. The capsule bleeds 12px past it
            on each side (-mx-3) and pads the logo back in (pl-3), so the logo
            sits exactly on the hero copy's left edge. */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className={`${glass} pointer-events-auto h-14 -mx-3 pl-3 pr-2 flex items-center justify-between gap-3`}>
          <Link
            to="/"
            aria-label="Nablon AI Careers — home"
            className="h-full flex items-center gap-3 flex-shrink-0"
          >
            <Wordmark light={ghost} />
            <span className={`hidden sm:block h-4 w-px ${ghost ? 'bg-white/20' : 'bg-black/10'}`} />
            <span
              className={`hidden sm:block text-[13px] font-semibold tracking-tight transition-colors ${
                ghost ? 'text-white/85' : 'text-gray-700'
              }`}
            >
              Careers
            </span>
          </Link>

          <div className="flex items-center gap-0.5">
            {/* Desktop */}
            <nav className="hidden sm:flex items-center gap-0.5">
              <NavLink to="/jobs" className={navLinkClass}>
                All Jobs
              </NavLink>
              {portalPath ? (
                <Link to={portalPath} className={`${cta} ml-1`}>
                  Go to Portal
                </Link>
              ) : (
                <>
                  <Link to="/login" className={`${link} ${quietLink}`}>
                    Sign in
                  </Link>
                  <Link to="/register" className={`${cta} ml-1`}>
                    Create account
                  </Link>
                </>
              )}
            </nav>

            {/* Mobile */}
            <div className="flex sm:hidden items-center gap-0.5">
              <Link to={portalPath ?? '/register'} className={cta}>
                {portalPath ? 'Portal' : 'Create account'}
              </Link>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
                  ghost ? 'text-white hover:bg-white/10' : 'text-gray-700 hover:bg-black/[0.05]'
                }`}
              >
                {menuOpen ? <X className="w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px]" />}
              </button>
            </div>
          </div>
          </div>
        </div>

        {/* Mobile menu — a glass sheet under the capsule, same width */}
        {menuOpen && (
          <div className="sm:hidden max-w-7xl mx-auto px-4">
            <nav className="liquid-glass liquid-glass--light is-raised rounded-3xl pointer-events-auto mt-2 -mx-3 p-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
              <NavLink
                to="/jobs"
                className={({ isActive }) =>
                  `block text-sm font-medium px-4 py-2.5 rounded-2xl transition-colors ${
                    isActive ? 'text-gray-900 bg-black/[0.06]' : 'text-gray-700 hover:bg-black/[0.04]'
                  }`
                }
              >
                All Jobs
              </NavLink>
              {!portalPath && (
                <Link
                  to="/login"
                  className="block text-sm font-medium px-4 py-2.5 rounded-2xl text-gray-700 hover:bg-black/[0.04] transition-colors"
                >
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Hero pages slide under the floating bar; other pages need clearance
          (12px offset + 56px capsule + breathing room). */}
      <main className={`flex-1 ${overHero ? '' : 'pt-20'}`}>
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
