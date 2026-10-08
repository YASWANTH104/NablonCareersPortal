import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import {
  GraduationCap, ChevronLeft, Users, Clock, Briefcase, CalendarClock,
  Loader2, Search, Check, Send, Award, AlertCircle, Hourglass, LifeBuoy,
  ArrowRight, Link2, Upload, FileSpreadsheet, CheckCircle2, XCircle,
  ClipboardList, Download, FileText, X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { campusesApi } from '@/api/campuses';
import CopyLink from '@/components/shared/CopyLink';
import { QuotaMeter } from '@/components/shared/PipelineFunnel';
import { formatIST } from '@/utils/formatters';
import { Modal, EmptyState } from '@/components/ui';
import { cn } from '@/lib/utils';

const STAGE_LABELS = {
  applied: 'Applied', screening: 'Screening', assessment: 'Assessment',
  tr1: 'Technical Round 1', tr2: 'Technical Round 2', final_tr: 'Final Technical Round',
  hr: 'HR Interview', offer: 'Offer Extended', hired: 'Hired',
  rejected: 'Not Proceeding', withdrawn: 'Withdrawn',
  interview_drop: 'Not Proceeding', offer_drop: 'Not Proceeding',
};
const STAGE_COLORS = {
  applied: 'bg-blue-50 text-blue-700 border-blue-200',
  screening: 'bg-purple-50 text-purple-700 border-purple-200',
  assessment: 'bg-orange-50 text-orange-700 border-orange-200',
  tr1: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  tr2: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  final_tr: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  hr: 'bg-violet-50 text-violet-700 border-violet-200',
  offer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  hired: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  withdrawn: 'bg-surface-100 text-gray-500 border-surface-200',
  interview_drop: 'bg-rose-50 text-rose-700 border-rose-200',
  offer_drop: 'bg-rose-50 text-rose-700 border-rose-200',
};
const TERMINAL_STAGES = new Set(['rejected', 'withdrawn', 'interview_drop', 'offer_drop']);
const ASSESSMENT_TYPES = [
  { value: 'online_test', label: 'Online Test' },
  { value: 'coding_challenge', label: 'Coding Challenge' },
  { value: 'aptitude', label: 'Aptitude' },
  { value: 'case_study', label: 'Case Study' },
  { value: 'assignment', label: 'Assignment' },
];

const inputCls =
  'w-full text-sm border border-surface-300 rounded-lg px-3 py-2.5 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-400';

function StageBadge({ stage }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap', STAGE_COLORS[stage] ?? 'bg-surface-100 text-gray-600 border-surface-200')}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

function initials(name) {
  return (name ?? '?').trim().split(/\s+/).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('');
}

function assignmentState(a) {
  const expiresAt = a?.expires_at ? new Date(a.expires_at) : null;
  const expired = Boolean(expiresAt && expiresAt < new Date());
  const capped = Boolean(a?.max_submissions) && (a?.submission_count ?? 0) >= a.max_submissions;
  return { expiresAt, expired, capped, blocked: expired || capped };
}

function SectionTitle({ icon: Icon, title, count, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className="w-4 h-4 text-gray-400 shrink-0" />}
        <h3 className="font-display text-sm font-bold text-gray-900">{title}</h3>
        {count != null && <span className="text-xs font-semibold text-gray-500 bg-surface-100 rounded-full px-2 py-0.5">{count}</span>}
      </div>
      {action}
    </div>
  );
}

function SidebarCard({ icon: Icon, title, children }) {
  return (
    <section className="bg-white rounded-2xl border border-surface-200 p-4">
      {title && (
        <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-gray-900 mb-3">
          {Icon && <Icon className="w-4 h-4 text-brand-500" />}
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

// ── Roster upload ──────────────────────────────────────────────────────────

const MAX_ROSTER_RESUMES = 20;

function ResultsList({ results, rowLabelKey }) {
  const created = results.filter((r) => r.status === 'success').length;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">
        <span className="text-emerald-600 font-semibold">{created} added</span>
        {results.length - created > 0 && <span className="text-rose-500"> · {results.length - created} failed</span>}
      </p>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-surface-200 divide-y divide-surface-100">
        {results.map((r, i) => (
          <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
            {r.status === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-400">{r[rowLabelKey]}</p>
              {r.status === 'success' ? (
                <p className="text-gray-800 font-medium truncate">{r.candidate_name} <span className="text-gray-400 font-normal">· {r.email}</span></p>
              ) : (
                <p className="text-rose-500">{r.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResumesTab({ portalToken, assignmentId, onDone }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState(null);

  const onDrop = useCallback((accepted) => {
    setFiles((prev) => {
      const merged = [...prev, ...accepted];
      if (merged.length > MAX_ROSTER_RESUMES) {
        toast.error(`Max ${MAX_ROSTER_RESUMES} resumes at a time — extra files were skipped.`);
        return merged.slice(0, MAX_ROSTER_RESUMES);
      }
      return merged;
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxSize: 10 * 1024 * 1024,
  });

  const removeFile = (idx) => setFiles((f) => f.filter((_, i) => i !== idx));

  const mut = useMutation({
    mutationFn: () => campusesApi.portalBulkUploadResumes(portalToken, assignmentId, files).then((r) => r.data),
    onSuccess: (data) => {
      setResults(data.results);
      queryClient.invalidateQueries({ queryKey: ['campus-portal-assignment', portalToken, assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['campus-portal', portalToken] });
      if (data.created > 0) toast.success(`${data.created} student${data.created !== 1 ? 's' : ''} added, resume attached.`);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Bulk resume upload failed'),
  });

  if (results) {
    return (
      <div className="space-y-4">
        <ResultsList results={results} rowLabelKey="filename" />
        <div className="flex gap-3">
          <button onClick={() => { setResults(null); setFiles([]); }} className="px-4 py-2 text-sm text-gray-600 border border-surface-300 rounded-lg hover:bg-surface-50">
            Upload more
          </button>
          <button onClick={onDone} className="px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-brand-400 bg-brand-50' : 'border-surface-300 hover:border-brand-300 hover:bg-surface-50'
        )}
      >
        <input {...getInputProps()} />
        <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-gray-700">{isDragActive ? 'Drop resumes here' : `Drag & drop up to ${MAX_ROSTER_RESUMES} resumes`}</p>
        <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX · each auto-parsed & added, resume attached</p>
      </div>

      {files.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-surface-50 border border-surface-200 rounded-lg text-sm">
              <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="flex-1 truncate text-gray-700">{f.name}</span>
              <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-rose-500 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => mut.mutate()}
        disabled={files.length === 0 || mut.isPending}
        className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {mut.isPending ? `Processing ${files.length} resume${files.length !== 1 ? 's' : ''}…` : `Upload ${files.length || ''} resume${files.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}

function ExcelTab({ portalToken, assignmentId, onDone }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);

  const onDrop = useCallback((accepted) => setFile(accepted[0] ?? null), []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
  });

  const templateMut = useMutation({
    mutationFn: () => campusesApi.portalBulkUploadTemplate(portalToken),
    onSuccess: (res) => {
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'student_roster_template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    },
    onError: () => toast.error('Could not download the template'),
  });

  const mut = useMutation({
    mutationFn: () => campusesApi.portalBulkUploadRoster(portalToken, assignmentId, file).then((r) => r.data),
    onSuccess: (data) => {
      setResults(data.results);
      queryClient.invalidateQueries({ queryKey: ['campus-portal-assignment', portalToken, assignmentId] });
      queryClient.invalidateQueries({ queryKey: ['campus-portal', portalToken] });
      if (data.created > 0) toast.success(`${data.created} student${data.created !== 1 ? 's' : ''} added.`);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Roster upload failed'),
  });

  if (results) {
    return (
      <div className="space-y-4">
        <ResultsList results={results} rowLabelKey="row" />
        <div className="flex gap-3">
          <button onClick={() => { setResults(null); setFile(null); }} className="px-4 py-2 text-sm text-gray-600 border border-surface-300 rounded-lg hover:bg-surface-50">
            Upload another
          </button>
          <button onClick={onDone} className="px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-50 border border-surface-200 rounded-lg px-4 py-3">
        <p className="text-xs text-gray-500">
          Needs <span className="font-medium text-gray-700">Full Name</span> and <span className="font-medium text-gray-700">Email</span> columns — everything else is optional. No resume file — use the Resumes tab for that.
        </p>
        <button
          onClick={() => templateMut.mutate()}
          disabled={templateMut.isPending}
          className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 whitespace-nowrap ml-3"
        >
          {templateMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download template
        </button>
      </div>
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-brand-400 bg-brand-50' : 'border-surface-300 hover:border-brand-300 hover:bg-surface-50'
        )}
      >
        <input {...getInputProps()} />
        <FileSpreadsheet className="w-6 h-6 text-gray-400 mx-auto mb-2" />
        {file ? (
          <p className="text-sm font-medium text-gray-800">{file.name}</p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">{isDragActive ? 'Drop the spreadsheet here' : 'Drag & drop your student list'}</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx or .xls — up to 300 students</p>
          </>
        )}
      </div>
      <button
        onClick={() => mut.mutate()}
        disabled={!file || mut.isPending}
        className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {mut.isPending ? 'Processing…' : 'Upload roster'}
      </button>
    </div>
  );
}

// Spreadsheet roster upload is temporarily hidden from this modal (ExcelTab
// stays defined, just unrendered) — resumes-only for now. Re-add the tab
// switcher above ResumesTab to bring it back.
function RosterUploadModal({ portalToken, assignmentId, onClose }) {
  return (
    <Modal onClose={onClose} title="Add students" description="Drop in resumes and each one is auto-parsed into an application." icon={Upload} size="md">
      <ResumesTab portalToken={portalToken} assignmentId={assignmentId} onDone={onClose} />
    </Modal>
  );
}

// ── Bulk schedule assessments ─────────────────────────────────────────────────

const OPEN_STAGES = new Set(['applied', 'screening', 'assessment', 'tr1', 'tr2', 'final_tr', 'hr', 'offer']);

function BulkScheduleModal({ portalToken, assignmentId, candidates, onClose }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(new Set());
  const [results, setResults] = useState(null);
  const [form, setForm] = useState({ title: '', assessment_type: 'online_test', deadline: '', duration_mins: '', platform_link: '', instructions: '' });

  const eligible = useMemo(() => (candidates ?? []).filter((c) => OPEN_STAGES.has(c.stage)), [candidates]);
  const allSelected = eligible.length > 0 && selected.size === eligible.length;
  const toggle = (id) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const mut = useMutation({
    mutationFn: () =>
      campusesApi
        .portalBulkScheduleAssessments(portalToken, assignmentId, {
          application_ids: [...selected],
          title: form.title.trim(),
          assessment_type: form.assessment_type,
          deadline: new Date(form.deadline).toISOString(),
          duration_mins: form.duration_mins ? parseInt(form.duration_mins, 10) : undefined,
          platform_link: form.platform_link.trim(),
          instructions: form.instructions.trim() || undefined,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      setResults(data.results);
      queryClient.invalidateQueries({ queryKey: ['campus-portal-assignment', portalToken, assignmentId] });
      if (data.created > 0) toast.success(`Scheduled for ${data.created} student${data.created !== 1 ? 's' : ''} — emails are on their way.`);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Bulk scheduling failed'),
  });

  const canSubmit = selected.size > 0 && form.title.trim() && form.deadline && form.platform_link.trim();

  if (results) {
    const created = results.filter((r) => r.status === 'success').length;
    return (
      <Modal onClose={onClose} title="Assessments scheduled" icon={ClipboardList} size="md">
        <p className="text-sm text-gray-600 mb-3">
          <span className="font-semibold text-emerald-600">{created} scheduled</span>
          {results.length - created > 0 && <span className="text-rose-500"> · {results.length - created} failed</span>}
          {results.some((r) => r.stage_moved) && (
            <span className="text-gray-600"> · {results.filter((r) => r.stage_moved).length} moved to Assessment</span>
          )}
        </p>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-surface-200 divide-y divide-surface-100">
          {results.map((r, i) => {
            const c = eligible.find((x) => x.application_id === r.application_id);
            return (
              <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
                {r.status === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <p className="text-gray-800 font-medium truncate">{c?.candidate_name ?? r.application_id}</p>
                  {r.status === 'error' && <p className="text-rose-500 text-xs">{r.error}</p>}
                  {r.status === 'success' && (
                    <p className={r.stage_moved ? 'text-xs text-emerald-600' : 'text-xs text-amber-600'}>
                      {r.stage_moved ? 'Moved to Assessment' : r.stage_note}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onClose}
      title="Bulk-schedule an assessment"
      icon={ClipboardList}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <p className="text-xs text-gray-400">{selected.size} of {eligible.length} selected</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-surface-100 rounded-lg transition-colors">Cancel</button>
            <button
              onClick={() => mut.mutate()}
              disabled={!canSubmit || mut.isPending}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {mut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {mut.isPending ? 'Scheduling…' : `Schedule for ${selected.size || ''}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3.5 mb-5">
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 mb-1.5 block">Assessment title <span className="text-rose-500">*</span></span>
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={inputCls} placeholder="Online Aptitude Round" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 mb-1.5 block">Type</span>
          <select value={form.assessment_type} onChange={(e) => setForm((f) => ({ ...f, assessment_type: e.target.value }))} className={cn(inputCls, 'bg-white')}>
            {ASSESSMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 mb-1.5 block">Deadline <span className="text-rose-500">*</span></span>
          <input type="datetime-local" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 mb-1.5 block">Duration (minutes)</span>
          <input type="number" min="1" value={form.duration_mins} onChange={(e) => setForm((f) => ({ ...f, duration_mins: e.target.value }))} className={inputCls} placeholder="60" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 mb-1.5 block">Platform link <span className="text-rose-500">*</span></span>
          <input value={form.platform_link} onChange={(e) => setForm((f) => ({ ...f, platform_link: e.target.value }))} className={inputCls} placeholder="https://…" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 mb-1.5 block">Instructions</span>
          <input value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} className={inputCls} placeholder="Any notes for the student" />
        </label>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Who is this for?</p>
        {eligible.length > 0 && (
          <button onClick={() => setSelected(allSelected ? new Set() : new Set(eligible.map((c) => c.application_id)))} className="text-[11px] font-semibold text-brand-600 hover:text-brand-700">
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        )}
      </div>

      {eligible.length === 0 ? (
        <EmptyState compact icon={Users} title="No students yet" description="Upload your roster or share your self-apply link first." />
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1.5 -mx-1 px-1">
          {eligible.map((c) => (
            <button
              key={c.application_id}
              onClick={() => toggle(c.application_id)}
              className={cn('w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl border transition-all', selected.has(c.application_id) ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-surface-200 hover:border-brand-200 hover:bg-surface-50')}
            >
              <span className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-[11px] font-bold text-brand-700 shrink-0">{initials(c.candidate_name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 truncate">{c.candidate_name}</span>
                <span className="block text-[11px] text-gray-400">{c.email} · {STAGE_LABELS[c.stage] ?? c.stage}{c.has_assessment ? ' · already has one' : ''}</span>
              </span>
              {selected.has(c.application_id) && <Check className="w-4 h-4 text-brand-500 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Role detail ───────────────────────────────────────────────────────────────

const CANDIDATE_FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'active', label: 'In progress' },
  { value: 'hired', label: 'Hired' },
  { value: 'closed', label: 'Not proceeding' },
];

function RoleDetail({ portalToken, assignment, onBack }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showUpload, setShowUpload] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['campus-portal-assignment', portalToken, assignment.assignment_id],
    queryFn: () => campusesApi.portalAssignment(portalToken, assignment.assignment_id).then((r) => r.data),
    refetchInterval: 20000,
  });

  const candidates = data?.candidates ?? [];

  const counts = useMemo(() => {
    const hired = candidates.filter((c) => c.stage === 'hired').length;
    const rejected = candidates.filter((c) => TERMINAL_STAGES.has(c.stage)).length;
    return { hired, rejected, inProgress: candidates.length - hired - rejected };
  }, [candidates]);

  const visibleCandidates = useMemo(() => {
    let list = candidates;
    if (filter === 'active') list = list.filter((c) => c.stage !== 'hired' && !TERMINAL_STAGES.has(c.stage));
    else if (filter === 'hired') list = list.filter((c) => c.stage === 'hired');
    else if (filter === 'closed') list = list.filter((c) => TERMINAL_STAGES.has(c.stage));
    const needle = search.trim().toLowerCase();
    if (needle) list = list.filter((c) => c.candidate_name?.toLowerCase().includes(needle));
    return [...list].sort((a, b) => new Date(b.stage_updated_at) - new Date(a.stage_updated_at));
  }, [candidates, filter, search]);

  const back = (
    <button onClick={onBack} className="group inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 mb-4">
      <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" /> All drives
    </button>
  );

  if (isLoading) {
    return (
      <div>
        {back}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 animate-pulse">
          <div className="space-y-4">
            <div className="h-28 bg-white border border-surface-200 rounded-2xl" />
            <div className="h-64 bg-white border border-surface-200 rounded-2xl" />
          </div>
          <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="h-36 bg-white border border-surface-200 rounded-2xl" />)}</div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        {back}
        <div className="bg-white border border-surface-200 rounded-2xl">
          <EmptyState icon={AlertCircle} title="Couldn’t load this drive" description="It may have been removed. Go back and get in touch with your Nablon AI contact." />
        </div>
      </div>
    );
  }

  const { expiresAt, expired, capped, blocked } = assignmentState(data);
  const trackedLink = `${window.location.origin}/campus-apply/${assignment.job_slug ?? assignment.job_id}?ref=${assignment.ref_token}`;

  return (
    <div>
      {back}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        <div className="min-w-0 space-y-6">
          <header className="bg-white border border-surface-200 rounded-2xl p-5">
            <div className="flex items-start gap-3.5">
              <span className="w-11 h-11 shrink-0 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><Briefcase className="w-5 h-5" /></span>
              <div className="min-w-0">
                <h1 className="font-display text-lg sm:text-xl font-bold text-gray-900 leading-snug break-words">{data.job_title}</h1>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className={cn('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border', expired ? 'bg-rose-50 text-rose-700 border-rose-200' : capped ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                    {expired ? 'Access ended' : capped ? 'Cap reached' : 'Open for submissions'}
                  </span>
                  {data.drive_date && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                      <CalendarClock className="w-3 h-3" /> Drive {formatIST(data.drive_date, 'd MMM yyyy')}
                    </span>
                  )}
                  {expiresAt && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                      <Clock className="w-3 h-3" /> {expired ? 'ended' : 'until'} {formatIST(expiresAt, 'd MMM yyyy')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {blocked && (
              <div className="flex items-start gap-2.5 mt-4 text-xs rounded-xl border border-amber-200 bg-amber-50 text-amber-800 p-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <p>
                  {expired
                    ? 'Your window for this drive has closed, so new submissions are refused. Everyone already submitted carries on below.'
                    : "You've used every submission slot for this drive. Students already submitted continue as normal."}
                </p>
              </div>
            )}
          </header>

          <div>
            <SectionTitle
              icon={Users}
              title="Students"
              count={candidates.length}
              action={
                candidates.length > 3 ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a name…" className="w-36 sm:w-44 pl-8 pr-2 py-1.5 text-xs bg-white border border-surface-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    </div>
                    <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter students" className="text-xs bg-white border border-surface-300 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500">
                      {CANDIDATE_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                ) : null
              }
            />

            {candidates.length === 0 ? (
              <div className="bg-white border border-surface-200 rounded-2xl">
                <EmptyState
                  icon={Users}
                  title="No students submitted yet"
                  description={blocked ? 'Submissions are closed for this drive.' : 'Upload your roster spreadsheet, or share your self-apply link below.'}
                  action={!blocked ? (
                    <button onClick={() => setShowUpload(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors">
                      <Upload className="w-4 h-4" /> Upload your roster
                    </button>
                  ) : null}
                />
              </div>
            ) : visibleCandidates.length === 0 ? (
              <div className="bg-white border border-surface-200 rounded-2xl">
                <EmptyState compact icon={Search} title="Nobody matches" description="Try a different name, or change the filter." />
              </div>
            ) : (
              <div className="bg-white border border-surface-200 rounded-2xl divide-y divide-surface-100 overflow-hidden">
                {visibleCandidates.map((c, i) => {
                  const closed = TERMINAL_STAGES.has(c.stage);
                  return (
                    <div key={c.application_id} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }} className={cn('flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 transition-colors', 'animate-in fade-in slide-in-from-bottom-1 duration-300 fill-mode-both', closed ? 'opacity-60' : 'hover:bg-surface-50')}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0', c.stage === 'hired' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700')}>{initials(c.candidate_name)}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{c.candidate_name}</p>
                          <p className="text-[11px] text-gray-400">submitted {formatDistanceToNow(new Date(c.applied_at), { addSuffix: true })}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        {c.has_assessment && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-orange-200 bg-orange-50 text-orange-700">
                            <ClipboardList className="w-2.5 h-2.5" /> Assessment set
                          </span>
                        )}
                        <StageBadge stage={c.stage} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="lg:sticky lg:top-[5.5rem] space-y-4">
          <SidebarCard>
            <QuotaMeter used={data.submission_count} max={data.max_submissions} className="mb-4" />
            <div className="space-y-2">
              <button
                onClick={() => setShowUpload(true)}
                disabled={blocked}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Upload className="w-4 h-4" /> Upload student roster
              </button>
              <button
                onClick={() => setShowBulk(true)}
                disabled={candidates.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-white text-brand-700 border border-brand-200 text-sm font-semibold rounded-xl hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ClipboardList className="w-4 h-4" /> Bulk-schedule assessments
              </button>
            </div>
          </SidebarCard>

          {candidates.length > 0 && (
            <SidebarCard title="Where they stand" icon={Send}>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="font-display text-lg font-bold text-gray-900">{counts.inProgress}</p><p className="text-[10px] text-gray-400">In progress</p></div>
                <div><p className="font-display text-lg font-bold text-emerald-600">{counts.hired}</p><p className="text-[10px] text-gray-400">Hired</p></div>
                <div><p className="font-display text-lg font-bold text-rose-500">{counts.rejected}</p><p className="text-[10px] text-gray-400">Closed</p></div>
              </div>
            </SidebarCard>
          )}

          {!expired && (
            <SidebarCard title="Self-apply link" icon={Link2}>
              <CopyLink url={trackedLink} label={null} hint="Send this to students instead. Anyone who applies through it is credited to this drive automatically." className="border-0 bg-transparent p-0" />
            </SidebarCard>
          )}

          <SidebarCard title="Need a hand?" icon={LifeBuoy}>
            <p className="text-xs text-gray-500 leading-relaxed">
              Your Nablon AI point of contact can raise a submission cap or extend your access window. Deadlines shown here are in <strong className="font-semibold text-gray-700">IST</strong>.
            </p>
          </SidebarCard>
        </aside>
      </div>

      {showUpload && <RosterUploadModal portalToken={portalToken} assignmentId={assignment.assignment_id} onClose={() => setShowUpload(false)} />}
      {showBulk && <BulkScheduleModal portalToken={portalToken} assignmentId={assignment.assignment_id} candidates={candidates} onClose={() => setShowBulk(false)} />}
    </div>
  );
}

// ── Drive card ─────────────────────────────────────────────────────────────────

function DriveCard({ assignment, onOpen, index }) {
  const { expiresAt, expired, capped } = assignmentState(assignment);
  return (
    <button
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={cn('group w-full text-left bg-white border rounded-2xl p-5 transition-all', 'animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both', expired ? 'border-surface-200 opacity-70 hover:opacity-100' : 'border-surface-200 hover:border-brand-300 hover:shadow-card-hover hover:-translate-y-0.5')}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn('w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-colors', expired ? 'bg-surface-100 text-gray-400' : 'bg-brand-50 text-brand-600 group-hover:bg-brand-100')}>
          <Briefcase className="w-5 h-5" />
        </span>
        <span className={cn('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border shrink-0', expired ? 'bg-rose-50 text-rose-700 border-rose-200' : capped ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
          {expired ? 'Ended' : capped ? 'Cap reached' : 'Open'}
        </span>
      </div>
      <h3 className="font-display font-bold text-gray-900 mt-3.5 leading-snug group-hover:text-brand-700 transition-colors">{assignment.job_title}</h3>
      {assignment.drive_date && (
        <p className="inline-flex items-center gap-1 text-[11px] text-gray-400 mt-1">
          <CalendarClock className="w-3 h-3" /> drive {formatIST(assignment.drive_date, 'd MMM')}
        </p>
      )}
      {expiresAt && !expired && (
        <p className="inline-flex items-center gap-1 text-[11px] text-gray-400 mt-1">
          <Clock className="w-3 h-3" /> open until {formatIST(expiresAt, 'd MMM')}
        </p>
      )}
      <div className="mt-4"><QuotaMeter used={assignment.submission_count} max={assignment.max_submissions} /></div>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 mt-4 group-hover:gap-2 transition-all">
        Open drive <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Shell({ campusName, driveSwitcher, children }) {
  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <header className="bg-white/90 backdrop-blur border-b border-surface-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <img src="/logo.jpg" alt="Nablon AI" className="h-8 w-auto rounded-lg object-contain shrink-0" />
          <div className="h-5 w-px bg-surface-200 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 leading-none truncate">{campusName ?? 'Campus Placement Portal'}</p>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">Nablon AI · Placement cell workspace</p>
          </div>
          {driveSwitcher}
        </div>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
      <footer className="border-t border-surface-200 bg-white py-5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center text-[11px] text-gray-400">
          © {new Date().getFullYear()} Nablon AI · Student data is handled confidentially
        </div>
      </footer>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampusPortalPage() {
  const { portalToken } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('drive');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['campus-portal', portalToken],
    queryFn: () => campusesApi.portal(portalToken).then((r) => r.data),
    retry: false,
  });

  const assignments = data?.assignments ?? [];
  const selected = assignments.find((a) => a.assignment_id === selectedId) ?? null;

  if (isLoading) {
    return (
      <Shell>
        <div className="space-y-5 animate-pulse">
          <div className="h-44 bg-white border border-surface-200 rounded-3xl" />
          <div className="grid sm:grid-cols-2 gap-4">{[1, 2].map((i) => <div key={i} className="h-56 bg-white border border-surface-200 rounded-2xl" />)}</div>
        </div>
      </Shell>
    );
  }

  if (isError) {
    return (
      <Shell>
        <div className="bg-white border border-surface-200 rounded-2xl max-w-xl mx-auto">
          <EmptyState icon={GraduationCap} title="This portal link isn't working" description="It may have been deactivated, or the link may be incomplete. Check the link in your invitation email, or get in touch with your Nablon AI point of contact." />
        </div>
      </Shell>
    );
  }

  const driveSwitcher =
    assignments.length > 1 ? (
      <select
        value={selectedId ?? ''}
        onChange={(e) => (e.target.value ? setSearchParams({ drive: e.target.value }) : setSearchParams({}))}
        aria-label="Switch drive"
        className="shrink-0 max-w-[10rem] sm:max-w-[16rem] text-xs sm:text-sm border border-surface-300 rounded-xl px-2.5 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <option value="">All drives</option>
        {assignments.map((a) => <option key={a.assignment_id} value={a.assignment_id}>{a.job_title}</option>)}
      </select>
    ) : null;

  if (selected) {
    return (
      <Shell campusName={data?.campus_name} driveSwitcher={driveSwitcher}>
        <RoleDetail portalToken={portalToken} assignment={selected} onBack={() => setSearchParams({})} />
      </Shell>
    );
  }

  const openCount = assignments.filter((a) => !assignmentState(a).expired).length;

  return (
    <Shell campusName={data?.campus_name} driveSwitcher={driveSwitcher}>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white mb-6">
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-28 left-1/4 w-80 h-80 rounded-full bg-brand-300/20 blur-3xl pointer-events-none" />
        <div className="relative p-6 sm:p-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">Placement cell workspace</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold mt-2.5 leading-tight">{data?.campus_name}</h1>
          <p className="text-sm text-white/75 mt-2 max-w-xl leading-relaxed">
            Upload your student roster or share a self-apply link, then bulk-schedule an assessment for the whole
            drive in one action — no logins, no chasing anyone for an update.
          </p>
          {assignments.length > 0 && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-6">
              {[
                { label: 'Drives open', value: openCount, icon: Briefcase },
                { label: 'Submitted', value: data.total_submitted, icon: Send },
                { label: 'In progress', value: data.total_in_progress, icon: Hourglass },
                { label: 'Hired', value: data.total_hired, icon: Award },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-2xl bg-white/10 border border-white/15 backdrop-blur-sm px-3.5 py-3">
                  <dt className="flex items-center gap-1.5 text-[11px] text-white/70"><Icon className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{label}</span></dt>
                  <dd className="font-display text-2xl font-bold tabular-nums mt-1 leading-none">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {assignments.length === 0 ? (
        <div className="bg-white border border-surface-200 rounded-2xl max-w-xl mx-auto">
          <EmptyState icon={Briefcase} title="No drives assigned yet" description="Once the Nablon AI hiring team opens a role to your campus it appears here, along with roster upload, self-apply link and bulk assessment scheduling." />
        </div>
      ) : (
        <>
          <SectionTitle icon={Briefcase} title="Your drives" count={assignments.length} />
          <div className={cn('grid gap-4', assignments.length > 1 && 'sm:grid-cols-2')}>
            {assignments.map((a, i) => (
              <DriveCard key={a.assignment_id} index={i} assignment={a} onOpen={() => setSearchParams({ drive: a.assignment_id })} />
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}
