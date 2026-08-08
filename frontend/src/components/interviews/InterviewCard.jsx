import { useState } from 'react';
import { format } from 'date-fns';
import {
  Clock, Users, ExternalLink, CheckCircle2, RefreshCw, History,
  MapPin, ChevronDown, ChevronUp,
} from 'lucide-react';
import { statusStyle, typeIcon, isActive, interviewRange } from './calendarUtils';
import { InterviewFeedbackCard, InlineFeedbackForm } from './feedback';

/** Agenda-list row for a single interview: time rail on the left, details in the
    middle, actions on the right, with feedback expanding underneath. */
export default function InterviewCard({
  interview, onCandidateClick, canComplete, canCancel, onComplete, onReschedule, onRefetch,
}) {
  const TypeIcon = typeIcon(interview.interview_type);
  const style = statusStyle(interview.status);
  const { start, end } = interviewRange(interview);

  const [showFeedback, setShowFeedback] = useState(false);
  const [showAllFeedback, setShowAllFeedback] = useState(false);
  const [showPrevRounds, setShowPrevRounds] = useState(false);

  const hasFeedback = interview.feedback?.length > 0;
  const hasPrevRounds = interview.previous_rounds_feedback?.length > 0;
  const live = isActive(interview);

  return (
    <div className="group relative bg-white rounded-xl border border-surface-200 hover:border-brand-200 hover:shadow-card-hover transition-all overflow-hidden">
      <span className={`absolute left-0 inset-y-0 w-1 ${style.bar}`} />

      <div className="flex flex-col sm:flex-row sm:items-start gap-4 p-4 pl-5">
        {/* Time rail */}
        <div className="flex sm:flex-col sm:items-center gap-2 sm:gap-0 sm:w-20 flex-shrink-0">
          <p className="text-sm font-bold text-gray-900 tabular-nums leading-tight">
            {format(start, 'h:mm a')}
          </p>
          <p className="text-xs text-gray-400 tabular-nums sm:mt-0.5">
            {format(end, 'h:mm a')}
          </p>
          <span className="hidden sm:flex mt-2 w-8 h-8 rounded-full bg-surface-100 items-center justify-center">
            <TypeIcon className="w-4 h-4 text-gray-500" />
          </span>
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {interview.title || `Round ${interview.round_number}`}
            </p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${style.badge}`}>
              {style.label}
            </span>
            {interview.interview_type && (
              <span className="text-xs text-gray-500 capitalize bg-surface-100 px-2 py-0.5 rounded-full">
                {interview.interview_type}
              </span>
            )}
          </div>

          {interview.candidate_name && (
            <button
              onClick={() => onCandidateClick(interview.application_id)}
              className="text-sm font-medium text-brand-600 hover:text-brand-700 mt-1 text-left"
            >
              {interview.candidate_name}
            </button>
          )}

          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              {interview.duration_mins} min
            </span>
            {interview.panelists?.length > 0 && (
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                {interview.panelists.length} panelist{interview.panelists.length !== 1 ? 's' : ''}
              </span>
            )}
            {interview.location && (
              <span className="flex items-center gap-1 min-w-0">
                <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="truncate">{interview.location}</span>
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap sm:justify-end">
          {interview.meeting_link && live && (
            <a
              href={interview.meeting_link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 bg-brand-500 text-white text-xs font-semibold rounded-lg hover:bg-brand-600 transition-colors"
            >
              Join <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {canComplete && live && (
            <button
              onClick={() => onComplete(interview.id)}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition-colors"
            >
              <CheckCircle2 className="w-3 h-3" /> Complete
            </button>
          )}
          {canCancel && live && (
            <button
              onClick={() => onReschedule(interview)}
              className="flex items-center gap-1 px-3 py-1.5 border border-brand-200 text-xs text-brand-600 font-medium rounded-lg hover:bg-brand-50 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Reschedule
            </button>
          )}
          <button
            onClick={() => onCandidateClick(interview.application_id)}
            className="px-3 py-1.5 border border-surface-200 text-xs text-gray-600 rounded-lg hover:bg-surface-50 transition-colors"
          >
            View application
          </button>
        </div>
      </div>

      {interview.notes && (
        <p className="mx-4 mb-4 text-xs text-gray-500 bg-surface-50 rounded-lg p-2.5">
          {interview.notes}
        </p>
      )}

      {hasPrevRounds && (
        <div className="mx-4 mb-4 pt-3 border-t border-surface-100">
          <button
            onClick={() => setShowPrevRounds((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
          >
            <History className="w-3.5 h-3.5" />
            Previous round feedback ({interview.previous_rounds_feedback.reduce((s, r) => s + r.feedback.length, 0)})
            {showPrevRounds ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showPrevRounds && (
            <div className="mt-3 space-y-4">
              {interview.previous_rounds_feedback.map((round) => (
                <div key={round.round_number}>
                  <p className="text-xs font-semibold text-gray-500 mb-2">
                    Round {round.round_number}{round.interview_title ? ` — ${round.interview_title}` : ''}
                  </p>
                  {round.feedback.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No feedback submitted yet</p>
                  ) : (
                    <div className="space-y-2">
                      {round.feedback.map((fb) => <InterviewFeedbackCard key={fb.id} fb={fb} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hasFeedback && (
        <div className="mx-4 mb-4 pt-3 border-t border-surface-100">
          <button
            onClick={() => setShowAllFeedback((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            {interview.feedback.length} feedback{interview.feedback.length !== 1 ? 's' : ''} submitted
            {showAllFeedback ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showAllFeedback && (
            <div className="mt-2 space-y-2">
              {interview.feedback.map((fb) => <InterviewFeedbackCard key={fb.id} fb={fb} />)}
            </div>
          )}
        </div>
      )}

      {(live || interview.status === 'completed') && canComplete && (
        <div className="mx-4 mb-4">
          {showFeedback ? (
            <InlineFeedbackForm
              interviewId={interview.id}
              onSuccess={() => { setShowFeedback(false); onRefetch(); }}
              onCancel={() => setShowFeedback(false)}
            />
          ) : (
            <button
              onClick={() => setShowFeedback(true)}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              + Add feedback
            </button>
          )}
        </div>
      )}
    </div>
  );
}
