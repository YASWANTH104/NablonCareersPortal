import client from './client';

export const authApi = {
  register: (data) => client.post('/auth/register', data),

  login: (data) => client.post('/auth/login', data),

  logout: (refreshToken) => client.post('/auth/logout', { refresh_token: refreshToken }),

  me: () => client.get('/auth/me'),

  verifyEmail: (token) => client.post('/auth/verify-email', { token }),

  forgotPassword: (email) => client.post('/auth/forgot-password', { email }),

  resetPassword: (token, newPassword) =>
    client.post('/auth/reset-password', { token, new_password: newPassword }),
};
