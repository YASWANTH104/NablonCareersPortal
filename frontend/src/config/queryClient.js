import { QueryClient, MutationCache } from '@tanstack/react-query';

// Queries derived from the whole pipeline rather than one record. Almost any
// HR write (stage move, interview booked or cancelled, feedback submitted,
// offer sent, hold toggled, assessment graded) can change what these show,
// so they're marked stale after every successful mutation instead of each of
// the ~30 mutation sites having to remember them. invalidateQueries refetches
// a mounted query immediately and marks an unmounted one stale, so the next
// visit fetches fresh data instead of serving the 2-minute cache below.
//
// A mutation that manages these caches itself (optimistic updates in the
// Action Center) opts out with `meta: { skipPipelineRefresh: true }`.
const PIPELINE_DERIVED_KEYS = [['action-center'], ['action-center-count']];

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, mutation) => {
      if (mutation.meta?.skipPipelineRefresh) return;
      PIPELINE_DERIVED_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,      // 2 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
