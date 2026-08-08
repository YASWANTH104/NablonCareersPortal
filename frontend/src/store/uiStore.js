import { create } from 'zustand';

const useUIStore = create((set) => ({
  // Desktop-only rail collapse (icon-only sidebar).
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (val) => set({ sidebarCollapsed: val }),

  // Mobile off-canvas drawer — separate from the desktop collapse so the two
  // never fight each other when the viewport crosses the lg breakpoint.
  mobileNavOpen: false,
  openMobileNav: () => set({ mobileNavOpen: true }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),

  darkMode: false,
  toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
}));

export { useUIStore };
