import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { titleCase } from '@/utils/formatters';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getPageTitle(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  // Detail routes end in an id (/hr/agencies/<uuid>, /hr/applicants/<uuid>) —
  // title-casing that renders the raw id in the topbar, so fall back to the
  // collection it belongs to.
  const segment = (UUID_RE.test(parts.at(-1) ?? '') ? parts.at(-2) : parts.at(-1)) ?? '';
  const map = {
    dashboard: 'Dashboard',
    jobs: 'Jobs',
    applicants: 'Applicants',
    interviews: 'Interviews',
    availability: 'Interviewer Availability',
    agencies: 'Agencies',
    referrals: 'Referrals',
    offers: 'Offers',
    reports: 'Reports',
    settings: 'Settings',
    refer: 'Refer a Candidate',
    'my-referrals': 'My Referrals',
    applications: 'My Applications',
    profile: 'Profile',
  };
  return map[segment] ?? titleCase(segment);
}

export default function AppShell() {
  const location = useLocation();
  const title = getPageTitle(location.pathname);

  return (
    <div className="flex h-[100dvh] bg-surface-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
