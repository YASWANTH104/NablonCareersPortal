import client from './client';

export const reportsApi = {
  hiringFunnel: (params) => client.get('/reports/hiring-funnel', { params }),
  pipelineSnapshot: () => client.get('/reports/pipeline-snapshot'),
  applicationsTrend: (params) => client.get('/reports/applications-trend', { params }),
  sourceFunnel: (params) => client.get('/reports/source-funnel', { params }),
  sourceAnalysis: (params) => client.get('/reports/source-analysis', { params }),
  referralPerformance: (params) => client.get('/reports/referral-performance', { params }),
  timeToHire: (params) => client.get('/reports/time-to-hire', { params }),
  agencyPerformance: (params) => client.get('/reports/agency-performance', { params }),
};
