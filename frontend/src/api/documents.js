import client from './client';

export const documentsApi = {
  // HR
  getByApplication: (applicationId) =>
    client.get(`/applications/${applicationId}/documents`),
  sendRequest: (applicationId) =>
    client.post(`/applications/${applicationId}/documents/request`),

  // Candidate portal (authenticated)
  getMyDocuments: (applicationId) =>
    client.get(`/applications/mine/${applicationId}/documents`),
  uploadMyDocument: (applicationId, documentType, file) => {
    const form = new FormData();
    form.append('document_type', documentType);
    form.append('file', file);
    return client.post(`/applications/mine/${applicationId}/documents/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // Public (candidate, no auth — legacy/fallback)
  getStatus: (token) =>
    client.get(`/doc-requests/${token}`),
  upload: (token, documentType, file) => {
    const form = new FormData();
    form.append('document_type', documentType);
    form.append('file', file);
    return client.post(`/doc-requests/${token}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
