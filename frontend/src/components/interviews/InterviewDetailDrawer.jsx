import { useState } from 'react';
import { format } from 'date-fns';
import {
  X, Calendar, Users, ExternalLink, CheckCircle2, RefreshCw,
  MapPin, Phone, Video, User, History,
} from 'lucide-react';
import { statusStyle, typeIcon, isActive, interviewRange } from './calendarUtils';
import { InterviewFeedbackCard, InlineFeedbackForm } from './feedback';

function DetailRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <div className="text-sm text-gray-800 mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

/** Slide-over shown when an interview is picked out of the month or week grid.
    Everything the agenda card offers, laid out vertically for a narrow column. */
export default function InterviewDetailDrawer({
  interview, canComplete, canCancel, onComplete, onReschedule, onRefetch, onViewCandidate, onClose,
}) {
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const style = statusStyle(interview.status);
  const TypeIcon = typeIcon(interview.interview_type);
  const { start, end } = interviewRange(interview);
  const live = isActive(interview);

  const locationIcon = interview.interview_type === 'phone' ? Phone : MapPin;
  const hasPrevRounds = interview.previous_rounds_feedback?.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      <aside className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-white shadow-2xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-surface-200">
          <div className="min-w-0">
            <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
              {style.label}
            </span>
            <h2 className="font-display font-bold text-gray-900 text-base mt-1.5 truncate">
              {interview.title || `Round ${interview.round_number}`}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-500 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* When */}
          <div className="px-5 py-4 bg-surface-50 border-b border-surface-200">
            <p className="font-display text-lg font-bold text-gray-900">
              {format(start, 'EEEE, MMMM d')}
            </p>
            <p className="text-sm text-gray-600 mt-0.5 tabular-nums">
              {format(start, 'h:mm a')} – {format(end, 'h:mm a')}
              <span className="text-gray-400"> · {interview.duration_mins} min</span>
            </p>
          </div>

          <div className="p-5 space-y-5">
            {interview.candidate_name && (
              <button
                onClick={() => onViewCandidate(interview.application_id)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-surface-200 hover:border-brand-200 hover:bg-brand-50/40 transition-colors text-left"
              >
                <span className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {interview.candidate_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 truncate">{interview.candidate_name}</span>
                  <span className="block text-xs text-gray-500 truncate">
                    {interview.job_title || 'View candidate profile'}
                  </span>
                </span>
                <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
              </button>
            )}

            <div className="space-y-4">
              <DetailRow icon={TypeIcon} label="Format">
                <span className="capitalize">{interview.interview_type || 'Interview'}</span>
                {interview.round_number != null && (
                  <span className="text-gray-400"> · Round {interview.round_number}</span>
                )}
              </DetailRow>

              {interview.location && (
                <DetailRow icon={locationIcon} label={interview.interview_type === 'phone' ? 'Phone' : 'Location'}>
                  {interview.location}
                </DetailRow>
              )}

              {interview.panelists?.length > 0 && (
                <DetailRow icon={Users} label="Panel">
                  {interview.panelists.length} panelist{interview.panelists.length !== 1 ? 's' : ''}
                  {interview.panelists.some((p) => p.role) && (
                    <span className="text-gray-400"> · {interview.panelists.map((p) => p.role).filter(Boolean).join(', ')}</span>
                  )}
                </DetailRow>
              )}

              {interview.notes && (
                <DetailRow icon={Calendar} label="Notes">
                  <span className="whitespace-pre-line">{interview.notes}</span>
                </DetailRow>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-1">
              {interview.meeting_link && live && (
                <a
                  href={interview.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-semibold hover:bg-brand-600 transition-colors"
                >
                  <Video className="w-4 h-4" /> Join meeting
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </a>
              )}
              <div className="flex gap-2">
                {canComplete && live && (
                  <button
                    onClick={() => onComplete(interview.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-green-500 text-white rounded-xl text-sm font-semibold hover:bg-green-600 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Complete
                  </button>
                )}
                {canCancel && live && (
                  <button
                    onClick={() => onReschedule(interview)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 border border-brand-200 text-brand-600 rounded-xl text-sm font-semibold hover:bg-brand-50 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Reschedule
                  </button>
                )}
              </div>
              <button
                onClick={() => onViewCandidate(interview.application_id)}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 border border-surface-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-surface-50 transition-colors"
              >
                <User className="w-4 h-4 text-gray-400" /> Open application
              </button>
            </div>

            {/* Previous rounds */}
            {hasPrevRounds && (
              <div className="pt-4 border-t border-surface-100">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  <History className="w-3.5 h-3.5" /> Previous rounds
                </p>
                <div className="space-y-4">
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
              </div>
            )}

            {/* Feedback */}
            <div className="pt-4 border-t border-surface-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Feedback {interview.feedback?.length > 0 && `(${interview.feedback.length})`}
              </p>
              {interview.feedback?.length > 0 ? (
                <div className="space-y-2">
                  {interview.feedback.map((fb) => <InterviewFeedbackCard key={fb.id} fb={fb} />)}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No feedback submitted yet.</p>
              )}

              {(live || interview.status === 'completed') && canComplete && (
                showFeedbackForm ? (
                  <InlineFeedbackForm
                    interviewId={interview.id}
                    onSuccess={() => { setShowFeedbackForm(false); onRefetch(); }}
                    onCancel={() => setShowFeedbackForm(false)}
                  />
                ) : (
                  <button
                    onClick={() => setShowFeedbackForm(true)}
                    className="mt-3 text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    + Add feedback
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
