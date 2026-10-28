import client from './client';

export const scheduledReportsApi = {
  getSettings: () => client.get('/scheduled-reports/settings'),
  updateSettings: (data) => client.put('/scheduled-reports/settings', data),
  sendPreview: (kind) => client.post('/scheduled-reports/preview', null, { params: { kind } }),
};
