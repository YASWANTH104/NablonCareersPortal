import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Users, Star, Calendar,
  FileText, BarChart2, Settings, LogOut, ChevronLeft,
  ChevronRight, UserCheck, Award, AlertTriangle, Building2, X, CalendarClock,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { HR_ROLES, ROLES } from '@/utils/permissions';
import { cn } from '@/lib/utils';

const NAV_ITEMS = {
  hr: [
    { to: '/hr/dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
    { to: '/hr/jobs',        label: 'Jobs',         icon: Briefcase },
    { to: '/hr/applicants',  label: 'Applicants',   icon: Users },
    { to: '/hr/interviews',  label: 'Interviews',   icon: Calendar },
    { to: '/hr/availability', label: 'Interviewer Availability', icon: CalendarClock },
    { to: '/hr/referrals',   label: 'Referrals',    icon: UserCheck },
    { to: '/hr/offers',      label: 'Offers',       icon: FileText },
    { to: '/hr/agencies',    label: 'Agencies',     icon: Building2 },
    { to: '/hr/reports',     label: 'Reports',      icon: BarChart2 },
    { to: '/hr/settings',    label: 'Settings',     icon: Settings },
  ],
  interviewer: [
    { to: '/hr/interviews',         label: 'My Interviews',     icon: Calendar },
    { to: '/hr/availability',       label: 'My Availability',   icon: CalendarClock },
    { to: '/employee/refer',        label: 'Refer a Candidate', icon: UserCheck },
    { to: '/employee/my-referrals', label: 'My Referrals',      icon: Award },
    { to: '/employee/jobs',         label: 'Browse Jobs',       icon: Briefcase },
  ],
  employee: [
    { to: '/employee/refer',         label: 'Refer a Candidate', icon: UserCheck },
    { to: '/employee/my-referrals',  label: 'My Referrals',      icon: Award },
    { to: '/employee/jobs',          label: 'Browse Jobs',       icon: Briefcase },
  ],
  applicant: [
    { to: '/portal/applications', label: 'My Applications', icon: FileText },
    { to: '/portal/profile',      label: 'Profile',          icon: Users },
    { to: '/portal/jobs',         label: 'Browse Jobs',      icon: Briefcase },
  ],
};

function getNavItems(role) {
  if (HR_ROLES.includes(role)) return NAV_ITEMS.hr;
  if (role === ROLES.INTERVIEWER) return NAV_ITEMS.interviewer;
  if (role === ROLES.EMPLOYEE) return NAV_ITEMS.employee;
  return NAV_ITEMS.applicant;
}

export default function Sidebar() {
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, closeMobileNav } = useUIStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const navItems = getNavItems(user?.role);

  // Navigating always dismisses the mobile drawer.
  useEffect(() => {
    closeMobileNav();
  }, [pathname, closeMobileNav]);

  // Lock body scroll behind the drawer, and close it on Escape.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') closeMobileNav(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileNavOpen, closeMobileNav]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Collapse only applies from lg up — the drawer is always full width on mobile.
  const collapsed = sidebarCollapsed;

  return (
    <>
      {/* Scrim — mobile only */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={closeMobileNav}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'flex flex-col bg-white border-r border-surface-200',
          // Mobile: fixed off-canvas drawer.
          'fixed inset-y-0 left-0 z-50 w-[17rem] max-w-[85vw] transform transition-transform duration-200',
          mobileNavOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          // Desktop: in-flow rail, always visible.
          'lg:relative lg:translate-x-0 lg:shadow-none lg:transition-all lg:max-w-none',
          collapsed ? 'lg:w-16' : 'lg:w-60'
        )}
      >
        {/* Logo. `overflow-hidden` matters: without it the close button is pushed
            past the panel's right edge by the full-width logo and, while the
            drawer sits off-canvas, still lands on top of the topbar hamburger
            and eats the tap that is supposed to open it. */}
        <div className="flex items-center gap-2 px-4 h-16 border-b border-surface-200 overflow-hidden">
          <img
            src="/logo.jpg"
            alt="Nablon AI"
            className="flex-1 min-w-0 h-8 rounded-lg object-cover"
          />
          <button
            onClick={closeMobileNav}
            aria-label="Close menu"
            className="lg:hidden p-2 -mr-2 rounded-lg text-gray-500 hover:bg-surface-100 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 lg:py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-600'
                    : 'text-gray-600 hover:bg-surface-100 hover:text-gray-900'
                )
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className={cn('truncate', collapsed && 'lg:hidden')}>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User info + logout */}
        <div className="border-t border-surface-200 p-2">
          {user && (
            <div className={cn('px-3 py-2 mb-1', collapsed && 'lg:hidden')}>
              <p className="text-sm font-medium text-gray-900 truncate">{user.full_name}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          )}
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className={cn(collapsed && 'lg:hidden')}>Sign out</span>
          </button>
        </div>

        {/* Collapse toggle — desktop only; on mobile the drawer has its own close button. */}
        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 rounded-full bg-white border border-surface-200 items-center justify-center shadow-sm hover:bg-surface-50 transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3 text-gray-500" />
          ) : (
            <ChevronLeft className="w-3 h-3 text-gray-500" />
          )}
        </button>
      </aside>

      {/* Sign out confirmation modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 sm:p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Sign out?</h3>
                <p className="text-sm text-gray-500">You will need to sign in again to access your account.</p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end mt-4">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
