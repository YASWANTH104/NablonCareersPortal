import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2, Sparkles, X, AlertTriangle } from 'lucide-react';
import { jobsApi } from '@/api/jobs';

function ContextChip({ children }) {
  return (
    <span className="text-xs px-2.5 py-1 bg-surface-100 text-gray-600 rounded-full font-medium">
      {children}
    </span>
  );
}

/* AI job-description drafter for JobEditPage — takes rough hiring-manager
   notes plus the role fields already filled in, and returns a full
   description / requirements / benefits / skills draft to review before
   applying to the form. Never auto-saves; HR always reviews first. */
export default function DraftWithAiModal({ context, onApply, onClose }) {
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState(null);

  const generateMut = useMutation({
    mutationFn: () =>
      jobsApi
        .generateJD({
          title: context.title,
          notes,
          department: context.department || undefined,
          location: context.location || undefined,
          location_type: context.location_type || undefined,
          employment_type: context.employment_type || undefined,
          experience_min: context.experience_min ?? undefined,
          experience_max: context.experience_max ?? undefined,
        })
        .then((r) => r.data),
    onSuccess: (data) => setDraft(data),
    onError: (err) =>
      toast.error(err.response?.data?.detail ?? 'AI drafting failed. Please try again or write it manually.'),
  });

  const hasTitle = Boolean(context.title?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-surface-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-display font-bold text-gray-900 leading-tight">Draft with AI</h3>
              <p className="text-xs text-gray-500">Generates description, requirements, benefits & skills</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-surface-100 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {!hasTitle ? (
            <div className="flex items-start gap-2.5 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              Add a job title above first — the AI uses it as the main context for drafting.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <ContextChip>{context.title}</ContextChip>
              {context.department && <ContextChip>{context.department}</ContextChip>}
              {context.location && <ContextChip>{context.location}</ContextChip>}
              {context.location_type && <ContextChip>{context.location_type}</ContextChip>}
              {context.employment_type && <ContextChip>{context.employment_type}</ContextChip>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Rough notes about the role
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="e.g. Senior engineer for our agent evals team. Needs strong Python + LLM tool-use experience, will own the eval harness and work directly with clients. 4-8 years experience..."
              className="w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-y"
            />
          </div>

          <button
            type="button"
            onClick={() => generateMut.mutate()}
            disabled={!hasTitle || notes.trim().length < 10 || generateMut.isPending}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generateMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {draft ? 'Regenerate' : 'Generate draft'}
          </button>

          {draft && (
            <div className="space-y-4 pt-2 border-t border-surface-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-4">Preview</p>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Description</p>
                <div
                  className="prose prose-sm max-w-none bg-surface-50 border border-surface-200 rounded-lg p-3"
                  dangerouslySetInnerHTML={{ __html: draft.description }}
                />
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Requirements</p>
                <div
                  className="prose prose-sm max-w-none bg-surface-50 border border-surface-200 rounded-lg p-3"
                  dangerouslySetInnerHTML={{ __html: draft.requirements }}
                />
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Benefits</p>
                <div
                  className="prose prose-sm max-w-none bg-surface-50 border border-surface-200 rounded-lg p-3"
                  dangerouslySetInnerHTML={{ __html: draft.benefits }}
                />
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.skills_required.map((skill) => (
                    <span key={skill} className="text-xs px-2.5 py-1 bg-brand-50 text-brand-700 border border-brand-100 rounded-lg">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {draft && (
          <div className="flex items-center gap-3 px-6 py-4 border-t border-surface-100">
            <button
              type="button"
              onClick={() => { onApply(draft); onClose(); }}
              className="px-5 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors"
            >
              Use this draft
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700">
              Discard
            </button>
            <p className="ml-auto text-xs text-gray-400">You can still edit everything after applying</p>
          </div>
        )}
      </div>
    </div>
  );
}
