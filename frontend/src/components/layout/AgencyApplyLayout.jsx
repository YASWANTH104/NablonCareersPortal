import { Outlet } from 'react-router-dom';

export default function AgencyApplyLayout() {
  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <header className="border-b border-surface-200 bg-white sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <img src="/logo.jpg" alt="Nablon AI" className="h-8 w-auto rounded-lg object-contain" />
          <div className="h-5 w-px bg-surface-200" />
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-none">Nablon AI</p>
            <p className="text-xs text-gray-400 mt-0.5">Job Application</p>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-surface-200 bg-white py-5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} Nablon AI — All applications are treated confidentially
        </div>
      </footer>
    </div>
  );
}
