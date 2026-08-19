import client from './client';

export const resourcesApi = {
  onboardableUsers: () => client.get('/resources/onboardable-users'),
  stats: () => client.get('/resources/stats'),
  search: (query) => client.post('/resources/search', { query }),

  list: (params) => client.get('/resources', { params }),
  create: (data) => client.post('/resources', data),
  get: (id) => client.get(`/resources/${id}`),
  update: (id, data) => client.patch(`/resources/${id}`, data),
  uploadResume: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post(`/resources/${id}/resume`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  projects: {
    list: (params) => client.get('/resources/projects', { params }),
    create: (data) => client.post('/resources/projects', data),
    get: (id) => client.get(`/resources/projects/${id}`),
    update: (id, data) => client.patch(`/resources/projects/${id}`, data),
  },

  allocations: {
    create: (profileId, data) => client.post(`/resources/${profileId}/allocations`, data),
    update: (allocationId, data) => client.patch(`/resources/allocations/${allocationId}`, data),
    end: (allocationId) => client.post(`/resources/allocations/${allocationId}/end`),
    remove: (allocationId) => client.delete(`/resources/allocations/${allocationId}`),
  },
};
