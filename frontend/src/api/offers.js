import client from './client';

export const offersApi = {
  // Templates
  listTemplates: () => client.get('/offers/templates'),
  createTemplate: (data) => client.post('/offers/templates', data),
  updateTemplate: (id, data) => client.put(`/offers/templates/${id}`, data),
  deleteTemplate: (id) => client.delete(`/offers/templates/${id}`),

  // Offer letters
  create: (data) => client.post('/offers', data),
  list: (params) => client.get('/offers', { params }),
  getById: (id) => client.get(`/offers/${id}`),
  getByApplication: (applicationId) => client.get(`/offers/by-application/${applicationId}`),
  update: (id, data) => client.put(`/offers/${id}`, data),
  send: (id) => client.post(`/offers/${id}/send`),
  preview: (id) => client.get(`/offers/${id}/preview`),
  revoke: (id) => client.post(`/offers/${id}/revoke`),

  // Public — no auth
  respond: (token, data) => client.post(`/offers/respond/${token}`, data),
};
