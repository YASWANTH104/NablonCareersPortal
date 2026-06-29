import client from './client';

export const usersApi = {
  me: () => client.get('/users/me'),
  updateMe: (data) => client.patch('/users/me', data),
  myProfile: () => client.get('/users/me/profile'),
  updateMyProfile: (data) => client.patch('/users/me/profile', data),
  list: (params) => client.get('/users', { params }),
  panelEligible: () => client.get('/users', { params: { panel_eligible: true } }),
  invite: (data) => client.post('/users/invite', data),
  changeRole: (id, role) => client.patch(`/users/${id}/role`, { role }),
  toggleActive: (id) => client.patch(`/users/${id}/deactivate`),
};
