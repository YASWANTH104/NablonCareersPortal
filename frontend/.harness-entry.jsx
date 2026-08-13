import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyApplicationsPage from '@/pages/applicant/MyApplicationsPage';
import ProfilePage from '@/pages/applicant/ProfilePage';
import BrowseJobsPage from '@/pages/applicant/BrowseJobsPage';
import ReferPage from '@/pages/employee/ReferPage';
import MyReferralsPage from '@/pages/employee/MyReferralsPage';

const PAGES = {
  applications: MyApplicationsPage,
  profile: ProfilePage,
  jobs: BrowseJobsPage,
  refer: ReferPage,
  referrals: MyReferralsPage,
};

const which = new URLSearchParams(location.search).get('page') ?? 'applications';
const Page = PAGES[which];

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={qc}>
    <MemoryRouter>
      {/* Mirrors AppShell's content wrapper so spacing matches the real app. */}
      <div className="min-h-screen bg-surface-50">
        <div className="px-4 py-6 sm:px-6 sm:py-8">
          <Page />
        </div>
      </div>
    </MemoryRouter>
  </QueryClientProvider>
);
