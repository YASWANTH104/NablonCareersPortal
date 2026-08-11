import client from './client';

export const interviewSlotsApi = {
  publishableJobs: () => client.get('/interview-slots/jobs'),
  publish: (data) => client.post('/interview-slots/publish', data),
  mine: () => client.get('/interview-slots/mine'),
  unpublish: (id) => client.delete(`/interview-slots/${id}`),
  forInterviewer: (userId) => client.get(`/interview-slots/interviewer/${userId}`),
  forJob: (jobId) => client.get(`/interview-slots/job/${jobId}`),
  book: (data) => client.post('/interview-slots/book', data),
};
