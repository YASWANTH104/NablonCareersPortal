import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import {
  FileText, Upload, ExternalLink, Loader2, History, X, Check,
} from 'lucide-react';
import { applicationsApi } from '@/api/applications';

/* Stored resume URLs are absolute for Azure blobs but root-relative in local
   dev (`/uploads/...`), where the backend serves them off the API origin. */
export const resolveFileUrl = (url) =>
  !url || url.startsWith('http') ? url : `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${url}`;

const ROLE_LABELS = {
  applicant: 'Candidate',
  hr_manager: 'HR',
  admin: 'Admin',
  super_admin: 'Admin',
  interviewer: 'Interviewer',
};

const isPdf = (url = '') => url.toLowerCase().includes('.pdf');

function UploadRevisionForm({ applicationId, onDone, onCancel }) {
  const qc = useQueryClient();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');

  const uploadMut = useMutation({
    mutationFn: () => applicationsApi.addResume(applicationId, file, note),
    onSuccess: () => {
      toast.success('Resume updated');
      qc.invalidateQueries({ queryKey: ['application-resumes', applicationId] });
      // The application row carries resume_url, which now points somewhere new.
      qc.invalidateQueries({ queryKey: ['application', applicationId] });
      qc.invalidateQueries({ queryKey: ['my-applications'] });
      onDone?.();
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Failed to upload resume'),
  });

  return (
    <div className="rounded-xl border border-surface-200 bg-surface-50 p-4 space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-surface-300 bg-white text-sm text-gray-600 hover:border-brand-400 hover:text-brand-600 transition-colors"
      >
        <Upload className="w-4 h-4" />
        {file ? file.name : 'Choose a PDF or Word file'}
      </button>

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What changed? (optional)"
        className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!file || uploadMut.isPending}
          onClick={() => uploadMut.mutate()}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-50"
        >
          {uploadMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Upload revision
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Resume revision history for one application.
 *
 * `resume_url` on the application always points at the newest revision, so this
 * list is what makes an older version — the one a panel actually interviewed
 * against — still reachable after someone uploads a replacement.
 */
export default function ResumeVersions({
  applicationId,
  canUpload = false,
  showPreview = true,
  onSelect,
}) {
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['application-resumes', applicationId],
    queryFn: () => applicationsApi.listResumes(applicationId).then((r) => r.data),
    enabled: !!applicationId,
  });

  const selected = useMemo(
    () => versions.find((v) => v.id === selectedId) ?? versions.find((v) => v.is_current) ?? versions[0],
    [versions, selectedId],
  );

  const pick = (v) => {
    setSelectedId(v.id);
    onSelect?.(v);
  };

  if (isLoading) {
    return <div className="h-24 bg-surface-100 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <History className="w-3.5 h-3.5" />
          Resume history
          {versions.length > 0 && <span className="text-gray-400 normal-case font-normal">({versions.length})</span>}
        </p>
        {canUpload && !uploading && (
          <button
            type="button"
            onClick={() => setUploading(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" /> Upload revision
          </button>
        )}
      </div>

      {uploading && (
        <UploadRevisionForm
          applicationId={applicationId}
          onDone={() => { setUploading(false); setSelectedId(null); }}
          onCancel={() => setUploading(false)}
        />
      )}

      {versions.length === 0 ? (
        <p className="text-sm text-gray-400 bg-surface-50 border border-dashed border-surface-300 rounded-xl px-4 py-6 text-center">
          No resume on file for this application.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => {
            const active = selected?.id === v.id;
            return (
              <li key={v.id}>
                <div
                  onClick={() => pick(v)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') pick(v); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-brand-300 bg-brand-50/60'
                      : 'border-surface-200 bg-white hover:border-surface-300'
                  }`}
                >
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    v.is_current ? 'bg-brand-100 text-brand-700' : 'bg-surface-100 text-gray-500'
                  }`}>
                    <FileText className="w-4 h-4" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">v{v.version}</span>
                      {v.is_current && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                          <Check className="w-2.5 h-2.5" /> Current
                        </span>
                      )}
                      <span className="text-xs text-gray-400 truncate">{v.file_name}</span>
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      {ROLE_LABELS[v.uploaded_by_role] ?? 'Someone'}
                      {v.uploaded_by_name ? ` · ${v.uploaded_by_name}` : ''}
                      {' · '}
                      {format(parseISO(v.created_at), 'd MMM yyyy')}
                    </span>
                    {v.note && <span className="block text-xs text-gray-500 italic mt-0.5">{v.note}</span>}
                  </span>

                  <a
                    href={resolveFileUrl(v.file_url)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 flex-shrink-0"
                  >
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showPreview && selected && (
        isPdf(selected.file_url) ? (
          <iframe
            src={resolveFileUrl(selected.file_url)}
            title={`Resume v${selected.version}`}
            className="w-full h-[60vh] min-h-[320px] max-h-[600px] border border-surface-200 rounded-lg"
          />
        ) : (
          <div className="flex items-center justify-center py-16 bg-surface-50 rounded-xl border border-dashed border-surface-300">
            <div className="text-center">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500 mb-3">Preview not available for this file type</p>
              <a
                href={resolveFileUrl(selected.file_url)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand-600 hover:text-brand-700 font-medium"
              >
                Download v{selected.version}
              </a>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/** Candidate-facing modal wrapper — same history, no preview pane. */
export function ResumeVersionsModal({ applicationId, jobTitle, canUpload, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-lg z-10 max-h-[90dvh] flex flex-col">
        <div className="flex items-start justify-between px-4 sm:px-6 py-4 border-b border-surface-200">
          <div>
            <h2 className="font-display font-semibold text-gray-900">Resume</h2>
            {jobTitle && <p className="text-xs text-gray-500 mt-0.5">{jobTitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-100 text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-6">
          <ResumeVersions applicationId={applicationId} canUpload={canUpload} showPreview={false} />
        </div>
      </div>
    </div>
  );
}
