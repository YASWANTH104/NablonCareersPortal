import client from './client';

export const interviewSlotsApi = {
  publishableJobs: () => client.get('/interview-slots/jobs'),
  publish: (data) => client.post('/interview-slots/publish', data),
  mine: () => client.get('/interview-slots/mine'),
  unpublish: (id) => client.delete(`/interview-slots/${id}`),
  reschedule: (id, data) => client.patch(`/interview-slots/${id}`, data),
  assignBatch: (data) => client.post('/interview-slots/assign-batch', data),
  unassign: (id) => client.patch(`/interview-slots/${id}/unassign`),
  forInterviewer: (userId) => client.get(`/interview-slots/interviewer/${userId}`),
  requestPublish: (userId) => client.post(`/interview-slots/interviewer/${userId}/request-publish`),
  publishable: () => client.get('/interview-slots/publishable'),
  forJob: (jobId) => client.get(`/interview-slots/job/${jobId}`),
  bookedRounds: (jobId) => client.get(`/interview-slots/booked-rounds/${jobId}`),
  book: (data) => client.post('/interview-slots/book', data),
  bookUnassigned: (data) => client.post('/interview-slots/book-unassigned', data),
  // Agency → HR slot requests
  agencyRequests: (status = 'open') => client.get('/interview-slots/agency-requests', { params: { status } }),
  resolveAgencyRequest: (id, data) => client.post(`/interview-slots/agency-requests/${id}/resolve`, data),
};
