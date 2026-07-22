import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { Upload, FileText, X, Loader2, Sparkles } from 'lucide-react';

const EMPTY = {
  full_name: '',
  email: '',
  phone: '',
  current_location: '',
  total_experience: '',
  current_company: '',
  current_designation: '',
  education: '',
  skills: '',
  current_ctc: '',
  expected_ctc: '',
  linkedin_url: '',
};

const inputCls =
  'w-full px-3 py-2.5 border border-surface-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent';

/**
 * Resume-first candidate intake: drop a resume, fields get parsed + auto-filled,
 * the submitter corrects anything wrong, then submits.
 * Used by the agency portal (public) and the HR "Add candidate" modal.
 *
 * Props:
 *  - onParse(file)   → Promise<parsed fields> (optional; skip auto-fill when absent)
 *  - onSubmit(payload) → Promise; payload = { resume: File, ...fields }
 *  - submitLabel     → button text
 *  - header          → optional node rendered above the fields (job/source selectors)
 *  - disabled        → block submission until parent is ready (e.g. no job chosen)
 */
export default function CandidateIntakeForm({ onParse, onSubmit, submitLabel = 'Submit candidate', header = null, disabled = false }) {
  const [resumeFile, setResumeFile] = useState(null);
  const [fields, setFields] = useState(EMPTY);
  const [parsing, setParsing] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const setField = (name) => (e) => setFields((f) => ({ ...f, [name]: e.target.value }));

  const onDrop = useCallback(
    async (accepted) => {
      const file = accepted[0];
      if (!file) return;
      setResumeFile(file);
      if (!onParse) return;

      setParsing(true);
      try {
        const { data } = await onParse(file);
        setFields((prev) => {
          const next = { ...prev };
          Object.keys(EMPTY).forEach((key) => {
            if (!prev[key] && data[key]) next[key] = data[key];
          });
          return next;
        });
        setAutoFilled(true);
        toast.success("Fields pre-filled from the resume — please review and correct.");
      } catch {
        toast("Couldn't parse the resume — please fill the details manually.", { icon: '⚠️' });
      } finally {
        setParsing(false);
      }
    },
    [onParse]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!resumeFile) {
      toast.error("Please upload the candidate's resume");
      return;
    }
    if (!fields.full_name.trim() || !fields.email.trim()) {
      toast.error('Candidate name and email are required');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ resume: resumeFile, ...fields });
      setResumeFile(null);
      setFields(EMPTY);
      setAutoFilled(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {header}

      {/* Resume dropzone */}
      {resumeFile ? (
        <div className="flex items-center gap-3 p-3.5 bg-green-50 border border-green-200 rounded-lg">
          <FileText className="w-5 h-5 text-green-600 flex-shrink-0" />
          <span className="text-sm text-green-800 flex-1 truncate">{resumeFile.name}</span>
          {parsing && (
            <span className="flex items-center gap-1.5 text-xs text-green-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Parsing…
            </span>
          )}
          <button type="button" onClick={() => setResumeFile(null)} className="text-green-600 hover:text-green-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-brand-400 bg-brand-50' : 'border-surface-300 hover:border-brand-300 hover:bg-surface-50'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-700">
            {isDragActive ? 'Drop the resume here' : "Drag & drop the candidate's resume"}
          </p>
          <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX · Max 10 MB · fields auto-fill from the resume</p>
        </div>
      )}

      {autoFilled && (
        <p className="flex items-center gap-1.5 text-xs text-brand-600">
          <Sparkles className="w-3.5 h-3.5" />
          Auto-filled from the resume — please verify before submitting.
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Full name <span className="text-red-500">*</span>
          </label>
          <input value={fields.full_name} onChange={setField('full_name')} placeholder="Candidate name" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input type="email" value={fields.email} onChange={setField('email')} placeholder="candidate@email.com" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
          <input value={fields.phone} onChange={setField('phone')} placeholder="+91 …" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Current location</label>
          <input value={fields.current_location} onChange={setField('current_location')} placeholder="Bengaluru, India" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Current company</label>
          <input value={fields.current_company} onChange={setField('current_company')} placeholder="Company (or 'Fresher')" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Current designation</label>
          <input value={fields.current_designation} onChange={setField('current_designation')} placeholder="e.g. Senior Data Scientist" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Total experience</label>
          <input value={fields.total_experience} onChange={setField('total_experience')} placeholder="e.g. 5 years" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Education</label>
          <input value={fields.education} onChange={setField('education')} placeholder="e.g. B.Tech, CSE, IIT Delhi" className={inputCls} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Skills</label>
        <textarea rows={2} value={fields.skills} onChange={setField('skills')} placeholder="Python, PyTorch, LLMs…" className={`${inputCls} resize-none`} />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Current CTC</label>
          <input value={fields.current_ctc} onChange={setField('current_ctc')} placeholder="e.g. 18 LPA" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Expected CTC</label>
          <input value={fields.expected_ctc} onChange={setField('expected_ctc')} placeholder="e.g. 24 LPA" className={inputCls} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">LinkedIn</label>
        <input value={fields.linkedin_url} onChange={setField('linkedin_url')} placeholder="https://linkedin.com/in/…" className={inputCls} />
      </div>

      <button
        type="submit"
        disabled={submitting || parsing || disabled}
        className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-brand-500 text-white font-semibold rounded-lg text-sm hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitting ? 'Submitting…' : submitLabel}
      </button>
    </form>
  );
}
