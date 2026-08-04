import client from './client';

export const referralsApi = {
  create: (data) => {
    const form = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') form.append(key, value);
    });
    return client.post('/referrals', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  mine: (params) => client.get('/referrals/mine', { params }),
  list: (params) => client.get('/referrals', { params }),
  getById: (id) => client.get(`/referrals/${id}`),
  updateStatus: (id, status) => client.patch(`/referrals/${id}/status`, { status }),
  resend: (id) => client.post(`/referrals/${id}/resend`),
  updateBonus: (id, data) => client.patch(`/referrals/${id}/bonus`, data),
};
