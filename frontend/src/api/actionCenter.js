import client from './client';

export const actionCenterApi = {
  list: (params) => client.get('/action-center', { params }),
  count: () => client.get('/action-center/count'),
  snooze: (data) => client.post('/action-center/snoozes', data),
  unsnooze: (applicationId, actionType) =>
    client.delete(`/action-center/snoozes/${applicationId}/${actionType}`),
};
