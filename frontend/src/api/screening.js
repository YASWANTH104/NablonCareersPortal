import client from './client';

export const screeningApi = {
  // HR
  getByApplication: (applicationId) =>
    client.get(`/applications/${applicationId}/screening`),

  // Public (candidate, token-based, no login)
  getStatus: (token) => client.get(`/screening/${token}`),
  submit: (token, data) => client.post(`/screening/${token}/submit`, data),
};
