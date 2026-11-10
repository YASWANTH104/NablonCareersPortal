import client from './client';

function saveBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const esignApi = {
  // Integration (Settings → Integrations)
  status: () => client.get('/esign/status'),
  testConnection: () => client.post('/esign/test'),
  getSettings: () => client.get('/esign/settings'),
  updateSettings: (data) => client.put('/esign/settings', data),
  searchZohoUsers: (q) => client.get('/esign/zoho-users', { params: { q } }),

  // Per offer
  get: (offerId) => client.get(`/offers/${offerId}/esign`),
  // Two Zoho calls plus a PDF upload — give it more room than the 30s default
  send: (offerId, data) => client.post(`/offers/${offerId}/esign/send`, data, { timeout: 90000 }),
  remind: (offerId) => client.post(`/offers/${offerId}/esign/remind`),
  recall: (offerId) => client.post(`/offers/${offerId}/esign/recall`),
  refresh: (offerId) => client.post(`/offers/${offerId}/esign/refresh`, null, { timeout: 90000 }),
  downloadCertificate: async (offerId) => {
    const res = await client.get(`/offers/${offerId}/certificate`, { responseType: 'blob' });
    saveBlob(res.data, 'offer_signing_certificate.pdf');
  },
};
