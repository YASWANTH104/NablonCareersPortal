import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2, X, UploadCloud, FileText, Sparkles } from 'lucide-react';
import { jobsApi } from '@/api/jobs';

/* Upload a designed JD (PDF/DOCX): the file is stored and attached to the job,
   and its content is parsed into structured fields for review. HR applies the
   parsed draft to the form (and can still edit) before saving — never auto-saves. */
export default function ImportJdPdfModal({ onApplied, onClose }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);

  const parseMut = useMutation({
    mutationFn: (f) => jobsApi.parseJdPdf(f).then((r) => r.data),
    onSuccess: (data) => setResult(data),
    onError: (err) =>
      toast.error(err.response?.data?.detail ?? 'Could not read that file. Try another PDF or Word document.'),
  });

  const pick = (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    parseMut.mutate(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    pick(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 sm:py-5 border-b border-surface-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-display font-bold text-gray-900 leading-tight">Import JD from PDF</h3>
              <p className="text-xs text-gray-500">Attaches the file & auto-fills the posting from it</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-surface-100 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {/* Dropzone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="cursor-pointer border-2 border-dashed border-surface-300 rounded-xl px-4 sm:px-6 py-8 text-center hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <UploadCloud className="w-8 h-8 text-brand-400 mx-auto mb-2" />
            {file ? (
              <p className="text-sm font-medium text-gray-800">{file.name}</p>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-700">Drop a JD here, or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">PDF or Word · up to 20 MB</p>
              </>
            )}
          </div>

          {parseMut.isPending && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Reading and structuring the document…
            </div>
          )}

          {result && (
            <div className="space-y-4 pt-2 border-t border-surface-100">
              <div className="flex items-center gap-2 pt-4">
                <Sparkles className="w-3.5 h-3.5 text-brand-500" />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {result.parsed ? 'Extracted from your JD' : 'Raw text (AI structuring unavailable — review carefully)'}
                </p>
              </div>

              {(result.title || result.location || result.employment_type) && (
                <div className="flex flex-wrap gap-1.5">
                  {result.title && <span className="text-xs px-2.5 py-1 bg-surface-100 text-gray-600 rounded-full font-medium">{result.title}</span>}
                  {result.location && <span className="text-xs px-2.5 py-1 bg-surface-100 text-gray-600 rounded-full font-medium">{result.location}</span>}
                  {result.employment_type && <span className="text-xs px-2.5 py-1 bg-surface-100 text-gray-600 rounded-full font-medium">{result.employment_type.replace(/_/g, ' ')}</span>}
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Description</p>
                <div
                  className="prose prose-sm max-w-none bg-surface-50 border border-surface-200 rounded-lg p-3 max-h-52 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: result.description || '<p class="text-gray-400">—</p>' }}
                />
              </div>

              {result.requirements && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Requirements</p>
                  <div
                    className="prose prose-sm max-w-none bg-surface-50 border border-surface-200 rounded-lg p-3 max-h-40 overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: result.requirements }}
                  />
                </div>
              )}

              {result.skills_required?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.skills_required.map((s) => (
                      <span key={s} className="text-xs px-2.5 py-1 bg-brand-50 text-brand-700 border border-brand-100 rounded-lg">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {result && (
          <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-4 border-t border-surface-100">
            <button
              type="button"
              onClick={() => { onApplied(result); onClose(); }}
              className="px-5 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 transition-colors"
            >
              Use this JD
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
            <p className="ml-auto text-xs text-gray-400">The PDF is attached & the fields fill in — edit before saving</p>
          </div>
        )}
      </div>
    </div>
  );
}
