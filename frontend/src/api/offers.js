import client from './client';

export const offersApi = {
  // Templates
  listTemplates: () => client.get('/offers/templates'),
  createTemplate: (data) => client.post('/offers/templates', data),
  updateTemplate: (id, data) => client.put(`/offers/templates/${id}`, data),
  deleteTemplate: (id) => client.delete(`/offers/templates/${id}`),

  // Offer letters
  create: (data) => client.post('/offers', data),
  list: (params) => client.get('/offers', { params }),
  getById: (id) => client.get(`/offers/${id}`),
  getByApplication: (applicationId) => client.get(`/offers/by-application/${applicationId}`),
  update: (id, data) => client.put(`/offers/${id}`, data),
  send: (id) => client.post(`/offers/${id}/send`),
  preview: (id) => client.get(`/offers/${id}/preview`),
  revoke: (id) => client.post(`/offers/${id}/revoke`),

  // Public — no auth (legacy/fallback)
  respond: (token, data) => client.post(`/offers/respond/${token}`, data),

  // Candidate portal (authenticated)
  getMyOffer: (applicationId) => client.get(`/offers/mine/${applicationId}`),
  respondMyOffer: (applicationId, data) => client.post(`/offers/mine/${applicationId}/respond`, data),

  // Inline HTML view — no WeasyPrint, instant
  fetchMyHtmlBlob: async (applicationId) => {
    const res = await client.get(`/offers/mine/${applicationId}/view`, { responseType: 'blob' });
    return URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
  },

  // HR inline HTML view
  fetchHtmlBlob: async (offerId) => {
    const res = await client.get(`/offers/${offerId}/view`, { responseType: 'blob' });
    return URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
  },

  // Forces a file-save PDF download (uses WeasyPrint)
  downloadMyPdf: async (applicationId) => {
    const res = await client.get(`/offers/mine/${applicationId}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'offer_letter.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  downloadPdf: async (offerId) => {
    const res = await client.get(`/offers/${offerId}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'offer_letter.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};
