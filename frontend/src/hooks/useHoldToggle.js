import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { applicationsApi } from '@/api/applications';

// Shared across Kanban/Table/Detail views — patches whichever cached shape
// `queryKey` points at: a paginated `{items:[...]}` list, an infinite-query
// `{pages:[{items:[...]}, ...]}` cache (Kanban's per-stage columns), or a
// single detail object.
function patchApplication(old, id, patch) {
  if (!old) return old;
  if (Array.isArray(old.pages)) {
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        items: page.items.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      })),
    };
  }
  if (Array.isArray(old.items)) {
    return { ...old, items: old.items.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
  }
  if (old.id === id) return { ...old, ...patch };
  return old;
}

// `queryKey` is either a static key (Table/Detail — one list for every card)
// or a resolver `(app) => queryKey` for views like Kanban where each card
// lives in its own per-stage cache.
export function useHoldToggle(queryKey) {
  const queryClient = useQueryClient();
  const [pendingHold, setPendingHold] = useState(null); // application being put on hold
  const resolveKey = (app) => (typeof queryKey === 'function' ? queryKey(app) : queryKey);

  const holdMutation = useMutation({
    mutationFn: ({ id, on_hold, hold_reason }) => applicationsApi.setHold(id, on_hold, hold_reason),
    onMutate: async ({ id, on_hold, hold_reason, app }) => {
      const key = resolveKey(app);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old) =>
        patchApplication(old, id, { on_hold, hold_reason: on_hold ? hold_reason : null })
      );
      return { prev, key };
    },
    onError: (err, _, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      toast.error(err.response?.data?.detail ?? 'Could not update hold status');
    },
    onSuccess: (_res, { on_hold }) => {
      setPendingHold(null);
      toast.success(on_hold ? 'Candidate put on hold' : 'Resumed — back in their current stage');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-applications'] });
      queryClient.invalidateQueries({ queryKey: ['kanban-stage'] });
      queryClient.invalidateQueries({ queryKey: ['application-detail'] });
    },
  });

  function toggleHold(app) {
    if (app.on_hold) {
      holdMutation.mutate({ id: app.id, on_hold: false, hold_reason: null, app });
    } else {
      setPendingHold(app);
    }
  }

  return { pendingHold, setPendingHold, holdMutation, toggleHold };
}
