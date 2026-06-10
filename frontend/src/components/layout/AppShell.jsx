import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { titleCase } from '@/utils/formatters';

function getPageTitle(pathname) {
  const segment = pathname.split('/').filter(Boolean).pop() ?? '';
  const map = {
    dashboard: 'Dashboard',
    jobs: 'Jobs',
    applicants: 'Applicants',
    interviews: 'Interviews',
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
    <div className="flex h-screen bg-surface-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
