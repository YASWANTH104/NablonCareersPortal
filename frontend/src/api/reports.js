import client from './client';

export const reportsApi = {
  hiringFunnel: (params) => client.get('/reports/hiring-funnel', { params }),
  sourceAnalysis: (params) => client.get('/reports/source-analysis', { params }),
  referralPerformance: (params) => client.get('/reports/referral-performance', { params }),
  timeToHire: (params) => client.get('/reports/time-to-hire', { params }),
};
