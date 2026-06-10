import client from './client';

export const jobsApi = {
  listPublic: (params) => client.get('/jobs', { params }),
  list: (params) => client.get('/jobs', { params }),
  listDepartments: () => client.get('/jobs/departments'),
  getBySlug: (slug) => client.get(`/jobs/${slug}`),
  getById: (id) => client.get(`/jobs/${id}`),
  create: (data) => client.post('/jobs', data),
  update: (id, data) => client.put(`/jobs/${id}`, data),
  updateStatus: (id, status) => client.patch(`/jobs/${id}/status`, { status }),
  remove: (id) => client.delete(`/jobs/${id}`),
  getQuestions: (id) => client.get(`/jobs/${id}/questions`),
  addQuestion: (id, data) => client.post(`/jobs/${id}/questions`, data),
  removeQuestion: (id, qid) => client.delete(`/jobs/${id}/questions/${qid}`),
};
