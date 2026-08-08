import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Star, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { interviewsApi } from '@/api/interviews';

export const RECOMMENDATION_LABELS = {
  strong_yes: { label: 'Strong Yes', color: 'text-green-700 bg-green-50' },
  yes:        { label: 'Yes', color: 'text-emerald-700 bg-emerald-50' },
  neutral:    { label: 'Neutral', color: 'text-gray-700 bg-gray-100' },
  no:         { label: 'No', color: 'text-orange-700 bg-orange-50' },
  strong_no:  { label: 'Strong No', color: 'text-red-700 bg-red-50' },
};

const SCORE_DIMENSIONS = [
  { key: 'technical_score',       label: 'Technical' },
  { key: 'communication_score',   label: 'Communication' },
  { key: 'cultural_fit_score',    label: 'Culture Fit' },
  { key: 'problem_solving_score', label: 'Problem Solving' },
];

function ScoreSelector({ value, onChange }) {
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          className={`w-7 h-7 rounded-full border-2 text-xs font-bold transition-all ${
            value != null && n <= value
              ? 'bg-brand-500 border-brand-500 text-white'
              : 'border-surface-300 text-gray-400 hover:border-brand-400 hover:text-brand-500'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export function InterviewFeedbackCard({ fb }) {
  const rec = RECOMMENDATION_LABELS[fb.recommendation];
  const scores = [
    { label: 'Technical',       val: fb.technical_score },
    { label: 'Communication',   val: fb.communication_score },
    { label: 'Culture Fit',     val: fb.cultural_fit_score },
    { label: 'Problem Solving', val: fb.problem_solving_score },
  ].filter((s) => s.val != null);

  return (
    <div className="bg-surface-50 rounded-xl border border-surface-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        {fb.overall_rating && (
          <div className="flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className={`w-3.5 h-3.5 ${i < fb.overall_rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`} />
            ))}
          </div>
        )}
        {rec && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rec.color}`}>
            {rec.label}
          </span>
        )}
      </div>

      {scores.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {scores.map(({ label, val }) => (
            <div key={label} className="bg-white rounded-lg p-2 text-center border border-surface-100">
              <p className="text-sm font-bold text-gray-900">{val}<span className="text-xs text-gray-400 font-normal">/5</span></p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {(fb.strengths || fb.weaknesses) && (
        <div className="grid sm:grid-cols-2 gap-3 text-xs mb-3">
          {fb.strengths && (
            <div>
              <p className="font-semibold text-green-700 mb-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Strengths
              </p>
              <p className="text-gray-700">{fb.strengths}</p>
            </div>
          )}
          {fb.weaknesses && (
            <div>
              <p className="font-semibold text-orange-700 mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Areas to improve
              </p>
              <p className="text-gray-700">{fb.weaknesses}</p>
            </div>
          )}
        </div>
      )}

      {fb.notes && <p className="text-xs text-gray-600 bg-white rounded-lg p-2.5 border border-surface-100">{fb.notes}</p>}
    </div>
  );
}

export function InlineFeedbackForm({ interviewId, onSuccess, onCancel }) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm();
  const [overallRating,  setOverallRating]  = useState(null);
  const [recommendation, setRecommendation] = useState('');
  const [scores, setScores] = useState({
    technical_score: null, communication_score: null,
    cultural_fit_score: null, problem_solving_score: null,
  });

  const submitMut = useMutation({
    mutationFn: (data) => interviewsApi.submitFeedback(interviewId, data),
    onSuccess: () => { toast.success('Feedback submitted'); onSuccess(); },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to submit feedback'),
  });

  const onSubmit = (textValues) => {
    const payload = { ...textValues };
    if (overallRating)  payload.overall_rating  = overallRating;
    if (recommendation) payload.recommendation  = recommendation;
    Object.entries(scores).forEach(([k, v]) => { if (v != null) payload[k] = v; });
    Object.keys(payload).forEach((k) => { if (payload[k] === '' || payload[k] == null) delete payload[k]; });
    submitMut.mutate(payload);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-4 pt-4 border-t border-surface-100 space-y-5">
      <h4 className="text-sm font-semibold text-gray-900">Submit Feedback</h4>

      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Overall Rating</p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setOverallRating(overallRating === n ? null : n)} className="p-0.5">
              <Star className={`w-5 h-5 ${n <= (overallRating ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Recommendation</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(RECOMMENDATION_LABELS).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => setRecommendation(recommendation === k ? '' : k)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                recommendation === k
                  ? v.color + ' border-transparent'
                  : 'bg-white text-gray-500 border-surface-300 hover:border-gray-400'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {SCORE_DIMENSIONS.map(({ key, label }) => (
          <div key={key}>
            <p className="text-xs font-medium text-gray-600 mb-1.5">{label}</p>
            <ScoreSelector
              value={scores[key]}
              onChange={(v) => setScores((s) => ({ ...s, [key]: v }))}
            />
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Strengths</label>
          <textarea
            {...register('strengths')}
            rows={2}
            className="w-full px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Areas to improve</label>
          <textarea
            {...register('weaknesses')}
            rows={2}
            className="w-full px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Additional notes</label>
        <textarea
          {...register('notes')}
          rows={2}
          className="w-full px-3 py-1.5 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting || submitMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60"
        >
          {(isSubmitting || submitMut.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Submit feedback
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
