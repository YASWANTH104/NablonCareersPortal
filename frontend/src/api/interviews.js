import client from './client';

export const interviewsApi = {
  create: (data) => client.post('/interviews', data),
  list: (params) => client.get('/interviews', { params }),
  mine: (params) => client.get('/interviews/mine', { params }),
  getById: (id) => client.get(`/interviews/${id}`),
  update: (id, data) => client.patch(`/interviews/${id}`, data),
  complete: (id, data = {}) => client.patch(`/interviews/${id}/complete`, data),
  cancel: (id) => client.delete(`/interviews/${id}`),
  submitFeedback: (id, data) => client.post(`/interviews/${id}/feedback`, data),
  getFeedback: (id) => client.get(`/interviews/${id}/feedback`),
};
