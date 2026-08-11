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
  portalParseResume: (portalToken, file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post(`/agency-portal/${portalToken}/parse-resume`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  portalSubmitCandidate: (portalToken, assignmentId, { resume, ...fields }) => {
    const form = new FormData();
    form.append('resume', resume);
    Object.entries(fields).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') form.append(key, val);
    });
    return client.post(
      `/agency-portal/${portalToken}/assignments/${assignmentId}/submit`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
  },
  portalAvailableSlots: (portalToken, assignmentId) =>
    client.get(`/agency-portal/${portalToken}/assignments/${assignmentId}/slots`),
  portalBookSlot: (portalToken, assignmentId, data) =>
    client.post(`/agency-portal/${portalToken}/assignments/${assignmentId}/slots/book`, data),
};
