import client from './client';

export const referralsApi = {
  create: (data) => client.post('/referrals', data),
  mine: (params) => client.get('/referrals/mine', { params }),
  list: (params) => client.get('/referrals', { params }),
  getById: (id) => client.get(`/referrals/${id}`),
  updateStatus: (id, status) => client.patch(`/referrals/${id}/status`, { status }),
  resend: (id) => client.post(`/referrals/${id}/resend`),
  updateBonus: (id, data) => client.patch(`/referrals/${id}/bonus`, data),
};
