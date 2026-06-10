import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { queryClient } from '@/config/queryClient';

const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      setUser: (user) => set({ user }),

      login: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),

      logout: () => {
        queryClient.clear();
        set({ user: null, accessToken: null, refreshToken: null });
      },

      updateAccessToken: (accessToken) => set({ accessToken }),

      isAuthenticated: () => !!get().accessToken,

      hasRole: (...roles) => {
        const user = get().user;
        return user ? roles.includes(user.role) : false;
      },
    }),
    {
      name: 'nablon-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    }
  )
);

export { useAuthStore };
