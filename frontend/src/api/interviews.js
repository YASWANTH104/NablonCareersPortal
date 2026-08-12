import client from './client';

export const interviewsApi = {
  create: (data) => client.post('/interviews', data),
  checkAvailability: (data) => client.post('/interviews/check-availability', data),
  panelistSchedule: (data) => client.post('/interviews/panelist-schedule', data),
  list: (params) => client.get('/interviews', { params }),
  mine: (params) => client.get('/interviews/mine', { params }),
  getById: (id) => client.get(`/interviews/${id}`),
  update: (id, data) => client.patch(`/interviews/${id}`, data),
  complete: (id, data = {}) => client.patch(`/interviews/${id}/complete`, data),
  cancel: (id) => client.delete(`/interviews/${id}`),
  submitFeedback: (id, data) => client.post(`/interviews/${id}/feedback`, data),
  uploadFeedbackAttachment: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post(`/interviews/${id}/feedback/attachment`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getFeedback: (id) => client.get(`/interviews/${id}/feedback`),
  submitSelfFeedback: (id, data) => client.post(`/interviews/${id}/self-feedback`, data),
  getSelfFeedback: (id) => client.get(`/interviews/${id}/self-feedback`),
  getCandidateSummary: (id) => client.get(`/interviews/${id}/candidate-summary`),
  getFeedbackByToken: (token) => client.get(`/interviews/feedback-by-token/${token}`),
  submitFeedbackByToken: (token, data) => client.post(`/interviews/feedback-by-token/${token}`, data),
  uploadFeedbackAttachmentByToken: (token, file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post(`/interviews/feedback-by-token/${token}/attachment`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
