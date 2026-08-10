import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

import { queryClient } from '@/config/queryClient';

// Layouts
import PublicLayout from '@/components/layout/PublicLayout';
import AppShell from '@/components/layout/AppShell';
import ProtectedRoute from '@/components/shared/ProtectedRoute';

// Auth pages
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import MicrosoftCallbackPage from '@/pages/auth/MicrosoftCallbackPage';

// Public pages
import LandingPage from '@/pages/public/LandingPage';
import JobsPage from '@/pages/public/JobsPage';
import JobDetailPage from '@/pages/public/JobDetailPage';
import ApplyPage from '@/pages/public/ApplyPage';

// Applicant portal
import MyApplicationsPage from '@/pages/applicant/MyApplicationsPage';
import ProfilePage from '@/pages/applicant/ProfilePage';
import BrowseJobsPage from '@/pages/applicant/BrowseJobsPage';

// Employee hub
import ReferPage from '@/pages/employee/ReferPage';
import MyReferralsPage from '@/pages/employee/MyReferralsPage';

// HR console
import DashboardPage from '@/pages/hr/DashboardPage';
import HRJobsPage from '@/pages/hr/JobsPage';
import JobEditPage from '@/pages/hr/JobEditPage';
import ApplicantsPage from '@/pages/hr/ApplicantsPage';
import ApplicationDetailPage from '@/pages/hr/ApplicationDetailPage';
import ReferralsPage from '@/pages/hr/ReferralsPage';
import InterviewsPage from '@/pages/hr/InterviewsPage';
import OffersPage from '@/pages/hr/OffersPage';
import OfferBuilderPage from '@/pages/hr/OfferBuilderPage';
import OfferRespondPage from '@/pages/public/OfferRespondPage';
import DirectorReviewPage from '@/pages/public/DirectorReviewPage';
import DocumentUploadPage from '@/pages/public/DocumentUploadPage';
import ScreeningFormPage from '@/pages/public/ScreeningFormPage';
import ReportsPage from '@/pages/hr/ReportsPage';
import SettingsPage from '@/pages/hr/SettingsPage';
import AgenciesPage from '@/pages/hr/AgenciesPage';
import AgencyPortalPage from '@/pages/public/AgencyPortalPage';
import InterviewFeedbackPage from '@/pages/public/InterviewFeedbackPage';
import AgencyApplyLayout from '@/components/layout/AgencyApplyLayout';

const router = createBrowserRouter([
  // ── PUBLIC ──────────────────────────────────────────────────
  {
    path: '/',
    element: <PublicLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'jobs', element: <JobsPage /> },
      { path: 'jobs/:slug', element: <JobDetailPage /> },
      { path: 'jobs/:slug/apply', element: <ApplyPage /> },
    ],
  },

  // ── AUTH ────────────────────────────────────────────────────
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ResetPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/auth/microsoft/callback', element: <MicrosoftCallbackPage /> },

  // ── APPLICANT PORTAL ────────────────────────────────────────
  {
    element: <ProtectedRoute roles={['applicant']} />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/portal/applications', element: <MyApplicationsPage /> },
          { path: '/portal/profile', element: <ProfilePage /> },
          { path: '/portal/jobs', element: <BrowseJobsPage /> },
        ],
      },
    ],
  },

  // ── EMPLOYEE HUB ────────────────────────────────────────────
  {
    element: <ProtectedRoute roles={['employee', 'hr_manager', 'admin', 'super_admin', 'interviewer']} />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/employee/refer', element: <ReferPage /> },
          { path: '/employee/my-referrals', element: <MyReferralsPage /> },
          { path: '/employee/jobs', element: <BrowseJobsPage /> },
        ],
      },
    ],
  },

  // ── HR CONSOLE ──────────────────────────────────────────────
  {
    element: <ProtectedRoute roles={['hr_manager', 'admin', 'super_admin']} />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/hr/dashboard', element: <DashboardPage /> },
          { path: '/hr/jobs', element: <HRJobsPage /> },
          { path: '/hr/jobs/new', element: <JobEditPage /> },
          { path: '/hr/jobs/:id/edit', element: <JobEditPage /> },
          { path: '/hr/applicants', element: <ApplicantsPage /> },
          { path: '/hr/applicants/:id', element: <ApplicationDetailPage /> },
          { path: '/hr/referrals', element: <ReferralsPage /> },
          { path: '/hr/offers', element: <OffersPage /> },
          { path: '/hr/offers/new/:applicationId', element: <OfferBuilderPage /> },
          { path: '/hr/offers/:offerId', element: <OfferBuilderPage /> },
          { path: '/hr/reports', element: <ReportsPage /> },
          { path: '/hr/settings', element: <SettingsPage /> },
          { path: '/hr/agencies', element: <AgenciesPage /> },
        ],
      },
    ],
  },

  // ── INTERVIEWER ─────────────────────────────────────────────
  {
    element: <ProtectedRoute roles={['interviewer', 'hr_manager', 'admin', 'super_admin']} />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/hr/interviews', element: <InterviewsPage /> },
        ],
      },
    ],
  },

  // ── PUBLIC OFFER RESPOND ────────────────────────────────────
  { path: '/offers/respond/:token', element: <OfferRespondPage /> },

  // ── PUBLIC DIRECTOR APPROVAL ─────────────────────────────────
  { path: '/offers/director-review/:token', element: <DirectorReviewPage /> },

  // ── PUBLIC DOCUMENT SUBMISSION ──────────────────────────────
  { path: '/docs/submit/:token', element: <DocumentUploadPage /> },

  // ── PUBLIC SCREENING FORM (from email link) ─────────────────
  { path: '/screening/:token', element: <ScreeningFormPage /> },

  // ── PUBLIC INTERVIEWER FEEDBACK (from email link) ───────────
  { path: '/interviews/feedback/:token', element: <InterviewFeedbackPage /> },

  // ── AGENCY PORTAL ───────────────────────────────────────────
  { path: '/agency/:portalToken', element: <AgencyPortalPage /> },

  // ── AGENCY APPLY (focused, no nav) ──────────────────────────
  {
    path: '/agency-apply',
    element: <AgencyApplyLayout />,
    children: [
      { path: ':slug', element: <JobDetailPage /> },
      { path: ':slug/apply', element: <ApplyPage /> },
    ],
  },

  // ── FALLBACK ────────────────────────────────────────────────
  { path: '*', element: <Navigate to="/jobs" replace /> },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#111827',
            color: '#F9FAFB',
            fontSize: '14px',
            borderRadius: '10px',
          },
        }}
      />
    </QueryClientProvider>
  );
}
