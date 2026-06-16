import client from './client';

export const agenciesApi = {
  list: () => client.get('/agencies'),
  create: (data) => client.post('/agencies', data),
  update: (id, data) => client.patch(`/agencies/${id}`, data),
  assignToJob: (jobId, data) => client.post(`/jobs/${jobId}/agencies`, data),
  listJobAgencies: (jobId) => client.get(`/jobs/${jobId}/agencies`),
  listAgencyAssignments: (agencyId) => client.get(`/agencies/${agencyId}/assignments`),
  removeAssignment: (assignmentId) => client.delete(`/agencies/assignments/${assignmentId}`),
  portal: (portalToken) => client.get(`/agency-portal/${portalToken}`),
  portalAssignment: (portalToken, assignmentId) =>
    client.get(`/agency-portal/${portalToken}/assignments/${assignmentId}`),
};
