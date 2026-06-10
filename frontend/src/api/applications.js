import client from './client';

export const applicationsApi = {
  submit: (data) => client.post('/applications', data),
  mine: (page = 1, limit = 10) => client.get('/applications/mine', { params: { page, limit } }),
  list: (params) => client.get('/applications', { params }),
  getById: (id) => client.get(`/applications/${id}`),
  moveStage: (id, stage, notes) => client.patch(`/applications/${id}/stage`, { stage, notes }),
  assign: (id, assigneeId) => client.patch(`/applications/${id}/assign`, { assignee_id: assigneeId }),
  toggleStar: (id) => client.patch(`/applications/${id}/star`),
  setRating: (id, rating) => client.patch(`/applications/${id}/rating`, { rating }),
  addNote: (id, note) => client.post(`/applications/${id}/notes`, { note }),
  getTimeline: (id) => client.get(`/applications/${id}/timeline`),
  withdraw: (id) => client.delete(`/applications/${id}/withdraw`),
  export: (params) => client.get('/applications/export', { params, responseType: 'blob' }),
};
