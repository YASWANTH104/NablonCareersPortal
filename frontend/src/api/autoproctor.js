import client from './client';

export const autoproctorApi = {
  summary: () => client.get('/autoproctor/summary'),
  attempts: (params) => client.get('/autoproctor/attempts', { params }),
  attempt: (id) => client.get(`/autoproctor/attempts/${id}`),
  // body: { assessment_id } or { application_id } (creates their assessment if none); both null unlinks.
  link: (id, body) => client.post(`/autoproctor/attempts/${id}/link`, body),
  pending: () => client.get('/autoproctor/pending'),
  linkable: (q) => client.get('/autoproctor/linkable-assessments', { params: { q } }),
  runs: () => client.get('/autoproctor/runs'),
  sync: (dateFrom, dateTo) => client.post('/autoproctor/sync', { date_from: dateFrom, date_to: dateTo }),
};
