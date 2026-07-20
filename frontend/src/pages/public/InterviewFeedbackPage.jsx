import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ClipboardCheck, Star, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { interviewsApi } from '@/api/interviews';

const RECOMMENDATIONS = [
  { value: 'strong_yes', label: 'Strong Yes', cls: 'bg-green-600 text-white border-green-600' },
  { value: 'yes', label: 'Yes', cls: 'bg-green-100 text-green-700 border-green-300' },
  { value: 'neutral', label: 'Neutral', cls: 'bg-gray-100 text-gray-700 border-gray-300' },
  { value: 'no', label: 'No', cls: 'bg-red-100 text-red-700 border-red-300' },
  { value: 'strong_no', label: 'Strong No', cls: 'bg-red-600 text-white border-red-600' },
];

const SCORE_FIELDS = [
  { key: 'technical_score', label: 'Technical' },
  { key: 'communication_score', label: 'Communication' },
  { key: 'cultural_fit_score', label: 'Cultural fit' },
  { key: 'problem_solving_score', label: 'Problem solving' },
];

function ScoreRow({ label, value, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm font-semibold text-brand-600 w-10 text-right">{value ?? '—'}/10</span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex-1 h-7 rounded text-xs font-medium transition-colors ${
              value >= n ? 'bg-brand-500 text-white' : 'bg-surface-100 text-gray-400 hover:bg-surface-200'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function InterviewFeedbackPage() {
  const { token } = useParams();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    overall_rating: null,
    recommendation: null,
    technical_score: null,
    communication_score: null,
    cultural_fit_score: null,
    problem_solving_score: null,
    strengths: '',
    weaknesses: '',
    notes: '',
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['feedback-by-token', token],
    queryFn: () => interviewsApi.getFeedbackByToken(token).then((r) => r.data),
    retry: false,
  });

  // Prefill when the interviewer already submitted (they can revise)
  useEffect(() => {
    const existing = data?.existing_feedback;
    if (existing) {
      setForm({
        overall_rating: existing.overall_rating ?? null,
        recommendation: existing.recommendation ?? null,
        technical_score: existing.technical_score ?? null,
        communication_score: existing.communication_score ?? null,
        cultural_fit_score: existing.cultural_fit_score ?? null,
        problem_solving_score: existing.problem_solving_score ?? null,
        strengths: existing.strengths ?? '',
        weaknesses: existing.weaknesses ?? '',
        notes: existing.notes ?? '',
      });
    }
  }, [data]);

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.recommendation) {
      toast.error('Please select a recommendation');
      return;
    }
    setSubmitting(true);
    try {
      await interviewsApi.submitFeedbackByToken(token, {
        ...form,
        strengths: form.strengths || null,
        weaknesses: form.weaknesses || null,
        notes: form.notes || null,
      });
      setSubmitted(true);
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-700">Link not valid</h2>
          <p className="text-sm text-gray-400 mt-1">This feedback link is invalid or the interview was cancelled.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-800">Feedback submitted</h2>
          <p className="text-sm text-gray-500 mt-2">
            Thank you! Your feedback for <strong>{data?.candidate_name}</strong> has been recorded.
            You can close this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50">
      <header className="bg-white border-b border-surface-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <ClipboardCheck className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Interview Feedback</p>
            <p className="text-xs text-gray-400">Nablon AI Careers</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-white rounded-2xl border border-surface-200 p-6 mb-6">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
            {data?.interview_title}
          </p>
          <h1 className="text-lg font-bold text-gray-900">
            {data?.candidate_name} · {data?.job_title}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Hi {data?.interviewer_name} — please share your assessment of this interview
            {data?.scheduled_at ? ` held on ${format(new Date(data.scheduled_at), 'd MMM yyyy, h:mm a')}` : ''}.
            {data?.existing_feedback ? ' You have already submitted — submitting again updates your feedback.' : ''}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-surface-200 p-6 space-y-6">
          {/* Overall rating */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Overall rating <span className="text-red-500">*</span>
            </p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set('overall_rating')(n)}
                  className="p-1"
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${
                      form.overall_rating >= n ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Recommendation */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Recommendation <span className="text-red-500">*</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {RECOMMENDATIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => set('recommendation')(r.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    form.recommendation === r.value ? r.cls : 'bg-white text-gray-500 border-surface-300 hover:border-gray-400'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scores */}
          <div className="space-y-4">
            {SCORE_FIELDS.map(({ key, label }) => (
              <ScoreRow key={key} label={label} value={form[key]} onChange={set(key)} />
            ))}
          </div>

          {/* Text feedback */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Strengths</label>
              <textarea
                rows={3}
                value={form.strengths}
                onChange={(e) => set('strengths')(e.target.value)}
                placeholder="What did the candidate do well?"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Areas to improve</label>
              <textarea
                rows={3}
                value={form.weaknesses}
                onChange={(e) => set('weaknesses')(e.target.value)}
                placeholder="Where did the candidate struggle?"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Additional notes</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes')(e.target.value)}
                placeholder="Anything else the hiring team should know"
                className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 transition-colors"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit feedback'}
          </button>
        </form>
      </main>
    </div>
  );
}
