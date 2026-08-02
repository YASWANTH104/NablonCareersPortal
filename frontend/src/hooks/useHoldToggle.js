import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { applicationsApi } from '@/api/applications';

// Shared across Kanban/Table/Detail views — patches whichever cached shape
// `queryKey` points at (a paginated `{items:[...]}` list or a single detail object).
function patchApplication(old, id, patch) {
  if (!old) return old;
  if (Array.isArray(old.items)) {
    return { ...old, items: old.items.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
  }
  if (old.id === id) return { ...old, ...patch };
  return old;
}

export function useHoldToggle(queryKey) {
  const queryClient = useQueryClient();
  const [pendingHold, setPendingHold] = useState(null); // application being put on hold

  const holdMutation = useMutation({
    mutationFn: ({ id, on_hold, hold_reason }) => applicationsApi.setHold(id, on_hold, hold_reason),
    onMutate: async ({ id, on_hold, hold_reason }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) =>
        patchApplication(old, id, { on_hold, hold_reason: on_hold ? hold_reason : null })
      );
      return { prev };
    },
    onError: (err, _, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error(err.response?.data?.detail ?? 'Could not update hold status');
    },
    onSuccess: (_res, { on_hold }) => {
      setPendingHold(null);
      toast.success(on_hold ? 'Candidate put on hold' : 'Resumed — back in their current stage');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-applications'] });
      queryClient.invalidateQueries({ queryKey: ['application-detail'] });
    },
  });

  function toggleHold(app) {
    if (app.on_hold) {
      holdMutation.mutate({ id: app.id, on_hold: false, hold_reason: null });
    } else {
      setPendingHold(app);
    }
  }

  return { pendingHold, setPendingHold, holdMutation, toggleHold };
}
