import client from './client';

export const jobsApi = {
  listPublic: (params) => client.get('/jobs', { params }),
  // Jobs the caller is actually allowed to refer someone for. HR hitting the
  // plain list gets the admin view (every job, any status, filters ignored),
  // which the Refer a Candidate page must never show — `for_referral` pins it
  // to the same published + referrals-allowed set everyone else sees.
  listReferable: (params) => client.get('/jobs', { params: { ...params, for_referral: true } }),
  list: (params) => client.get('/jobs', { params }),
  listDepartments: () => client.get('/jobs/departments'),
  createDepartment: (name) => client.post('/jobs/departments', { name }),
  updateDepartment: (id, name) => client.put(`/jobs/departments/${id}`, { name }),
  deleteDepartment: (id) => client.delete(`/jobs/departments/${id}`),
  myApplicantAccess: () => client.get('/jobs/my-applicant-access'),
  getBySlug: (slug) => client.get(`/jobs/${slug}`),
  getById: (id) => client.get(`/jobs/${id}`),
  create: (data) => client.post('/jobs', data),
  update: (id, data) => client.put(`/jobs/${id}`, data),
  updateStatus: (id, status) => client.patch(`/jobs/${id}/status`, { status }),
  remove: (id) => client.delete(`/jobs/${id}`),
  generateJD: (data) => client.post('/jobs/generate-jd', data),
  parseJdPdf: (file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/jobs/parse-jd-pdf', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getQuestions: (id) => client.get(`/jobs/${id}/questions`),
  addQuestion: (id, data) => client.post(`/jobs/${id}/questions`, data),
  removeQuestion: (id, qid) => client.delete(`/jobs/${id}/questions/${qid}`),
};
