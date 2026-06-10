import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, X, LogOut, User, ChevronRight, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { notificationsApi } from '@/api/notifications';
import { jobsApi } from '@/api/jobs';
import { applicationsApi } from '@/api/applications';
import { HR_ROLES, ROLES, getHomeRoute } from '@/utils/permissions';

// ── Notification Dropdown ─────────────────────────────────────────────────────

function NotificationDropdown({ onClose }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 20 }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const markReadMut = useMutation({
    mutationFn: (id) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = data?.items ?? [];

  function handleClick(n) {
    if (!n.is_read) markReadMut.mutate(n.id);
    if (n.link) navigate(n.link);
    onClose();
  }

  return (
    <div className="absolute right-0 top-11 z-50 w-80 bg-white border border-surface-200 rounded-xl shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200">
        <span className="text-sm font-semibold text-gray-900">Notifications</span>
        {(data?.unread_count ?? 0) > 0 && (
          <button
            onClick={() => markAllMut.mutate()}
            className="text-xs text-brand-600 hover:text-brand-800 font-medium"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {items.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No notifications</div>
        ) : (
          items.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-left px-4 py-3 border-b border-surface-100 hover:bg-surface-50 transition-colors ${!n.is_read ? 'bg-brand-50/40' : ''}`}
            >
              <div className="flex items-start gap-2">
                {!n.is_read && (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
                )}
                <div className={`flex-1 min-w-0 ${n.is_read ? 'ml-3.5' : ''}`}>
                  <p className="text-xs font-semibold text-gray-900 truncate">{n.title}</p>
                  {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                  <p className="text-xs text-gray-300 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Search Modal ──────────────────────────────────────────────────────────────

function SearchModal({ onClose, userRole }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const isHR = HR_ROLES.includes(userRole);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const { data: jobResults, isLoading: jobsLoading } = useQuery({
    queryKey: ['search-jobs', query],
    queryFn: () => jobsApi.list({ search: query, limit: 5 }).then((r) => r.data),
    enabled: query.length >= 2,
  });

  const { data: appResults, isLoading: appsLoading } = useQuery({
    queryKey: ['search-applications', query],
    queryFn: () => applicationsApi.list({ search: query, limit: 5 }).then((r) => r.data),
    enabled: query.length >= 2 && isHR,
  });

  const jobs = jobResults?.items ?? [];
  const apps = appResults?.items ?? [];
  const isLoading = jobsLoading || (isHR && appsLoading);
  const hasResults = jobs.length > 0 || apps.length > 0;

  const handleJobClick = (job) => {
    navigate(isHR ? `/hr/jobs` : `/jobs/${job.slug}`);
    onClose();
  };

  const handleAppClick = (app) => {
    navigate(`/hr/applicants/${app.id}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40 px-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-200">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isHR ? 'Search jobs or applicants…' : 'Search open roles…'}
            className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 bg-surface-100 text-gray-400 text-xs rounded border border-surface-200">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {query.length < 2 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              Type at least 2 characters to search
            </div>
          ) : isLoading ? (
            <div className="py-10 text-center text-sm text-gray-400">Searching…</div>
          ) : !hasResults ? (
            <div className="py-10 text-center text-sm text-gray-400">No results for "{query}"</div>
          ) : (
            <>
              {/* Job results */}
              {jobs.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Jobs</p>
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => handleJobClick(job)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-50 text-left transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{job.title}</p>
                        {job.location && <p className="text-xs text-gray-500 mt-0.5">{job.location}</p>}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* Applicant results (HR only) */}
              {isHR && apps.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide border-t border-surface-100">Applicants</p>
                  {apps.map((app) => (
                    <button
                      key={app.id}
                      onClick={() => handleAppClick(app)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-50 text-left transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{app.applicant?.full_name ?? 'Unknown'}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{app.applicant?.email}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Account Dropdown ──────────────────────────────────────────────────────────

function AccountDropdown({ user, onClose, onSignOut }) {
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [onClose]);

  const roleBadge = {
    super_admin: { label: 'Super Admin', color: 'bg-purple-100 text-purple-700' },
    admin: { label: 'Admin', color: 'bg-indigo-100 text-indigo-700' },
    hr_manager: { label: 'HR Manager', color: 'bg-blue-100 text-blue-700' },
    interviewer: { label: 'Interviewer', color: 'bg-teal-100 text-teal-700' },
    employee: { label: 'Employee', color: 'bg-green-100 text-green-700' },
    applicant: { label: 'Applicant', color: 'bg-gray-100 text-gray-600' },
  }[user?.role] ?? { label: user?.role, color: 'bg-gray-100 text-gray-600' };

  const profileRoute = HR_ROLES.includes(user?.role)
    ? '/hr/settings'
    : user?.role === ROLES.INTERVIEWER || user?.role === ROLES.EMPLOYEE
    ? '/hr/settings'
    : '/portal/profile';

  return (
    <div ref={ref} className="absolute right-0 top-11 z-50 w-64 bg-white border border-surface-200 rounded-xl shadow-xl overflow-hidden">
      {/* User info */}
      <div className="px-4 py-3 border-b border-surface-200 bg-surface-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
            <span className="text-brand-700 font-semibold text-sm">
              {user?.full_name?.charAt(0)?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.full_name}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </div>
        <span className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge.color}`}>
          {roleBadge.label}
        </span>
      </div>

      {/* Actions */}
      <div className="py-1">
        <button
          onClick={() => { navigate(profileRoute); onClose(); }}
          className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-surface-50 transition-colors"
        >
          <User className="w-4 h-4 text-gray-400" />
          Profile &amp; Settings
        </button>
        <div className="border-t border-surface-100 mt-1 pt-1">
          <button
            onClick={() => { onClose(); onSignOut(); }}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Topbar ────────────────────────────────────────────────────────────────────

export default function Topbar({ title }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [showNotifs, setShowNotifs] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const notifRef = useRef(null);
  const accountRef = useRef(null);

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 20 }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const unreadCount = notifData?.unread_count ?? 0;

  // Keyboard shortcut Cmd/Ctrl + K to open search
  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    function handleOutside(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifs(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate('/login');
  };

  return (
    <>
      <header className="h-16 border-b border-surface-200 bg-white flex items-center justify-between px-6">
        <h1 className="text-lg font-display font-semibold text-gray-900">{title}</h1>

        <div className="flex items-center gap-2">
          {/* Search button */}
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 h-9 px-3 rounded-lg text-gray-500 hover:bg-surface-100 transition-colors border border-surface-200 text-sm"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline text-xs text-gray-400">Search</span>
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 bg-surface-100 text-gray-400 text-xs rounded">
              ⌘K
            </kbd>
          </button>

          {/* Notification bell */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setShowNotifs((v) => !v)}
              className="relative w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-surface-100 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 rounded-full bg-brand-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {showNotifs && <NotificationDropdown onClose={() => setShowNotifs(false)} />}
          </div>

          {/* Account avatar */}
          <div ref={accountRef} className="relative">
            <button
              onClick={() => setShowAccount((v) => !v)}
              className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center hover:ring-2 hover:ring-brand-300 transition-all"
            >
              <span className="text-brand-700 font-semibold text-sm">
                {user?.full_name?.charAt(0)?.toUpperCase() ?? '?'}
              </span>
            </button>
            {showAccount && (
              <AccountDropdown
                user={user}
                onClose={() => setShowAccount(false)}
                onSignOut={() => setShowLogoutConfirm(true)}
              />
            )}
          </div>
        </div>
      </header>

      {/* Search modal */}
      {showSearch && (
        <SearchModal onClose={() => setShowSearch(false)} userRole={user?.role} />
      )}

      {/* Sign out confirmation */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Sign out?</h3>
                <p className="text-sm text-gray-500">You will need to sign in again to continue.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-4">
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
