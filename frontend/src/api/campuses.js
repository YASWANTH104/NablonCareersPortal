import client from './client';

export const campusesApi = {
  list: () => client.get('/campuses'),
  create: (data) => client.post('/campuses', data),
  update: (id, data) => client.patch(`/campuses/${id}`, data),
  assignToJob: (jobId, data) => client.post(`/jobs/${jobId}/campuses`, data),
  listJobCampuses: (jobId) => client.get(`/jobs/${jobId}/campuses`),
  listCampusAssignments: (campusId) => client.get(`/campuses/${campusId}/assignments`),
  updateAssignment: (assignmentId, data) => client.patch(`/campuses/assignments/${assignmentId}`, data),
  removeAssignment: (assignmentId) => client.delete(`/campuses/assignments/${assignmentId}`),
  portal: (portalToken) => client.get(`/campus-portal/${portalToken}`),
  portalAssignment: (portalToken, assignmentId) =>
    client.get(`/campus-portal/${portalToken}/assignments/${assignmentId}`),
  portalBulkUploadTemplate: (portalToken) =>
    client.get(`/campus-portal/${portalToken}/bulk-upload-template`, { responseType: 'blob' }),
  portalBulkUploadResumes: (portalToken, assignmentId, files) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return client.post(
      `/campus-portal/${portalToken}/assignments/${assignmentId}/bulk-upload-resumes`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 5 * 60 * 1000 }
    );
  },
  portalBulkUploadRoster: (portalToken, assignmentId, file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post(
      `/campus-portal/${portalToken}/assignments/${assignmentId}/bulk-upload-excel`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
  },
  portalBulkScheduleAssessments: (portalToken, assignmentId, data) =>
    client.post(`/campus-portal/${portalToken}/assignments/${assignmentId}/bulk-schedule-assessments`, data),
};
