import client from './client';

export const assessmentsApi = {
  create: (data) => client.post('/assessments', data),
  bulkCreate: (data) => client.post('/assessments/bulk', data),
  list: (params) => client.get('/assessments', { params }),
  getById: (id) => client.get(`/assessments/${id}`),
  update: (id, data) => client.patch(`/assessments/${id}`, data),
  cancel: (id) => client.delete(`/assessments/${id}`),
};
