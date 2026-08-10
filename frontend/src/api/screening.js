import client from './client';

export const screeningApi = {
  get: (token) => client.get(`/screening/${token}`),
  submit: (token, data) => client.post(`/screening/${token}`, data),
};
