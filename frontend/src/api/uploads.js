import client from './client';

export const uploadsApi = {
  resume: (file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/uploads/resume', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  avatar: (file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/uploads/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
