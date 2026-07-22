import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  X, Upload, FileText, FileSpreadsheet, Loader2, CheckCircle2, XCircle, Download, File as FileIcon,
} from 'lucide-react';
import { applicationsApi } from '@/api/applications';

const SOURCE_OPTIONS = [
  { value: 'talent_acquisition', label: 'Talent Acquisition' },
  { value: 'direct', label: 'Direct' },
];

const MAX_RESUMES = 20;

const selectCls =
  'w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

function ResultsTable({ results, rowLabelKey }) {
  const created = results.filter((r) => r.status === 'success').length;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">
        <span className="text-green-600 font-semibold">{created} added</span>
        {results.length - created > 0 && (
          <span className="text-red-500"> · {results.length - created} failed</span>
        )}
      </p>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-surface-200 divide-y divide-surface-100">
        {results.map((r, i) => (
          <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
            {r.status === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-400">{r[rowLabelKey]}</p>
              {r.status === 'success' ? (
                <p className="text-gray-800 font-medium truncate">{r.candidate_name} <span className="text-gray-400 font-normal">· {r.email}</span></p>
              ) : (
                <p className="text-red-500">{r.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResumesTab({ jobs, onDone }) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState('');
  const [source, setSource] = useState('talent_acquisition');
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState(null);

  const onDrop = useCallback((accepted) => {
    setFiles((prev) => {
      const merged = [...prev, ...accepted];
      if (merged.length > MAX_RESUMES) {
        toast.error(`Max ${MAX_RESUMES} resumes at a time — extra files were skipped.`);
        return merged.slice(0, MAX_RESUMES);
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

  const uploadMut = useMutation({
    mutationFn: () => applicationsApi.bulkUploadResumes(jobId, source, files).then((r) => r.data),
    onSuccess: (data) => {
      setResults(data.results);
      queryClient.invalidateQueries({ queryKey: ['hr-applications'] });
      if (data.created > 0) toast.success(`${data.created} candidate${data.created !== 1 ? 's' : ''} added to the pipeline`);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Bulk upload failed'),
  });

  if (results) {
    return (
      <div className="space-y-4">
        <ResultsTable results={results} rowLabelKey="filename" />
        <div className="flex gap-3">
          <button
            onClick={() => { setResults(null); setFiles([]); }}
            className="px-4 py-2 text-sm text-gray-600 border border-surface-300 rounded-lg hover:bg-surface-50"
          >
            Upload more
          </button>
          <button
            onClick={onDone}
            className="px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Job <span className="text-red-500">*</span>
          </label>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={selectCls}>
            <option value="">Select a job…</option>
            {jobs?.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
            {SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragActive ? 'border-brand-400 bg-brand-50' : 'border-surface-300 hover:border-brand-300 hover:bg-surface-50'
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-gray-700">
          {isDragActive ? 'Drop resumes here' : 'Drag & drop up to 20 resumes'}
        </p>
        <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX · each auto-parsed & added to the pipeline</p>
      </div>

      {files.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-surface-50 border border-surface-200 rounded-lg text-sm">
              <FileIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="flex-1 truncate text-gray-700">{f.name}</span>
              <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => uploadMut.mutate()}
        disabled={!jobId || files.length === 0 || uploadMut.isPending}
        className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {uploadMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploadMut.isPending ? `Processing ${files.length} resume${files.length !== 1 ? 's' : ''}…` : `Upload ${files.length || ''} resume${files.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}

function ExcelTab({ jobs, onDone }) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState('');
  const [source, setSource] = useState('talent_acquisition');
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
    mutationFn: () => applicationsApi.bulkUploadTemplate(),
    onSuccess: (res) => {
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'candidate_bulk_upload_template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    },
    onError: () => toast.error('Could not download the template'),
  });

  const uploadMut = useMutation({
    mutationFn: () => applicationsApi.bulkUploadExcel(jobId, source, file).then((r) => r.data),
    onSuccess: (data) => {
      setResults(data.results);
      queryClient.invalidateQueries({ queryKey: ['hr-applications'] });
      if (data.created > 0) toast.success(`${data.created} candidate${data.created !== 1 ? 's' : ''} added to the pipeline`);
    },
    onError: (err) => toast.error(err.response?.data?.detail ?? 'Bulk upload failed'),
  });

  if (results) {
    return (
      <div className="space-y-4">
        <ResultsTable results={results} rowLabelKey="row" />
        <div className="flex gap-3">
          <button
            onClick={() => { setResults(null); setFile(null); }}
            className="px-4 py-2 text-sm text-gray-600 border border-surface-300 rounded-lg hover:bg-surface-50"
          >
            Upload another
          </button>
          <button onClick={onDone} className="px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-surface-50 border border-surface-200 rounded-lg px-4 py-3">
        <p className="text-xs text-gray-500">
          Needs <span className="font-medium text-gray-700">Full Name</span> and <span className="font-medium text-gray-700">Email</span> columns — everything else is optional.
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

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Job <span className="text-red-500">*</span>
          </label>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={selectCls}>
            <option value="">Select a job…</option>
            {jobs?.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
            {SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragActive ? 'border-brand-400 bg-brand-50' : 'border-surface-300 hover:border-brand-300 hover:bg-surface-50'
        }`}
      >
        <input {...getInputProps()} />
        <FileSpreadsheet className="w-6 h-6 text-gray-400 mx-auto mb-2" />
        {file ? (
          <p className="text-sm font-medium text-gray-800">{file.name}</p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">{isDragActive ? 'Drop the spreadsheet here' : 'Drag & drop the candidate spreadsheet'}</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx or .xls · up to 300 rows</p>
          </>
        )}
      </div>

      <button
        onClick={() => uploadMut.mutate()}
        disabled={!jobId || !file || uploadMut.isPending}
        className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {uploadMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploadMut.isPending ? 'Processing…' : 'Upload spreadsheet'}
      </button>
    </div>
  );
}

export default function BulkUploadModal({ jobs, onClose }) {
  const [tab, setTab] = useState('resumes');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-xl my-8">
        <div className="flex items-center justify-between px-6 py-5 border-b border-surface-100">
          <div>
            <h3 className="text-base font-bold text-gray-900">Bulk upload candidates</h3>
            <p className="text-xs text-gray-500 mt-0.5">Add many candidates to a job's pipeline at once</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1 bg-surface-100 rounded-xl p-1 mx-6 mt-5">
          <button
            onClick={() => setTab('resumes')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'resumes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Resumes
          </button>
          <button
            onClick={() => setTab('excel')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'excel' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Spreadsheet
          </button>
        </div>

        <div className="p-6">
          {tab === 'resumes' ? <ResumesTab jobs={jobs} onDone={onClose} /> : <ExcelTab jobs={jobs} onDone={onClose} />}
        </div>
      </div>
    </div>
  );
}
