import client from './client';

export const applicationsApi = {
  submit: (data) => client.post('/applications', data),
  hrSubmitCandidate: ({ resume, ...fields }) => {
    const form = new FormData();
    form.append('resume', resume);
    Object.entries(fields).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') form.append(key, val);
    });
    return client.post('/applications/hr-submit', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  bulkUploadResumes: (jobId, source, files) => {
    const form = new FormData();
    form.append('job_id', jobId);
    form.append('source', source);
    files.forEach((f) => form.append('files', f));
    return client.post('/applications/bulk-upload-resumes', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 5 * 60 * 1000, // AI parses each resume in turn — can take a while for a full batch
    });
  },
  bulkUploadExcel: (jobId, source, file) => {
    const form = new FormData();
    form.append('job_id', jobId);
    form.append('source', source);
    form.append('file', file);
    return client.post('/applications/bulk-upload-excel', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 3 * 60 * 1000,
    });
  },
  bulkUploadTemplate: () => client.get('/applications/bulk-upload-template', { responseType: 'blob' }),
  mine: (page = 1, limit = 10) => client.get('/applications/mine', { params: { page, limit } }),
  list: (params) => client.get('/applications', { params }),
  getById: (id) => client.get(`/applications/${id}`),
  update: (id, data) => client.patch(`/applications/${id}`, data),
  moveStage: (id, stage, notes, rejection_reason, drop_category) =>
    client.patch(`/applications/${id}/stage`, { stage, notes, rejection_reason, drop_category }),
  moveJob: (id, newJobId) => client.patch(`/applications/${id}/move-job`, { new_job_id: newJobId }),
  assign: (id, assigneeId) => client.patch(`/applications/${id}/assign`, { assignee_id: assigneeId }),
  setHold: (id, onHold, holdReason) => client.patch(`/applications/${id}/hold`, { on_hold: onHold, hold_reason: holdReason }),
  toggleStar: (id) => client.patch(`/applications/${id}/star`),
  reviewDuplicate: (id) => client.patch(`/applications/${id}/duplicate-review`),
  setRating: (id, rating) => client.patch(`/applications/${id}/rating`, { rating }),
  addNote: (id, note, files = []) => {
    const form = new FormData();
    form.append('note', note ?? '');
    files.forEach((f) => form.append('files', f));
    return client.post(`/applications/${id}/notes`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getTimeline: (id) => client.get(`/applications/${id}/timeline`),
  listResumes: (id) => client.get(`/applications/${id}/resumes`),
  addResume: (id, file, note) => {
    const form = new FormData();
    form.append('resume', file);
    if (note) form.append('note', note);
    return client.post(`/applications/${id}/resumes`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  withdraw: (id) => client.delete(`/applications/${id}/withdraw`),
  export: (params) => client.get('/applications/export', { params, responseType: 'blob' }),
  getMyInterviews: (id) => client.get(`/applications/${id}/interviews`),
};
