import client from './client';

export const dashboardApi = {
  stats: () => client.get('/dashboard/stats'),
  funnel: () => client.get('/dashboard/funnel'),
  timeToHire: () => client.get('/dashboard/time-to-hire'),
  activity: (limit = 10) => client.get('/dashboard/activity', { params: { limit } }),
};
